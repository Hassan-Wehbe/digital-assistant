-- Test: attachments (docs/phase2-attachments-plan.md; CLAUDE.md rules 3, 5).
-- Storage uploads are simulated by inserting the storage.objects row the
-- Storage API would write, as the signed-in user, so the Storage policies apply.
-- Two kinds of session, as in 04_vault.sql:
--   browser: the owner on the upload page (no client_id claim)
--   mcp:     the Claude connector's OAuth token (has a client_id claim)

create temp table _v (k text primary key, v text);
grant select, insert, update on _v to authenticated, anon;
create function pg_temp.get(p_k text) returns text language sql stable as $$
  select v from _v where k = p_k;
$$;

create function pg_temp.as_user(p_sub text, p_mcp boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    (json_build_object('sub', p_sub, 'role', 'authenticated')::jsonb
      || case when p_mcp then '{"client_id":"claude-connector"}'::jsonb else '{}'::jsonb end)::text,
    true);
$$;

-- What the Storage API writes for an upload (owner = the uploader).
create function pg_temp.upload(p_name text, p_mime text, p_size int default 1234) returns void
language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('attachments', p_name, auth.uid()::text,
          jsonb_build_object('mimetype', p_mime, 'size', p_size));
$$;

-- ---------- setup: bucket exists and is private ----------
select pg_temp.check('bucket attachments is private, 20 MB, pictures and Visio only',
  (select not public and file_size_limit = 20971520
      and allowed_mime_types @> array['image/png', 'image/jpeg',
                                      'application/vnd.ms-visio.drawing', 'application/vnd.visio']
      and cardinality(allowed_mime_types) = 4
   from storage.buckets where id = 'attachments'));

-- The chunker (internal; not callable by users, so checked as the owner here).
select pg_temp.check('chunker: long text split into <=1000-char chunks, words kept, over-long word cut',
  (select count(*) >= 3 and max(length(c)) <= 1000
          and string_agg(c, ' ' order by o) like '%word1 word2 %'
          and string_agg(c, ' ' order by o) like '%word300%'
          and sum(length(c)) >= 1500
   from _chunk_text((select string_agg('word' || g, ' ') from generate_series(1, 300) g)
                    || E'\n' || repeat('x', 1500)) with ordinality t(c, o)));
select pg_temp.check('chunker: short lines are joined into one chunk',
  (select count(*) = 1 and bool_and(c = E'a\nb\nc') from _chunk_text(E'a\n\n b \nc') c));

-- ---------- user A (MCP): spaces, items, an upload link ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a', true);
set local role authenticated;

insert into space (name) values ('Work');
insert into space (name, is_restricted) values ('Private', true);
select save_item((select id from space where name = 'Work'), 'design', 'Teams routing design',
                 'How calls reach Service Cloud.', null, '{}', '{}', pg_temp.chunks('How calls reach Service Cloud.', 3));
select save_item((select id from space where name = 'Private'), 'note', 'Private diagram',
                 'Hidden.', null, '{}', '{}', pg_temp.chunks('Hidden.', 4));
insert into _v select 'item', id::text from item where title = 'Teams routing design';
insert into _v select 'pitem', id::text from item where title = 'Private diagram';

do $$
begin
  perform pg_temp.upload('00000000-0000-4000-a000-00000000000a/' || gen_random_uuid() || '/x.png', 'image/png');
  perform pg_temp.check('no upload without an open upload link', false, 'upload accepted');
exception when others then
  perform pg_temp.check('no upload without an open upload link', sqlstate = '42501', sqlerrm);
end $$;

insert into _v select 'r1', create_attachment_upload(pg_temp.get('item')::uuid,
  'Whiteboard photo: caller -> SBC -> falcon queue -> Service Cloud omni-channel.')::text;
insert into _v select 'r2', create_attachment_upload(pg_temp.get('pitem')::uuid, null)::text;
insert into _v select 'r_exp', create_attachment_upload(pg_temp.get('item')::uuid, null)::text;
insert into _v values ('t1', pg_temp.get('r1')::jsonb ->> 'token'),
                      ('t2', pg_temp.get('r2')::jsonb ->> 'token'),
                      ('t_exp', pg_temp.get('r_exp')::jsonb ->> 'token');

select pg_temp.check('upload link token is 43 URL-safe characters',
  (select pg_temp.get('t1') ~ '^[A-Za-z0-9_-]{43}$'));

do $$
begin
  perform create_attachment_upload(gen_random_uuid(), null);
  perform pg_temp.check('create_attachment_upload refuses an unknown item', false, 'accepted');
