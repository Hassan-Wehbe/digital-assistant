-- Test: sharing spaces and notes (20261026130000_sharing.sql, docs/sharing-plan.md step 1, D32).
-- Three people: A shares, B receives, C is an outsider. Nothing shows before B accepts; view vs
-- edit; an editor's notes belong to the space's owner and say who added or changed them; restricted
-- spaces, Memories, Tasks, routines and secrets are never reachable; restricting ends sharing; end
-- dates, stop, leave, decline, block and report; the sharer never learns whether an email has an
-- account; limits; files of shared notes; account deletion; nothing for anon.

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.refused(text) to authenticated, anon;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000c', 'test-user-c@example.invalid', 'authenticated', 'authenticated');

create temp table _ids (k text primary key, id uuid);
grant select, insert, update on _ids to authenticated, anon;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select id from _ids where k = p $$;

-- ---------- A's spaces and notes ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
insert into space (name) values ('Family'), ('Private');
insert into _ids select 'family', id from space where name = 'Family';
insert into _ids select 'private', id from space where name = 'Private';
update space set is_restricted = true where id = pg_temp.id('private');
insert into space (name, parent_id) values ('Kids', pg_temp.id('family')), ('Hidden', pg_temp.id('family'));
insert into _ids select 'kids', id from space where name = 'Kids';
insert into _ids select 'hidden', id from space where name = 'Hidden';
update space set is_restricted = true where id = pg_temp.id('hidden');
insert into _ids select 'recipes', id from space where built_in = 'recipes';
insert into _ids select 'memories', id from space where built_in = 'memories';
insert into _ids select 'tasks', id from space where built_in = 'tasks';
insert into _ids values
  ('lasagna', save_item(pg_temp.id('family'), 'note', 'Lasagna night', 'Layers of pasta and ragu', null, '{}', '{dinner}', pg_temp.chunks('Lasagna night layers', 1))),
  ('school',  save_item(pg_temp.id('kids'), 'note', 'School run', 'Drop off at 8', null, '{}', '{}', pg_temp.chunks('School run drop off', 2))),
  ('plan',    save_item(pg_temp.id('hidden'), 'note', 'Hidden plan', 'Surprise party', null, '{}', '{}', pg_temp.chunks('Hidden plan surprise', 3))),
  ('diary',   save_item(pg_temp.id('private'), 'note', 'Diary', 'Dear diary', null, '{}', '{}', pg_temp.chunks('Diary dear', 4))),
  ('pasta',   save_item(pg_temp.id('recipes'), 'recipe', 'Pasta al limone', 'Lemon pasta', null, '{}', '{}', pg_temp.chunks('Pasta lemon', 5))),
  ('memory',  save_item(pg_temp.id('memories'), 'memory', 'Likes jazz', 'Likes jazz', null, '{}', '{}', pg_temp.chunks('jazz', 6))),
  ('routine', save_item(pg_temp.id('family'), 'routine', 'Weekend reset', 'Laundry', null, '{}', '{}', pg_temp.chunks('Weekend reset laundry', 7)));
reset role;
insert into secret (space_id, secret_type, name, payload_enc) values (pg_temp.id('family'), 'wifi', 'Family Wi-Fi', '\x00');
insert into attachment (id, item_id, storage_key, original_filename, mime_type)
values ('00000000-0000-4000-b000-000000000001', pg_temp.id('lasagna'), '00000000-0000-4000-a000-00000000000a/00000000-0000-4000-b000-000000000001/lasagna.jpg', 'lasagna.jpg', 'image/jpeg');
insert into storage.objects (bucket_id, name, owner_id) values
  ('attachments', '00000000-0000-4000-a000-00000000000a/00000000-0000-4000-b000-000000000001/lasagna.jpg', '00000000-0000-4000-a000-00000000000a');

-- ---------- Sharing: what can't be shared ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('a restricted space can''t be shared',
  pg_temp.refused($q$select share_space(pg_temp.id('private'), 'test-user-b@example.invalid')$q$) like 'Restricted spaces%');
