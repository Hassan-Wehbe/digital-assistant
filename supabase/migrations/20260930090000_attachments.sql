-- Phase 2, step 1: attachments (pictures and Visio). Plan: docs/phase2-attachments-plan.md.
--
-- Files travel like vault values: chat tools carry text, so the MCP server
-- creates a one-time upload link and the owner's browser sends the file
-- straight to Storage (docs/files/upload.html), then confirms it here.
--
--   * Storage: one private bucket, `attachments`, 20 MB per file, pictures
--     (PNG, JPEG) and Visio (.vsdx, .vsd) only. Object path
--     <user id>/<attachment id>/<file name>. A user reads and deletes only under
--     their own folder, and uploads only while one of their upload links is open
--     and only from a browser sign-in (not the Claude connector's token).
--   * attachment_upload_request: the link (15 minutes, single use, SHA-256 of
--     the token stored), the item it attaches to and Claude's description.
--   * attachment rows are written only by the functions below. Their searchable
--     text (file name, caption, Claude's description, Visio text) is chunked
--     here with embedding = null; the upload page then asks the MCP server's
--     /embed-pending to compute the embeddings (existing background indexing).
--   * search_items: keyword search also matches attachment text (semantic search
--     already covers every chunk of an item). Restricted spaces stay excluded:
--     an attachment is searched only through its item (CLAUDE.md rule 3).
--   * Nothing here references secret (rules 2, 4). Files are encrypted at rest
--     by Supabase, not end-to-end like the vault: they are knowledge, not credentials.

-- =========================================================
-- Tables
-- =========================================================

alter table attachment
  add column size_bytes     bigint,  -- from Storage's own record of the upload
  add column caption        text,    -- the owner's words, typed on the upload page
  add column extracted_text text;    -- text read out of a .vsdx on the upload page
comment on column attachment.extracted_description is
  'Description of a picture, written by Claude in the chat (never a credential)';

create table attachment_upload_request (
  id              uuid primary key default gen_random_uuid(),
  token_hash      bytea not null unique,
  user_id         uuid not null references app_user (id) on delete cascade,
  item_id         uuid not null references item (id) on delete cascade,
  description     text,             -- Claude's description of the picture shown in the chat
  expires_at      timestamptz not null default now() + interval '15 minutes',
  used_at         timestamptz,
  files_attached  int,
  created_at      timestamptz not null default now()
);
create index attachment_upload_request_user_idx on attachment_upload_request (user_id);
create index attachment_upload_request_item_idx on attachment_upload_request (item_id);

-- Reachable only through the functions below: RLS on, no policies.
alter table attachment_upload_request enable row level security;

-- =========================================================
-- Privileges
-- =========================================================

revoke all on attachment_upload_request from public, anon, authenticated;

-- attachment: readable by the owner (RLS policy attachment_owner); written only
-- by the functions below, which check the file really is in the owner's folder.
revoke all on attachment from anon;
revoke insert, update, delete on attachment from authenticated;
grant select on attachment to authenticated;

-- =========================================================
-- Storage: bucket and policies
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520,
        array['image/png', 'image/jpeg', 'application/vnd.ms-visio.drawing', 'application/vnd.visio'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Does the caller have an open upload link, in a browser session? Used by the
-- Storage insert policy, so a leaked connector token cannot upload files.
create or replace function _attachment_upload_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and (auth.jwt() ->> 'client_id') is null
     and exists (
       select 1 from public.attachment_upload_request q
       where q.user_id = auth.uid() and q.used_at is null and q.expires_at > now());
$$;
revoke execute on function _attachment_upload_open() from public, anon;
grant execute on function _attachment_upload_open() to authenticated;

create policy attachments_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and (select public._attachment_upload_open()));

create policy attachments_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy attachments_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No update policy: an uploaded file is never overwritten.

-- =========================================================
-- Internal helpers
-- =========================================================

-- Split text into chunks of at most p_max characters: whole lines where they
-- fit, long lines broken at a space. Same size as the MCP server's chunker.
create or replace function _chunk_text(p_text text, p_max int default 1000) returns setof text
language plpgsql immutable set search_path = '' as $$
declare
  v_cur  text := '';
  v_line text;
  v_head text;
  v_cut  int;
  v_sp   int;
begin
  for v_line in select btrim(l) from regexp_split_to_table(coalesce(p_text, ''), E'\n') l loop
    continue when v_line = '';
    if v_cur = '' and length(v_line) <= p_max then
      v_cur := v_line;
      continue;
    elsif length(v_cur) + 1 + length(v_line) <= p_max then
      v_cur := v_cur || E'\n' || v_line;
      continue;
    end if;
    if v_cur <> '' then
      return next v_cur;
      v_cur := '';
    end if;
    while length(v_line) > p_max loop
      v_head := left(v_line, p_max + 1);
      v_sp := position(' ' in reverse(v_head));
      v_cut := case when v_sp = 0 then p_max else length(v_head) - v_sp end;
      if v_cut < p_max / 2 then v_cut := p_max; end if;
      return next btrim(left(v_line, v_cut));
      v_line := btrim(substr(v_line, v_cut + 1));
    end loop;
    v_cur := v_line;
  end loop;
  if v_cur <> '' then
    return next v_cur;
  end if;
end;
$$;

-- The searchable text of one attachment.
create or replace function _attachment_text(a public.attachment) returns text
language sql immutable set search_path = '' as $$
  select concat_ws(E'\n', 'File: ' || a.original_filename, a.caption,
                   a.extracted_description, a.extracted_text);
$$;

-- Rebuild an attachment's chunks; embeddings are left pending for /embed-pending.
create or replace function _replace_attachment_chunks(p_attachment_id uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  a public.attachment;
  n int;
begin
  select * into a from public.attachment where id = p_attachment_id;
  delete from public.item_chunk where attachment_id = p_attachment_id;
  insert into public.item_chunk (item_id, attachment_id, chunk_index, content, embedding)
  select a.item_id, a.id, (c.ord - 1)::int, c.content, null
  from public._chunk_text(public._attachment_text(a)) with ordinality as c(content, ord);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- File name extension -> the only content type accepted for it.
create or replace function _attachment_mime(p_filename text) returns text
language sql immutable set search_path = '' as $$
  select case lower(substring(p_filename from '\.([A-Za-z0-9]+)$'))
    when 'png'  then 'image/png'
    when 'jpg'  then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'vsdx' then 'application/vnd.ms-visio.drawing'
    when 'vsd'  then 'application/vnd.visio'
  end;
$$;

-- Drop the caller's expired or used upload links (kept a day for troubleshooting).
create or replace function _attachment_sweep(p_user_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.attachment_upload_request
   where user_id = p_user_id and expires_at < now() - interval '1 day';
$$;

revoke execute on function
  _chunk_text(text, int), _attachment_text(public.attachment), _replace_attachment_chunks(uuid),
  _attachment_mime(text), _attachment_sweep(uuid)
  from public, anon, authenticated;

-- =========================================================
-- Upload links (MCP server creates, upload page reads and completes)
-- =========================================================

-- The item must already exist (attach_file creates a new one first, as save_item does).
create or replace function create_attachment_upload(p_item_id uuid, p_description text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_token text := public._vault_new_token();
  r       public.attachment_upload_request;
begin
  if not exists (
    select 1 from public.item i join public.space sp on sp.id = i.space_id
    where i.id = p_item_id and i.deleted_at is null and sp.owner_user_id = v_uid) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if length(p_description) > 4000 then
    raise exception 'description must be at most 4000 characters' using errcode = '22023';
  end if;
  perform public._attachment_sweep(v_uid);

  insert into public.attachment_upload_request (token_hash, user_id, item_id, description)
  values (public._vault_token_hash(v_token), v_uid, p_item_id, nullif(btrim(p_description), ''))
  returning * into r;
  return jsonb_build_object('token', v_token, 'expires_at', r.expires_at);
end;
$$;

-- What an upload link is for, without using it up. Browser sessions only.
create or replace function get_attachment_upload_request(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
  r     record;
begin
  select q.used_at, q.expires_at, q.description, i.id as item_id, i.title, sp.name as space_name
    into r
  from public.attachment_upload_request q
  join public.item i on i.id = q.item_id and i.deleted_at is null
  join public.space sp on sp.id = i.space_id and sp.owner_user_id = v_uid
  where q.token_hash = public._vault_token_hash(p_token) and q.user_id = v_uid;
  if not found or r.used_at is not null or r.expires_at <= now() then
    raise exception 'this link has expired or was already used; ask the assistant for a new one'
      using errcode = 'PT410';
  end if;
  return jsonb_build_object(
    'user_id', v_uid, 'item_id', r.item_id, 'item_title', r.title, 'space', r.space_name,
    'description', r.description, 'expires_at', r.expires_at,
    'max_files', 10, 'max_bytes', 20971520);
end;
$$;

-- Record the files the page uploaded, then use up the link.
--   p_files: [{"attachment_id": uuid, "filename": "Routing v2.vsdx",
--              "storage_name": "Routing_v2.vsdx", "caption": "...", "extracted_text": "..."}]
--   p_description_for: which file Claude's description belongs to (null: the
--   only picture, if there is exactly one).
-- Each file must already be in Storage at <caller>/<attachment_id>/<storage_name>,
-- with the content type that matches its extension. Size and type are taken from
-- Storage's record, not from the page.
create or replace function complete_attachment_upload(p_token text, p_files jsonb,
                                                      p_description_for uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := public._vault_require_browser_session();
  r        public.attachment_upload_request;
  f        jsonb;
  v_id     uuid;
  v_name   text;
  v_store  text;
  v_mime   text;
  v_key    text;
  o        record;
  v_desc   uuid := p_description_for;
  v_out    jsonb := '[]'::jsonb;
  v_chunks int := 0;
begin
  select * into r from public.attachment_upload_request
  where token_hash = public._vault_token_hash(p_token) and user_id = v_uid
  for update;
  if not found or r.used_at is not null or r.expires_at <= now() then
    raise exception 'this link has expired or was already used; ask the assistant for a new one'
      using errcode = 'PT410';
  end if;
  if not exists (
    select 1 from public.item i join public.space sp on sp.id = i.space_id
    where i.id = r.item_id and i.deleted_at is null and sp.owner_user_id = v_uid) then
    raise exception 'the item was deleted; ask the assistant for a new link' using errcode = 'PT404';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array'
     or jsonb_array_length(p_files) not between 1 and 10 then
    raise exception 'send 1 to 10 files' using errcode = '22023';
  end if;

  -- Claude's description goes to one picture: the one named, or the only one.
  if r.description is not null and v_desc is null then
    select (array_agg(x ->> 'attachment_id'))[1]::uuid into v_desc
    from jsonb_array_elements(p_files) x
    where public._attachment_mime(btrim(x ->> 'filename')) in ('image/png', 'image/jpeg')
    having count(*) = 1;
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    begin
      v_id := (f ->> 'attachment_id')::uuid;
    exception when others then
      raise exception 'attachment_id must be a uuid' using errcode = '22023';
    end;
    v_name  := btrim(f ->> 'filename');
    v_store := f ->> 'storage_name';
    v_mime  := public._attachment_mime(v_name);
    if v_id is null or v_name is null or v_name = '' or length(v_name) > 200 or v_name ~ '[/\\[:cntrl:]]' then
      raise exception 'each file needs an attachment_id and a file name (1-200 characters, no slashes)'
        using errcode = '22023';
    end if;
    if v_mime is null then
      raise exception '%: only .png, .jpg, .jpeg, .vsdx and .vsd files can be attached', v_name
        using errcode = '22023';
    end if;
    if v_store is null or v_store !~ '^[A-Za-z0-9._-]{1,120}$'
       or public._attachment_mime(v_store) is distinct from v_mime then
      raise exception '%: storage_name must be the file name''s safe form (same extension)', v_name
        using errcode = '22023';
    end if;
    if length(f ->> 'caption') > 1000 then
      raise exception '%: the caption must be at most 1000 characters', v_name using errcode = '22023';
    end if;
    if f ->> 'extracted_text' is not null
       and (v_mime <> 'application/vnd.ms-visio.drawing' or length(f ->> 'extracted_text') > 40000) then
      raise exception '%: extracted text is only for .vsdx files, at most 40000 characters', v_name
        using errcode = '22023';
    end if;

    v_key := v_uid::text || '/' || v_id::text || '/' || v_store;
    select ob.metadata into o
    from storage.objects ob
    where ob.bucket_id = 'attachments' and ob.name = v_key;
    if not found then
      raise exception '%: the file is not in storage (upload it first)', v_name using errcode = 'PT404';
    end if;
    if o.metadata ->> 'mimetype' is distinct from v_mime then
      raise exception '%: stored with the wrong content type', v_name using errcode = '22023';
    end if;

    insert into public.attachment (id, item_id, storage_key, original_filename, mime_type,
                                   size_bytes, caption, extracted_description, extracted_text)
    values (v_id, r.item_id, v_key, v_name, v_mime, (o.metadata ->> 'size')::bigint,
            nullif(btrim(f ->> 'caption'), ''),
            case when v_id = v_desc then r.description end,
            nullif(btrim(f ->> 'extracted_text'), ''));
    v_chunks := v_chunks + public._replace_attachment_chunks(v_id);
    v_out := v_out || jsonb_build_object('attachment_id', v_id, 'filename', v_name,
                                         'mime_type', v_mime,
                                         'described', coalesce(v_id = v_desc, false));
  end loop;

  update public.attachment_upload_request
     set used_at = now(), files_attached = jsonb_array_length(p_files)
   where id = r.id;
  return jsonb_build_object('item_id', r.item_id,
                            'item_title', (select title from public.item where id = r.item_id),
                            'attachments', v_out, 'chunks_pending', v_chunks);
end;
$$;

-- =========================================================
-- MCP tools: read, describe, delete
-- =========================================================

-- One attachment with its item. Works in restricted spaces (as get_item does).
create or replace function get_attachment(p_attachment_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'filename', a.original_filename, 'mime_type', a.mime_type,
    'size_bytes', a.size_bytes, 'caption', a.caption, 'description', a.extracted_description,
    'storage_key', a.storage_key, 'created_at', a.created_at,
    'item', jsonb_build_object('id', i.id, 'title', i.title))
  from attachment a
  join item i on i.id = a.item_id and i.deleted_at is null
  join space s on s.id = i.space_id and s.owner_user_id = auth.uid()
  where a.id = p_attachment_id;
$$;

-- Set or replace Claude's description of a picture, and re-index its text.
create or replace function set_attachment_description(p_attachment_id uuid, p_description text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_name text;
begin
  if length(p_description) > 4000 then
    raise exception 'description must be at most 4000 characters' using errcode = '22023';
  end if;
  update public.attachment a set extracted_description = nullif(btrim(p_description), '')
  from public.item i join public.space sp on sp.id = i.space_id
  where a.id = p_attachment_id and i.id = a.item_id and i.deleted_at is null
    and sp.owner_user_id = v_uid
  returning a.original_filename into v_name;
  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('attachment_id', p_attachment_id, 'filename', v_name,
                            'chunks_pending', public._replace_attachment_chunks(p_attachment_id));
end;
$$;

-- Remove the database row and its search text. The MCP server deletes the
-- Storage object first (Storage objects are removed through the Storage API).
create or replace function delete_attachment(p_attachment_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_name text;
  v_key  text;
begin
  delete from public.attachment a
  using public.item i, public.space sp
  where a.id = p_attachment_id and i.id = a.item_id and sp.id = i.space_id
    and sp.owner_user_id = v_uid
  returning a.original_filename, a.storage_key into v_name, v_key;
  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('attachment_id', p_attachment_id, 'filename', v_name,
                            'storage_key', v_key, 'deleted', true);
end;
$$;

-- =========================================================
-- get_item: richer attachment list (same signature and result type)
-- =========================================================

create or replace function get_item(p_item_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', i.id,
    'title', i.title,
    'item_type', i.item_type,
    'summary', i.summary,
    'body_markdown', i.body_markdown,
    'metadata', i.metadata,
    'source', i.source,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'space', jsonb_build_object('id', s.id, 'name', s.name, 'is_restricted', s.is_restricted),
    'tags', coalesce((
      select jsonb_agg(t.name order by t.name)
      from item_tag it join tag t on t.id = it.tag_id where it.item_id = i.id), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'filename', a.original_filename, 'mime_type', a.mime_type,
        'size_bytes', a.size_bytes, 'caption', a.caption, 'description', a.extracted_description,
        'extracted_text', left(a.extracted_text, 4000),
        'extracted_text_truncated', coalesce(length(a.extracted_text) > 4000, false),
        'created_at', a.created_at) order by a.created_at)
      from attachment a where a.item_id = i.id), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'direction', l.direction, 'relation', l.relation,
        'item_id', o.id, 'title', o.title, 'item_type', o.item_type) order by o.title)
      from (
        select 'outgoing' as direction, relation, to_item_id as other_id
        from item_link where from_item_id = i.id
        union all
        select 'incoming', relation, from_item_id
        from item_link where to_item_id = i.id
      ) l
      join item o on o.id = l.other_id and o.deleted_at is null
      where o.space_id in (select searchable_space_ids())), '[]'::jsonb),
    'revision_count', (select count(*) from item_revision r where r.item_id = i.id)
  )
  from item i join space s on s.id = i.space_id
  where i.id = p_item_id
    and i.deleted_at is null
    and s.owner_user_id = auth.uid();
$$;

-- =========================================================
-- search_items: keyword search also reads attachment text
-- (same signature and result type; only the keyword part changed)
-- =========================================================

create or replace function search_items(
  p_query           text default null,
  p_query_embedding text default null,
  p_tags            text[] default null,
  p_space_id        uuid default null,
  p_item_type       text default null,
  p_limit           int default 10
) returns table (
  item_id    uuid,
  title      text,
  item_type  text,
  space_id   uuid,
  snippet    text,
  tags       text[],
  score      double precision,
  updated_at timestamptz
)
language sql stable security invoker set search_path = public, extensions as $$
  with recursive
  scope as (
    select id from space where id = p_space_id
    union all
    select s.id from space s join scope sc on s.parent_id = sc.id
  ),
  tag_names as (
    select distinct lower(btrim(t)) as name
    from unnest(coalesce(p_tags, '{}')) t
    where btrim(t) <> ''
  ),
  candidates as (
    select i.* from item i
    where i.deleted_at is null
      and i.space_id in (select searchable_space_ids())
      and (p_space_id is null or i.space_id in (select id from scope))
      and (p_item_type is null or i.item_type = lower(btrim(p_item_type)))
      and not exists (
        select 1 from tag_names tn
        where not exists (
          select 1 from item_tag it join tag t on t.id = it.tag_id
          where it.item_id = i.id and t.name = tn.name))
  ),
  q as (
    select case when p_query_embedding is null then null
                else p_query_embedding::extensions.vector(384) end as emb,
           case when nullif(btrim(p_query), '') is null then null
                else websearch_to_tsquery('english', p_query) end as tsq
  ),
  chunk_hits as (
    select c.item_id, c.content, c.embedding <=> q.emb as dist
    from item_chunk c join candidates ca on ca.id = c.item_id, q
    where q.emb is not null and c.embedding is not null
  ),
  semantic as (
    select item_id,
           min(dist) as dist,
           (array_agg(content order by dist))[1] as best_chunk,
           row_number() over (order by min(dist)) as rnk
    from chunk_hits
    group by item_id
    order by min(dist)
    limit 50
  ),
  -- Attachment text per item: file names (with . _ - read as spaces), captions,
  -- Claude's descriptions and Visio text.
  attachment_text as (
    select a.item_id,
           string_agg(concat_ws(' ', a.original_filename,
                                regexp_replace(a.original_filename, '[._-]+', ' ', 'g'),
                                a.caption, a.extracted_description, a.extracted_text), ' ') as txt
    from attachment a join candidates ca on ca.id = a.item_id
    group by a.item_id
  ),
  keyword_docs as (
    select ca.id as item_id,
           to_tsvector('english', ca.title || ' ' || ca.body_markdown || ' ' || coalesce(att.txt, '')) as tsv
    from candidates ca left join attachment_text att on att.item_id = ca.id
  ),
  keyword as (
    select d.item_id,
           row_number() over (order by ts_rank_cd(d.tsv, q.tsq) desc) as rnk
    from keyword_docs d, q
    where q.tsq is not null and d.tsv @@ q.tsq
    order by rnk
    limit 50
  ),
  fused as (
    select coalesce(s.item_id, k.item_id) as item_id,
           coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as score,
           s.best_chunk
    from semantic s full outer join keyword k on k.item_id = s.item_id
  ),
  ranked as (
    -- With a query: fused ranking. Without one: most recently updated first.
    select f.item_id, f.score::double precision as score, f.best_chunk
    from fused f
    where p_query is not null or p_query_embedding is not null
    union all
    select ca.id, 0::double precision, null
    from candidates ca
    where p_query is null and p_query_embedding is null
  )
  select i.id, i.title, i.item_type, i.space_id,
         left(coalesce(r.best_chunk, i.summary, i.body_markdown), 300) as snippet,
         coalesce((select array_agg(t.name order by t.name)
                   from item_tag it join tag t on t.id = it.tag_id
                   where it.item_id = i.id), '{}') as tags,
         r.score,
         i.updated_at
  from ranked r join item i on i.id = r.item_id
  order by r.score desc, i.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- =========================================================
-- Grants (create or replace keeps existing grants; restated for the rule)
-- =========================================================

revoke execute on function
  create_attachment_upload(uuid, text), get_attachment_upload_request(text),
  complete_attachment_upload(text, jsonb, uuid), get_attachment(uuid),
  set_attachment_description(uuid, text), delete_attachment(uuid),
  get_item(uuid), search_items(text, text, text[], uuid, text, int)
  from public, anon;
grant execute on function
  create_attachment_upload(uuid, text), get_attachment_upload_request(text),
  complete_attachment_upload(text, jsonb, uuid), get_attachment(uuid),
  set_attachment_description(uuid, text), delete_attachment(uuid),
  get_item(uuid), search_items(text, text, text[], uuid, text, int)
  to authenticated;
