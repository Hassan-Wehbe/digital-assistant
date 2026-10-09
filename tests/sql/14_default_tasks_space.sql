-- Test: every account has a Tasks space (20261010120000_default_tasks_space.sql). The setup's two
-- new users each get exactly one, top level, not restricted, with tasksSpace's description; each
-- sees only their own; it is an ordinary space (a task saves into it; it can be renamed); a person
-- who already had a "tasks" space gets no second one; and the backfill does not add duplicates.

select pg_temp.check('a new account gets one Tasks space',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and parent_id is null and name = 'Tasks'));
select pg_temp.check('it is top level, not restricted, with the description tasks use',
  (select bool_and(not is_restricted and description = 'Things to do, with due dates') from space
   where owner_user_id = '00000000-0000-4000-a000-00000000000a' and name = 'Tasks'));
select pg_temp.check('the other new account gets its own',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000b' and parent_id is null and name = 'Tasks'));

-- A person who already had a "tasks" space (any case) before signing up gets no second one.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000c', 'test-user-c@example.invalid', 'authenticated', 'authenticated');
select pg_temp.check('a third account gets one too',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'tasks'));
update space set name = 'tasks' where owner_user_id = '00000000-0000-4000-a000-00000000000c';
insert into space (owner_user_id, parent_id, name, description, is_restricted)
select u.id, null, 'Tasks', 'Things to do, with due dates', false
from app_user u
where not exists (select 1 from space s where s.owner_user_id = u.id and s.parent_id is null and lower(s.name) = 'tasks');
select pg_temp.check('the backfill adds no second Tasks space (any case)',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'tasks')
  and (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and name = 'Tasks'));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('a person sees only their own Tasks space',
  (select count(*) = 1 from space where lower(name) = 'tasks'));
select pg_temp.check('a task saves into it (an ordinary space)',
  (select save_item(p_space_id => (select id from space where name = 'Tasks'), p_item_type => 'task',
     p_title => 'Return the library books', p_metadata => '{"status":"open","priority":"normal"}'::jsonb) is not null));
update space set name = 'To do' where name = 'Tasks';
select pg_temp.check('the owner can rename it',
  (select count(*) = 1 from space where name = 'To do'));

reset role;
set local role anon;
do $$
begin
  perform count(*) from space;
  perform pg_temp.check('anon cannot read spaces', false, 'read allowed');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read spaces', true, sqlerrm);
end $$;
reset role;