select pg_temp.check('a space inside a restricted space can''t be shared',
  pg_temp.refused($q$select share_space(pg_temp.id('hidden'), 'test-user-b@example.invalid')$q$) like 'Restricted spaces%');
select pg_temp.check('Memories can''t be shared',
  pg_temp.refused($q$select share_space(pg_temp.id('memories'), 'test-user-b@example.invalid')$q$) like '%can''t be shared.');
select pg_temp.check('Tasks can''t be shared',
  pg_temp.refused($q$select share_space(pg_temp.id('tasks'), 'test-user-b@example.invalid')$q$) like '%can''t be shared.');
select pg_temp.check('a memory, a routine and a note in a restricted space can''t be shared on their own',
  pg_temp.refused($q$select share_item(pg_temp.id('memory'), 'test-user-b@example.invalid')$q$) like 'Notes in restricted%'
  and pg_temp.refused($q$select share_item(pg_temp.id('routine'), 'test-user-b@example.invalid')$q$) like 'Notes in restricted%'
  and pg_temp.refused($q$select share_item(pg_temp.id('diary'), 'test-user-b@example.invalid')$q$) like 'Notes in restricted%');
select pg_temp.check('not with yourself, not with a non-email, not ending in the past, only view or edit',
  pg_temp.refused($q$select share_space(pg_temp.id('family'), 'TEST-USER-A@example.invalid ')$q$) = 'That''s your own email.'
  and pg_temp.refused($q$select share_space(pg_temp.id('family'), 'not an email')$q$) like 'That doesn''t look%'
  and pg_temp.refused($q$select share_space(pg_temp.id('family'), 'x@example.invalid', 'view', now() - interval '1 day')$q$) like 'The end date%'
  and pg_temp.refused($q$select share_space(pg_temp.id('family'), 'x@example.invalid', 'admin')$q$) like 'permission must%');
select pg_temp.check('nobody writes the sharing tables directly',
  pg_temp.refused($q$insert into space_share (space_id, shared_by_user_id, shared_with_email, status) values (pg_temp.id('family'), auth.uid(), 'test-user-b@example.invalid', 'accepted')$q$) like 'permission denied%'
  and pg_temp.refused($q$insert into item_share (item_id, shared_by_user_id, shared_with_email, status) values (pg_temp.id('lasagna'), auth.uid(), 'test-user-b@example.invalid', 'accepted')$q$) like 'permission denied%'
  and pg_temp.refused($q$select * from space_share$q$) like 'permission denied%');

-- ---------- A invites B; nothing shows before B accepts ----------
insert into _ids select 'share_b', (share_space(pg_temp.id('family'), ' Test-User-B@Example.invalid', 'view') ->> 'share_id')::uuid;
select pg_temp.check('the answer is "sent" with a share id', pg_temp.id('share_b') is not null);
insert into _ids select 'share_nobody', (share_space(pg_temp.id('family'), 'nobody@example.invalid', 'view') ->> 'share_id')::uuid;
select pg_temp.check('an email with no account gets the same answer (Q2)',
  (select array_agg(k order by k) from jsonb_object_keys(share_space(pg_temp.id('family'), 'nobody@example.invalid')) k)
    = (select array_agg(k order by k) from jsonb_object_keys(share_space(pg_temp.id('family'), 'test-user-b@example.invalid')) k));
select pg_temp.check('sharing again with the same email adds no second invitation',
  (select count(*) = 2 from jsonb_array_elements(my_shares(pg_temp.id('family')))));
select pg_temp.check('the sharer sees both as "invited", the email only (Q2)',
  (select bool_and(x ->> 'status' = 'invited' and x -> 'person' = 'null'::jsonb) from jsonb_array_elements(my_shares(pg_temp.id('family'))) x)
  and (select count(*) = 1 from jsonb_array_elements(my_shares(pg_temp.id('family'))) x where x ->> 'email' = 'test-user-b@example.invalid'));
reset role;

