-- Test: built-in spaces and the memory switch (20261012120000_memory_builtin_spaces.sql,
-- docs/memory-plan.md Q3, Q4, Q8). Every account has one Tasks and one Memories space, marked
-- built-in; nobody can delete, rename, move or restrict them, or mark their own; the description
-- and the notes inside stay the user's; memory notes save, keep revisions and go to the bin;
-- memory_on is off by default and each person changes only their own; deleting the account still
-- removes everything.

-- ---- Made for every account ----
select pg_temp.check('a new account gets a built-in Tasks space',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'tasks'
     and name = 'Tasks' and parent_id is null and not is_restricted));
select pg_temp.check('and a built-in Memories space',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'memories'
     and name = 'Memories' and description = 'What Wilma remembered about you' and parent_id is null and not is_restricted));
select pg_temp.check('the other account gets its own two',
  (select count(*) = 2 from space where owner_user_id = '00000000-0000-4000-a000-00000000000b' and built_in is not null));
select pg_temp.check('memory is off by default',
  (select bool_and(not memory_on) from app_user));

-- ---- The migration's backfill, for accounts made before it (run as the owner) ----
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000c', 'test-user-c@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000d', 'test-user-d@example.invalid', 'authenticated', 'authenticated');
-- C, as before the migration: a Tasks space renamed to "To do", and their own "memories" space.
update space set built_in = null where owner_user_id = '00000000-0000-4000-a000-00000000000c';
delete from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'Memories';
update space set name = 'To do' where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'Tasks';
insert into space (owner_user_id, parent_id, name, description, is_restricted)
values ('00000000-0000-4000-a000-00000000000c', null, 'memories', 'mine', false);
-- D, as before the migration: a restricted "Memories" of their own.
update space set built_in = null where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in = 'memories';
update space set is_restricted = true where owner_user_id = '00000000-0000-4000-a000-00000000000d' and name = 'Memories';

select _ensure_built_in_spaces(u.id) from app_user u;
select _ensure_built_in_spaces(u.id) from app_user u;  -- twice: nothing more

select pg_temp.check('a renamed Tasks space stays the user''s; a new built-in Tasks is made',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'To do' and built_in is null)
  and (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'Tasks' and built_in = 'tasks'));
select pg_temp.check('the user''s own top-level "memories" is marked, not duplicated',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'memories')
  and (select built_in = 'memories' and description = 'mine' from space
       where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'memories'));
select pg_temp.check('a restricted "Memories" is left alone and never marked',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and name = 'Memories' and is_restricted and built_in is null)
  and not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in = 'memories'));
select pg_temp.check('run twice, still one of each per account',
  (select bool_and(n = 1) from (select count(*) n from space where built_in is not null group by owner_user_id, built_in) x));
select pg_temp.check('a second built-in of a kind is impossible',
  (select count(*) = 1 from pg_indexes where indexname = 'space_built_in_once'));

-- ---- As user A ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('A sees only their own built-in spaces, with the mark',
  (select count(*) = 2 and bool_and(owner_user_id = '00000000-0000-4000-a000-00000000000a') from space where built_in is not null));

create temp table _ids as
select (select id from space where built_in = 'tasks') tasks,
       (select id from space where built_in = 'memories') memories;
insert into space (owner_user_id, parent_id, name) values ('00000000-0000-4000-a000-00000000000a', null, 'Recipes');
update _ids set tasks = tasks;  -- (A may write their temp table)

do $$
begin
  delete from space where id = (select tasks from _ids);
  perform pg_temp.check('Tasks cannot be deleted', false, 'deleted');
exception when others then
  perform pg_temp.check('Tasks cannot be deleted', sqlerrm = '"Tasks" is a built-in space, so it can''t be deleted.', sqlerrm);
end $$;
do $$
begin
  perform delete_space((select memories from _ids));
  perform pg_temp.check('Memories cannot be deleted, not even empty, through delete_space', false, 'deleted');
exception when others then
  perform pg_temp.check('Memories cannot be deleted, not even empty, through delete_space', sqlerrm like '%built-in space%', sqlerrm);
end $$;
do $$
begin
  update space set name = 'Brain' where id = (select memories from _ids);
  perform pg_temp.check('it cannot be renamed', false, 'renamed');