exception when others then
  perform pg_temp.check('create_attachment_upload refuses an unknown item', sqlerrm = 'item not found', sqlerrm);
end $$;

do $$
begin
  perform pg_temp.upload('00000000-0000-4000-a000-00000000000a/' || gen_random_uuid() || '/x.png', 'image/png');
  perform pg_temp.check('the connector token cannot upload, even with an open link', false, 'upload accepted');
exception when others then
  perform pg_temp.check('the connector token cannot upload, even with an open link', sqlstate = '42501', sqlerrm);
end $$;

do $$
begin
  perform get_attachment_upload_request(pg_temp.get('t1'));
  perform pg_temp.check('the connector token cannot read the upload request', false, 'accepted');
exception when others then
  perform pg_temp.check('the connector token cannot read the upload request', sqlstate = '42501', sqlerrm);
end $$;

do $$
begin
  perform count(*) from attachment_upload_request;
  perform pg_temp.check('upload requests are not directly readable', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('upload requests are not directly readable', true, sqlerrm);
end $$;

-- ---------- user A (browser): the upload page ----------
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a', false);
set local role authenticated;

select pg_temp.check('the page reads the request: item, space, description',
  (select r ->> 'item_title' = 'Teams routing design' and r ->> 'space' = 'Work'
      and r ->> 'description' like 'Whiteboard photo:%'
      and r ->> 'user_id' = '00000000-0000-4000-a000-00000000000a'
      and (r ->> 'max_bytes')::int = 20971520
   from get_attachment_upload_request(pg_temp.get('t1')) r));

insert into _v values ('png', gen_random_uuid()::text), ('vsdx', gen_random_uuid()::text),
                      ('vsd', gen_random_uuid()::text), ('priv', gen_random_uuid()::text);

do $$
begin
  perform pg_temp.upload('00000000-0000-4000-a000-00000000000b/' || gen_random_uuid() || '/x.png', 'image/png');
  perform pg_temp.check('A cannot upload into B''s folder', false, 'upload accepted');
exception when others then
  perform pg_temp.check('A cannot upload into B''s folder', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  perform pg_temp.upload('00000000-0000-4000-a000-00000000000a/x.png', 'image/png');
  perform pg_temp.check('uploads must sit in <user>/<attachment id>/<name>', false, 'upload accepted');
exception when others then
  perform pg_temp.check('uploads must sit in <user>/<attachment id>/<name>', sqlstate = '42501', sqlerrm);
end $$;

select pg_temp.upload('00000000-0000-4000-a000-00000000000a/' || pg_temp.get('png') || '/whiteboard.png', 'image/png', 204800);
select pg_temp.upload('00000000-0000-4000-a000-00000000000a/' || pg_temp.get('vsdx') || '/Routing_v2.vsdx',
                      'application/vnd.ms-visio.drawing', 51200);
select pg_temp.upload('00000000-0000-4000-a000-00000000000a/' || pg_temp.get('vsd') || '/old.vsd', 'application/vnd.visio', 90000);
select pg_temp.upload('00000000-0000-4000-a000-00000000000a/' || pg_temp.get('priv') || '/secret-plan.vsdx',
                      'application/vnd.ms-visio.drawing', 1000);
select pg_temp.check('A can upload into their own folder while the link is open', true);

do $$
begin
  perform complete_attachment_upload(pg_temp.get('t1'), jsonb_build_array(
    jsonb_build_object('attachment_id', gen_random_uuid(), 'filename', 'ghost.png', 'storage_name', 'ghost.png')));
  perform pg_temp.check('completion refuses a file that is not in storage', false, 'accepted');
exception when others then
  perform pg_temp.check('completion refuses a file that is not in storage', sqlstate = 'PT404', sqlerrm);
end $$;
do $$
begin
  perform complete_attachment_upload(pg_temp.get('t1'), jsonb_build_array(
    jsonb_build_object('attachment_id', pg_temp.get('png'), 'filename', 'whiteboard.exe', 'storage_name', 'whiteboard.png')));
  perform pg_temp.check('completion refuses other file types', false, 'accepted');
exception when others then
  perform pg_temp.check('completion refuses other file types', sqlerrm like '%only .png%', sqlerrm);
end $$;
do $$
begin
  perform complete_attachment_upload(pg_temp.get('t1'), jsonb_build_array(
    jsonb_build_object('attachment_id', pg_temp.get('png'), 'filename', 'whiteboard.png',
                       'storage_name', 'whiteboard.png', 'extracted_text', 'sneaky')));
  perform pg_temp.check('extracted text is accepted only for .vsdx', false, 'accepted');
exception when others then
  perform pg_temp.check('extracted text is accepted only for .vsdx', sqlerrm like '%only for .vsdx%', sqlerrm);
end $$;
do $$
begin
  perform complete_attachment_upload(pg_temp.get('t1'), jsonb_build_array(
    jsonb_build_object('attachment_id', pg_temp.get('vsd'), 'filename', 'old.vsdx', 'storage_name', 'old.vsd')));
  perform pg_temp.check('storage name and file name must have the same type', false, 'accepted');
exception when others then
  perform pg_temp.check('storage name and file name must have the same type', sqlerrm like '%storage_name%', sqlerrm);
end $$;
do $$
begin
  insert into attachment (item_id, storage_key, original_filename, mime_type)
  values (pg_temp.get('item')::uuid, '00000000-0000-4000-a000-00000000000b/x/y.png', 'y.png', 'image/png');
  perform pg_temp.check('attachment rows cannot be inserted directly', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('attachment rows cannot be inserted directly', true, sqlerrm);
end $$;

insert into _v select 'done1', complete_attachment_upload(pg_temp.get('t1'), jsonb_build_array(
  jsonb_build_object('attachment_id', pg_temp.get('png'), 'filename', 'whiteboard.png',
                     'storage_name', 'whiteboard.png', 'caption', 'Photo from the Tuesday workshop'),
  jsonb_build_object('attachment_id', pg_temp.get('vsdx'), 'filename', 'Routing v2.vsdx',
                     'storage_name', 'Routing_v2.vsdx',
                     'extracted_text', E'Page: Call flow\nIngress trunk\nkestrel overflow queue'),
  jsonb_build_object('attachment_id', pg_temp.get('vsd'), 'filename', 'old.vsd', 'storage_name', 'old.vsd')))::text;

select pg_temp.check('completion attaches three files to the item',
  (select (d ->> 'item_title') = 'Teams routing design' and jsonb_array_length(d -> 'attachments') = 3
   from (select pg_temp.get('done1')::jsonb d) x));
select pg_temp.check('the description goes to the only picture',
  (select extracted_description like 'Whiteboard photo:%' from attachment where id = pg_temp.get('png')::uuid)
  and (select count(*) = 1 from attachment where extracted_description is not null));
select pg_temp.check('size and type come from Storage''s record',
  (select size_bytes = 204800 and mime_type = 'image/png' from attachment where id = pg_temp.get('png')::uuid));
select pg_temp.check('each attachment has pending chunks (embedding null) for background indexing',
  (select count(distinct attachment_id) = 3 and bool_and(embedding is null)
   from item_chunk where attachment_id is not null));
select pg_temp.check('the item''s own chunks are untouched',
  (select count(*) = 1 from item_chunk where item_id = pg_temp.get('item')::uuid and attachment_id is null));

do $$
begin
  perform complete_attachment_upload(pg_temp.get('t1'), jsonb_build_array(
    jsonb_build_object('attachment_id', pg_temp.get('priv'), 'filename', 'x.vsdx', 'storage_name', 'secret-plan.vsdx')));
  perform pg_temp.check('an upload link works once', false, 'accepted');
exception when others then
  perform pg_temp.check('an upload link works once', sqlstate = 'PT410', sqlerrm);
end $$;

reset role;
update attachment_upload_request set expires_at = now() - interval '1 second'
where token_hash = _vault_token_hash(pg_temp.get('t_exp'));
set local role authenticated;
do $$
begin
  perform get_attachment_upload_request(pg_temp.get('t_exp'));
  perform pg_temp.check('an expired upload link is refused (410)', false, 'accepted');
exception when others then
  perform pg_temp.check('an expired upload link is refused (410)', sqlstate = 'PT410', sqlerrm);
end $$;

-- Private-space item gets a .vsdx whose text shares the search words.
select complete_attachment_upload(pg_temp.get('t2'), jsonb_build_array(
  jsonb_build_object('attachment_id', pg_temp.get('priv'), 'filename', 'secret-plan.vsdx',
                     'storage_name', 'secret-plan.vsdx',
                     'extracted_text', 'kestrel overflow queue whiteboard')));

-- ---------- search ----------
select pg_temp.check('keyword search finds the item by its Visio text',
  (select count(*) = 1 and bool_and(title = 'Teams routing design') from search_items('kestrel overflow')));
select pg_temp.check('keyword search finds the item by Claude''s picture description',
  (select count(*) = 1 from search_items('falcon omni-channel')));
select pg_temp.check('keyword search finds the item by caption',
  (select count(*) = 1 from search_items('Tuesday workshop')));
select pg_temp.check('keyword search finds the item by a .vsd file name',
  (select count(*) = 1 from search_items('old vsd')));
select pg_temp.check('attachment text in a restricted space is never searched',
  (select count(*) = 0 from search_items('secret plan'))
  and (select count(*) = 0 from search_items('kestrel', null, null, pg_temp.get('pitem')::uuid)));

reset role;
update item_chunk set embedding = pg_temp.vec(9)::extensions.vector(384) where attachment_id is not null;
set local role authenticated;
select pg_temp.check('semantic search reaches attachment chunks, never in a restricted space',
  (select count(*) = 1 and bool_and(title = 'Teams routing design') from search_items(null, pg_temp.vec(9))));

-- ---------- get_item, get_attachment ----------
select pg_temp.check('get_item lists attachments with size, caption, description, Visio text',
  (select jsonb_array_length(g -> 'attachments') = 3
      and (select bool_or(a ->> 'extracted_text' like '%kestrel%') from jsonb_array_elements(g -> 'attachments') a)
      and (select bool_or(a ->> 'caption' = 'Photo from the Tuesday workshop') from jsonb_array_elements(g -> 'attachments') a)
   from get_item(pg_temp.get('item')::uuid) g));
select pg_temp.check('get_attachment returns the storage path in the owner''s folder',
  (select g ->> 'storage_key' like '00000000-0000-4000-a000-00000000000a/%/whiteboard.png'
   from get_attachment(pg_temp.get('png')::uuid) g));

-- ---------- user B: isolation ----------
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b', false);
set local role authenticated;

select pg_temp.check('B sees none of A''s attachments', (select count(*) = 0 from attachment));
select pg_temp.check('B sees none of A''s attachment chunks',
  (select count(*) = 0 from item_chunk where attachment_id is not null));
select pg_temp.check('B sees none of A''s Storage objects',
  (select count(*) = 0 from storage.objects where bucket_id = 'attachments'));
select pg_temp.check('B cannot get A''s attachment', (select get_attachment(pg_temp.get('png')::uuid) is null));
select pg_temp.check('B''s search finds nothing of A''s', (select count(*) = 0 from search_items('kestrel')));
do $$
begin
  perform create_attachment_upload(pg_temp.get('item')::uuid, null);
  perform pg_temp.check('B cannot create an upload link for A''s item', false, 'accepted');
exception when others then
  perform pg_temp.check('B cannot create an upload link for A''s item', sqlerrm = 'item not found', sqlerrm);
end $$;
do $$
begin
  perform delete_attachment(pg_temp.get('png')::uuid);
  perform pg_temp.check('B cannot delete A''s attachment', false, 'accepted');
exception when others then
  perform pg_temp.check('B cannot delete A''s attachment', sqlerrm = 'attachment not found', sqlerrm);
end $$;
do $$
begin
  perform set_attachment_description(pg_temp.get('png')::uuid, 'hijacked');
  perform pg_temp.check('B cannot describe A''s attachment', false, 'accepted');
exception when others then
  perform pg_temp.check('B cannot describe A''s attachment', sqlerrm = 'attachment not found', sqlerrm);
end $$;
do $$
begin
  delete from storage.objects where bucket_id = 'attachments';
exception when others then
  null;  -- newer Storage versions refuse direct deletes outright; either way nothing is removed
end $$;
reset role;
select pg_temp.check('B cannot delete A''s Storage objects',
  (select count(*) = 4 from storage.objects
   where bucket_id = 'attachments' and name like '00000000-0000-4000-a000-00000000000a/%'));

-- ---------- user A (MCP): describe, delete ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a', true);
set local role authenticated;

select set_attachment_description(pg_temp.get('vsd')::uuid, 'Legacy diagram of the lynx gateway');
select pg_temp.check('set_attachment_description re-indexes the file (pending chunks)',
  (select count(*) >= 1 and bool_and(embedding is null) and bool_or(content like '%lynx gateway%')
   from item_chunk where attachment_id = pg_temp.get('vsd')::uuid)
  and (select count(*) = 1 from search_items('lynx gateway')));

-- Separate statements: a check in the same statement would still see the pre-delete snapshot.
insert into _v select 'del', delete_attachment(pg_temp.get('vsdx')::uuid)::text;
select pg_temp.check('delete_attachment removes the row and its search text',
  (select (pg_temp.get('del')::jsonb ->> 'deleted')::boolean)
  and (select count(*) = 0 from attachment where id = pg_temp.get('vsdx')::uuid)
  and (select count(*) = 0 from item_chunk where attachment_id = pg_temp.get('vsdx')::uuid)
  and (select count(*) = 0 from search_items('kestrel')));

reset role;