select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select pg_temp.check('B sees the invitation: Family, from A, view',
  (select x ->> 'status' = 'invited' and x -> 'space' ->> 'name' = 'Family' and x -> 'from' ->> 'email' = 'test-user-a@example.invalid'
          and x ->> 'permission' = 'view' and x -> 'spaces' = 'null'::jsonb
   from jsonb_array_elements(shared_with_me()) x));
select pg_temp.check('before accepting, B finds nothing of A''s',
  not exists (select 1 from search_items('lasagna')) and not exists (select 1 from search_items(null, pg_temp.vec(1)))
  and get_item(pg_temp.id('lasagna')) is null);
select pg_temp.check('B can''t share A''s space onward, change or stop A''s share',
  pg_temp.refused($q$select share_space(pg_temp.id('family'), 'test-user-c@example.invalid')$q$) = 'space not found'
  and pg_temp.refused($q$select share_item(pg_temp.id('lasagna'), 'test-user-c@example.invalid')$q$) = 'item not found'
  and pg_temp.refused($q$select stop_share(pg_temp.id('share_b'))$q$) = 'share not found'
  and pg_temp.refused($q$select change_share(pg_temp.id('share_b'), 'edit')$q$) = 'share not found');
select respond_to_share(pg_temp.id('share_b'), 'accept');
select pg_temp.check('accepted: Family and its sub-space Kids, never the restricted Hidden',
  (select x ->> 'status' = 'accepted' and x -> 'spaces' @> '[{"name":"Kids"}]' and not x -> 'spaces' @> '[{"name":"Hidden"}]'
   from jsonb_array_elements(shared_with_me()) x));
select pg_temp.check('B''s search finds Lasagna, marked as A''s, view only',
  (select access = 'view' and shared_from ->> 'email' = 'test-user-a@example.invalid' from search_items('lasagna') where title = 'Lasagna night'));
select pg_temp.check('B''s search reaches the sub-space Kids',
  exists (select 1 from search_items('school') where title = 'School run'));
select pg_temp.check('never the restricted sub-space, the restricted space, Recipes, Memories or the routine (keyword)',
  not exists (select 1 from search_items('hidden')) and not exists (select 1 from search_items('diary'))
  and not exists (select 1 from search_items('limone')) and not exists (select 1 from search_items('jazz'))
  and not exists (select 1 from search_items('weekend')));
select pg_temp.check('nor by meaning: the nearest notes are only the two B may see (rule 3: no results, no counts)',
  exists (select 1 from search_items(null, pg_temp.vec(3)))
  and not exists (select 1 from (select title from search_items(null, pg_temp.vec(3), p_limit => 50) union all
                                 select title from search_items(null, pg_temp.vec(4), p_limit => 50) union all
                                 select title from search_items(null, pg_temp.vec(7), p_limit => 50)) x
                  where title not in ('Lasagna night', 'School run')));
select pg_temp.check('a listing of everything holds only Lasagna and School run',
  (select array_agg(title order by title) = '{"Lasagna night","School run"}' from search_items()));
select pg_temp.check('search within the shared space works',
  (select count(*) = 2 from search_items(p_space_id => pg_temp.id('family'))));
select pg_temp.check('get_item: access view, from A, the space''s name, A''s tags; no links',
  (select x ->> 'access' = 'view' and x -> 'shared' -> 'from' ->> 'email' = 'test-user-a@example.invalid'
          and x -> 'shared' ->> 'via' = 'space' and x -> 'space' ->> 'name' = 'Family' and x -> 'tags' = '["dinner"]'
          and x -> 'links' = '[]'
   from get_item(pg_temp.id('lasagna')) x));
select pg_temp.check('get_item gives nothing for the restricted, private, Recipes, memory or routine notes',
  get_item(pg_temp.id('plan')) is null and get_item(pg_temp.id('diary')) is null and get_item(pg_temp.id('pasta')) is null
  and get_item(pg_temp.id('memory')) is null and get_item(pg_temp.id('routine')) is null);