exception when others then
  perform pg_temp.check('it cannot be renamed', sqlerrm like '%can''t be renamed%', sqlerrm);
end $$;
do $$
begin
  update space set parent_id = (select id from space where name = 'Recipes') where id = (select tasks from _ids);
  perform pg_temp.check('it cannot be moved', false, 'moved');
exception when others then
  perform pg_temp.check('it cannot be moved', sqlerrm like '%can''t be moved%', sqlerrm);
end $$;
do $$
begin
  update space set is_restricted = true where id = (select memories from _ids);
  perform pg_temp.check('it cannot be restricted', false, 'restricted');
exception when others then
  perform pg_temp.check('it cannot be restricted', sqlerrm like '%can''t be restricted%', sqlerrm);
end $$;
do $$
begin
  update space set built_in = null where id = (select tasks from _ids);
  perform pg_temp.check('its mark cannot be removed', false, 'unmarked');
exception when others then
  perform pg_temp.check('its mark cannot be removed', sqlerrm like '%Only Wilma%', sqlerrm);
end $$;
do $$
begin
  update space set built_in = 'memories' where name = 'Recipes';
  perform pg_temp.check('a person cannot mark their own space built-in', false, 'marked');
exception when others then
  perform pg_temp.check('a person cannot mark their own space built-in', sqlerrm like '%Only Wilma%', sqlerrm);
end $$;
do $$
begin
  insert into space (owner_user_id, parent_id, name, built_in) values ('00000000-0000-4000-a000-00000000000a', null, 'Brain', 'memories');
  perform pg_temp.check('a person cannot make a built-in space', false, 'made');
exception when others then
  perform pg_temp.check('a person cannot make a built-in space', sqlerrm like '%Only Wilma%', sqlerrm);
end $$;

update space set description = 'Things I keep forgetting' where id = (select memories from _ids);
select pg_temp.check('its description can change',
  (select description = 'Things I keep forgetting' from space where id = (select memories from _ids)));
update space set name = 'Cooking' where name = 'Recipes';
select pg_temp.check('an ordinary space is unaffected: renamed',
  (select count(*) = 1 from space where name = 'Cooking'));
select pg_temp.check('and deleted',
  (select (delete_space((select id from space where name = 'Cooking')) ->> 'deleted')::boolean));

-- ---- Memory notes ----
select pg_temp.check('a memory saves into Memories',
  (select save_item(p_space_id => (select memories from _ids), p_item_type => 'memory',
     p_title => 'Lexi swims on Tuesdays', p_metadata => '{"source":"chat","on":"2026-10-10"}'::jsonb) is not null));
update item set title = 'Lexi swims on Wednesdays' where item_type = 'memory';
select pg_temp.check('a changed memory keeps the old version in item_revision',
  (select count(*) = 1 from item_revision r join item i on i.id = r.item_id
   where i.item_type = 'memory' and r.title = 'Lexi swims on Tuesdays'));
select pg_temp.check('a memory goes to the recycle bin like any note',
  (select (delete_item((select id from item where item_type = 'memory')) ->> 'in_recycle_bin')::boolean));

-- ---- The switch ----
select pg_temp.check('A reads their own switch',
  (select memory_on = false from app_user where id = '00000000-0000-4000-a000-00000000000a'));
update app_user set memory_on = true where id = '00000000-0000-4000-a000-00000000000a';
select pg_temp.check('A turns memory on',
  (select memory_on from app_user where id = '00000000-0000-4000-a000-00000000000a'));
update app_user set memory_on = true where id = '00000000-0000-4000-a000-00000000000b';
reset role;
select pg_temp.check('A cannot change B''s switch',
  (select not memory_on from app_user where id = '00000000-0000-4000-a000-00000000000b'));

set local role anon;
do $$
begin
  perform memory_on from app_user;
  perform pg_temp.check('anon cannot read the switch', false, 'read allowed');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read the switch', true, sqlerrm);
end $$;
reset role;

-- ---- Deleting the account still removes everything ----
delete from auth.users where id = '00000000-0000-4000-a000-00000000000b';
select pg_temp.check('deleting an account removes its built-in spaces too',
  not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000b'));