select pg_temp.check('view only: B can''t change, add or delete',
  pg_temp.refused($q$select update_item(pg_temp.id('lasagna'), p_title => 'x', p_chunks => '[]')$q$) = 'item not found'
  and pg_temp.refused($q$select save_item(pg_temp.id('family'), 'note', 'x')$q$) = 'space not found'
  and pg_temp.refused($q$select delete_item(pg_temp.id('lasagna'))$q$) like 'item not found%');
select pg_temp.check('the tables themselves still show B nothing of A''s (planners, suggestions, memory: Q7)',
  not exists (select 1 from item where title = 'Lasagna night') and not exists (select 1 from space where name = 'Family')
  and not exists (select 1 from item_chunk c join item i on i.id = c.item_id));
select pg_temp.check('rule 4: the Wi-Fi password in the shared space stays A''s alone',
  not exists (select 1 from secret) and not exists (select 1 from search_items('wi-fi')));
select pg_temp.check('the shared note''s file: details and the stored file are readable',
  get_attachment('00000000-0000-4000-b000-000000000001') ->> 'filename' = 'lasagna.jpg'
  and exists (select 1 from storage.objects where name like '%/lasagna.jpg'));
reset role;

select pg_temp.as_user('00000000-0000-4000-a000-00000000000c');
set local role authenticated;
select pg_temp.check('C, an outsider: no invitation, nothing found, nothing readable',
  shared_with_me() = '[]' and not exists (select 1 from search_items('lasagna'))
  and get_item(pg_temp.id('lasagna')) is null and get_attachment('00000000-0000-4000-b000-000000000001') is null
  and not exists (select 1 from storage.objects));
select pg_temp.check('C can''t accept, leave, block or report B''s share',
  pg_temp.refused($q$select respond_to_share(pg_temp.id('share_b'), 'accept')$q$) = 'share not found'
  and pg_temp.refused($q$select respond_to_share(pg_temp.id('share_b'), 'leave')$q$) = 'share not found'
  and pg_temp.refused($q$select report_share(pg_temp.id('share_b'), 'spam')$q$) = 'share not found');
reset role;

-- ---------- Edit ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('A sees B accepted, by name', (select x ->> 'status' = 'accepted' and x -> 'person' ->> 'email' = 'test-user-b@example.invalid'
  from jsonb_array_elements(my_shares(pg_temp.id('family'))) x where x ->> 'email' = 'test-user-b@example.invalid'));
select change_share(pg_temp.id('share_b'), 'edit');
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select update_item(pg_temp.id('lasagna'), p_title => 'Lasagna Friday', p_chunks => pg_temp.chunks('Lasagna Friday', 1), p_tags => '{mine}');
select pg_temp.check('an editor changes a note; the tags stay the owner''s',
  (select x ->> 'title' = 'Lasagna Friday' and x ->> 'access' = 'edit' and x -> 'tags' = '["dinner"]' from get_item(pg_temp.id('lasagna')) x));
insert into _ids values ('added', save_item(pg_temp.id('kids'), 'note', 'Swim kit', 'Towel, goggles', null, '{}', '{b-tag}', pg_temp.chunks('Swim kit', 8)));
select pg_temp.check('an editor adds a note to a shared sub-space; no tags of their own',
  (select x ->> 'title' = 'Swim kit' and x -> 'tags' = '[]' from get_item(pg_temp.id('added')) x));
select pg_temp.check('an editor can''t move a note, nor add a routine',
  pg_temp.refused($q$select update_item(pg_temp.id('lasagna'), p_space_id => pg_temp.id('kids'))$q$) = 'Only the owner can move this note.'
  and pg_temp.refused($q$select update_item(pg_temp.id('lasagna'), p_space_id => (select id from space where built_in = 'recipes'))$q$) = 'Only the owner can move this note.'
  and pg_temp.refused($q$select save_item(pg_temp.id('family'), 'routine', 'x')$q$) like 'Routines can''t%');
select pg_temp.check('nor add to the restricted sub-space under the shared one',
  pg_temp.refused($q$select save_item(pg_temp.id('hidden'), 'note', 'x')$q$) = 'space not found');
select pg_temp.check('an editor''s Home note never changes A''s homes',
  save_item(pg_temp.id('family'), 'place', 'Home', '', null, '{"kind":"home","lat":33.9,"lng":35.5}', '{}', '[]') is not null);
select pg_temp.check('an editor moves a note to the bin', (delete_item(pg_temp.id('added')) ->> 'in_recycle_bin')::boolean);
select pg_temp.check('restoring and purging stay the owner''s',
  pg_temp.refused($q$select restore_item(pg_temp.id('added'))$q$) like 'item not found%'
  and pg_temp.refused($q$select purge_item(pg_temp.id('added'))$q$) like 'item not found%'
  and get_item(pg_temp.id('added')) is null);
reset role;
select pg_temp.check('A''s homes are untouched', not exists (select 1 from home_place where user_id = '00000000-0000-4000-a000-00000000000a'));
select pg_temp.check('the editor''s note belongs to A''s space, added by B',
  (select s.owner_user_id = '00000000-0000-4000-a000-00000000000a' and i.created_by = '00000000-0000-4000-a000-00000000000b'
   from item i join space s on s.id = i.space_id where i.id = pg_temp.id('added')));
select pg_temp.check('the earlier version is kept (rule 7), written by A; the note now changed by B',
  (select r.title = 'Lasagna night' and r.edited_by = '00000000-0000-4000-a000-00000000000a' from item_revision r where r.item_id = pg_temp.id('lasagna'))
  and (select updated_by = '00000000-0000-4000-a000-00000000000b' from item where id = pg_temp.id('lasagna')));
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('A sees "changed by B" on Lasagna and B''s note in A''s bin, "deleted by B"',
  (select get_item(pg_temp.id('lasagna')) -> 'changed_by' ->> 'email' = 'test-user-b@example.invalid')
  and (select x -> 'deleted_by' ->> 'email' = 'test-user-b@example.invalid' from jsonb_array_elements(list_deleted_items()) x where x ->> 'title' = 'Swim kit'));
select restore_item(pg_temp.id('added'));
select pg_temp.check('A restores it: "added by B"; A''s own notes say nothing',
  (select get_item(pg_temp.id('added')) -> 'added_by' ->> 'email' = 'test-user-b@example.invalid')
  and get_item(pg_temp.id('school')) -> 'added_by' = 'null'::jsonb and get_item(pg_temp.id('school')) ->> 'access' = 'owner');
insert into _ids values ('direct', save_item(pg_temp.id('family'), 'note', 'Direct'));
select pg_temp.check('A''s own save records A as the one who added it',
  (select created_by = '00000000-0000-4000-a000-00000000000a' from item where id = pg_temp.id('direct')));
insert into item (space_id, item_type, title, created_by, updated_by) values (pg_temp.id('family'), 'note', 'Spoof', '00000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-00000000000b');
update item set created_by = '00000000-0000-4000-a000-00000000000b' where title = 'Direct';
select pg_temp.check('... neither inserting nor updating directly',
  (select created_by = '00000000-0000-4000-a000-00000000000a' and updated_by is null from item where title = 'Spoof')
  and (select created_by = '00000000-0000-4000-a000-00000000000a' from item where title = 'Direct'));
select pg_temp.check('A''s own search still finds A''s notes as the owner',
  (select bool_and(access = 'owner' and shared_from is null) from search_items('lasagna')) and exists (select 1 from search_items('lasagna')));

-- ---------- Restricting ends sharing (rule 3, Q9) ----------
update space set is_restricted = true where id = pg_temp.id('kids');
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select pg_temp.check('a sub-space restricted later disappears for B at once',
  not exists (select 1 from search_items('school')) and get_item(pg_temp.id('school')) is null
  and exists (select 1 from search_items('lasagna')));
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
update space set is_restricted = true where id = pg_temp.id('family');
update space set is_restricted = false where id = pg_temp.id('family');
reset role;
select pg_temp.check('restricting Family ended its shares (and stays ended)',
  (select bool_and(revoked_at is not null and ended_reason = 'restricted') from space_share where space_id = pg_temp.id('family')));
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select pg_temp.check('B sees nothing of Family now', not exists (select 1 from search_items()) and shared_with_me() = '[]');
reset role;

-- ---------- One note ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
insert into _ids select 'note_b', (share_item(pg_temp.id('pasta'), 'test-user-b@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select respond_to_share(pg_temp.id('note_b'), 'accept');
select pg_temp.check('a shared note: found and readable, its space not named, nothing else of Recipes',
  (select x ->> 'access' = 'view' and x -> 'shared' ->> 'via' = 'note' and x -> 'space' = 'null'::jsonb from get_item(pg_temp.id('pasta')) x)
  and (select array_agg(title) = '{"Pasta al limone"}' from search_items()));
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select update_item(pg_temp.id('pasta'), p_space_id => pg_temp.id('private'));
reset role;
select pg_temp.check('moving the note into a restricted space ended its share',
  (select revoked_at is not null and ended_reason = 'restricted' from item_share where id = pg_temp.id('note_b')));
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select pg_temp.check('... and B no longer reaches it', get_item(pg_temp.id('pasta')) is null and not exists (select 1 from search_items()));
reset role;

-- ---------- End dates, stop, leave, decline, block, report ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
insert into space (name) values ('Garden');
insert into _ids select 'garden', id from space where name = 'Garden';
insert into _ids values ('roses', save_item(pg_temp.id('garden'), 'note', 'Roses', 'Prune in March', null, '{}', '{}', pg_temp.chunks('Roses prune', 9)));
insert into _ids select 'garden_b', (share_space(pg_temp.id('garden'), 'test-user-b@example.invalid', 'view', now() + interval '1 day') ->> 'share_id')::uuid;
insert into _ids select 'garden_c', (share_space(pg_temp.id('garden'), 'test-user-c@example.invalid', 'edit') ->> 'share_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select respond_to_share(pg_temp.id('garden_b'), 'accept');
select pg_temp.check('B reaches Garden until its end date', exists (select 1 from search_items('roses')));
reset role;
update space_share set expires_at = now() - interval '1 minute' where id = pg_temp.id('garden_b');
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select pg_temp.check('after the end date: nothing, by itself', not exists (select 1 from search_items('roses')) and get_item(pg_temp.id('roses')) is null);
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000c');
set local role authenticated;
select pg_temp.check('C declines', respond_to_share(pg_temp.id('garden_c'), 'decline') ->> 'done' = 'decline');
select pg_temp.check('a declined invitation can''t be accepted later', pg_temp.refused($q$select respond_to_share(pg_temp.id('garden_c'), 'accept')$q$) = 'This invitation has ended.');
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('the sharer still reads "invited" after a decline (Q2)',
  (select x ->> 'status' = 'invited' from jsonb_array_elements(my_shares(pg_temp.id('garden'))) x where x ->> 'email' = 'test-user-c@example.invalid'));
select share_space(pg_temp.id('garden'), 'test-user-c@example.invalid', 'edit');
select pg_temp.check('re-inviting after a decline sends nothing new',
  (select count(*) = 1 from jsonb_array_elements(my_shares(pg_temp.id('garden'))) x where x ->> 'email' = 'test-user-c@example.invalid'));
insert into _ids select 'garden_b2', (share_space(pg_temp.id('garden'), 'test-user-b@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
select pg_temp.check('a share past its end date stays ended; sharing again is a new invitation',
  pg_temp.id('garden_b2') <> pg_temp.id('garden_b')
  and (select ended_reason = 'expired' from space_share where id = pg_temp.id('garden_b'))
  and (select status = 'invited' from space_share where id = pg_temp.id('garden_b2')));
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select respond_to_share(pg_temp.id('garden_b2'), 'accept');
select pg_temp.check('B leaves', respond_to_share(pg_temp.id('garden_b2'), 'leave') ->> 'done' = 'leave');
select pg_temp.check('... gone at once', not exists (select 1 from search_items('roses')));
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('A no longer lists B for Garden', not exists (select 1 from jsonb_array_elements(my_shares(pg_temp.id('garden'))) x where x ->> 'email' = 'test-user-b@example.invalid'));
insert into _ids select 'garden_b3', (share_space(pg_temp.id('garden'), 'test-user-b@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select respond_to_share(pg_temp.id('garden_b3'), 'accept');
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select stop_share(pg_temp.id('garden_b3'));
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select pg_temp.check('A stops sharing: gone for B at once', not exists (select 1 from search_items('roses')) and shared_with_me() = '[]');
reset role;

-- Block and report.
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
insert into space (name) values ('Trips');
insert into _ids select 'trips', id from space where name = 'Trips';
insert into _ids select 'trips_c', (share_space(pg_temp.id('trips'), 'test-user-c@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000c');
set local role authenticated;
select pg_temp.check('C reports the invitation: kept with a reason only',
  report_share(pg_temp.id('trips_c'), 'Not someone I know') ->> 'reported' = 'true');
select pg_temp.check('a reason over 500 characters is refused',
  pg_temp.refused(format('select report_share(%L, %L)', pg_temp.id('trips_c'), repeat('x', 501))) like 'Please keep%');
select respond_to_share(pg_temp.id('trips_c'), 'block');
select pg_temp.check('C blocked A: no invitations from A, and A is listed under blocks',
  shared_with_me() = '[]' and (select my_blocks() -> 0 -> 'person' ->> 'email' = 'test-user-a@example.invalid'));
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('A can still "send" to C, and the answer gives nothing away (Q2)',
  share_space(pg_temp.id('garden'), 'test-user-c@example.invalid', 'view') ? 'share_id'
  and (select bool_and(x ->> 'status' = 'invited') from jsonb_array_elements(my_shares(pg_temp.id('trips'))) x));
insert into _ids select 'trips_c2', (share_item(pg_temp.id('roses'), 'test-user-c@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000c');
set local role authenticated;
select pg_temp.check('... and C sees none of it', shared_with_me() = '[]'
  and pg_temp.refused($q$select respond_to_share(pg_temp.id('trips_c2'), 'accept')$q$) = 'share not found');
select pg_temp.check('reports and blocks are not readable directly',
  pg_temp.refused($q$select * from share_report$q$) like 'permission denied%' and pg_temp.refused($q$select * from share_block$q$) like 'permission denied%');
select pg_temp.check('only an admin reads reports', pg_temp.refused($q$select admin_share_reports()$q$) = 'admin only');
select unblock_sharer('00000000-0000-4000-a000-00000000000a');
select pg_temp.check('after unblocking, what A sent while blocked stays hidden',
  my_blocks() = '[]' and shared_with_me() = '[]');
reset role;
update app_user set is_admin = true where id = '00000000-0000-4000-a000-00000000000c';
select pg_temp.as_user('00000000-0000-4000-a000-00000000000c');
set local role authenticated;
select pg_temp.check('the admin sees the report: who, whom, which share, the reason',
  (select x ->> 'reason' = 'Not someone I know' and x -> 'reported' ->> 'email' = 'test-user-a@example.invalid' and x ->> 'share_kind' = 'space'
   from jsonb_array_elements(admin_share_reports()) x));
reset role;
update app_user set is_admin = false where id = '00000000-0000-4000-a000-00000000000c';

-- ---------- Invitations to someone who signs up later; lapsed invitations ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
insert into _ids select 'later', (share_space(pg_temp.id('trips'), 'later-user@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000d', 'later-user@example.invalid', 'authenticated', 'authenticated');
select pg_temp.as_user('00000000-0000-4000-a000-00000000000d');
set local role authenticated;
select pg_temp.check('someone who signs up later finds the invitation and can accept it',
  jsonb_array_length(shared_with_me()) = 1 and respond_to_share(pg_temp.id('later'), 'accept') ->> 'done' = 'accept');
reset role;
update space_share set created_at = now() - interval '31 days' where id = pg_temp.id('garden_c');
update space_share set status = 'invited', created_at = now() - interval '31 days' where id = pg_temp.id('trips_c');
delete from share_block;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000c');
set local role authenticated;
select pg_temp.check('an invitation not answered in 30 days lapses',
  shared_with_me() = '[]' and pg_temp.refused($q$select respond_to_share(pg_temp.id('trips_c'), 'accept')$q$) = 'This invitation has ended.');
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('the sharer sees it lapsed', (select x ->> 'status' = 'invitation_lapsed' from jsonb_array_elements(my_shares(pg_temp.id('trips'))) x
  where x ->> 'email' = 'test-user-c@example.invalid'));

-- ---------- Limits (Q13) ----------
reset role;
update space_share set created_at = now() - interval '2 days' where shared_by_user_id = '00000000-0000-4000-a000-00000000000a' and created_at > now() - interval '1 day';
update item_share set created_at = now() - interval '2 days' where shared_by_user_id = '00000000-0000-4000-a000-00000000000a';
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select share_space(case when g <= 10 then pg_temp.id('garden') else pg_temp.id('trips') end, format('friend%s@example.invalid', g))
from generate_series(1, 19) g;
select pg_temp.check('20 invitations a day: the 20th goes, the 21st doesn''t',
  share_space(pg_temp.id('garden'), 'friend20@example.invalid') ? 'share_id'
  and pg_temp.refused($q$select share_space(pg_temp.id('garden'), 'friend21@example.invalid')$q$) like 'You''ve sent 20 invitations today%');
reset role;
update space_share set created_at = now() - interval '2 days' where shared_by_user_id = '00000000-0000-4000-a000-00000000000a';
insert into space_share (space_id, shared_by_user_id, shared_with_email, created_at)
select pg_temp.id('trips'), '00000000-0000-4000-a000-00000000000a', format('pal%s@example.invalid', g), now() - interval '2 days'
from generate_series(1, 20 - (select count(*) from space_share where space_id = pg_temp.id('trips') and revoked_at is null)::int) g;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('20 people per space',
  pg_temp.refused($q$select share_space(pg_temp.id('trips'), 'one-too-many@example.invalid')$q$) = 'This space is already shared with 20 people.');
reset role;

-- ---------- Rule 4 in the schema; account deletion; anon ----------
select pg_temp.check('no sharing table has a key into secret, and no new function reads it',
  not exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid in ('space_share'::regclass, 'item_share'::regclass, 'share_block'::regclass, 'share_report'::regclass)
              and c.confrelid in ('secret'::regclass, 'secret_access_log'::regclass))
  and not exists (select 1 from pg_proc p where p.proname in ('share_space', 'share_item', 'my_shares', 'shared_with_me', 'respond_to_share',
       'change_share', 'stop_share', 'report_share', '_shared_spaces', '_item_access', 'search_items', 'get_item', 'save_item', 'update_item')
       and p.prosrc ilike '%secret%'));
select pg_temp.check('the internal helpers are not callable by users',
  not has_function_privilege('authenticated', '_item_access(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', '_shared_spaces(uuid)', 'execute')
  and not has_function_privilege('authenticated', '_person(uuid)', 'execute'));
delete from auth.users where id = '00000000-0000-4000-a000-00000000000b';
select pg_temp.check('B''s account deleted: B''s shares are gone; the note B added stays A''s, naming nobody',
  not exists (select 1 from space_share where shared_with_user_id = '00000000-0000-4000-a000-00000000000b')
  and not exists (select 1 from item_share where shared_with_user_id = '00000000-0000-4000-a000-00000000000b')
  and (select created_by is null from item where id = pg_temp.id('added')));
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.check('anon can do none of it',
  pg_temp.refused($q$select shared_with_me()$q$) like 'permission denied%'
  and pg_temp.refused($q$select share_space(gen_random_uuid(), 'x@example.invalid')$q$) like 'permission denied%'
  and pg_temp.refused($q$select respond_to_share(gen_random_uuid(), 'accept')$q$) like 'permission denied%'
  and pg_temp.refused($q$select search_items('lasagna')$q$) like 'permission denied%');
reset role;
