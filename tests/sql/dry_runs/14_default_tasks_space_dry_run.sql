-- DRY RUN of 20261010120000_default_tasks_space.sql with SQL test 14 (tests/sql/dry_run.sh). Paste ALL of it
-- into the Supabase SQL editor and run it. It ends with the error "DRY RUN RESULTS (rolled back): [...]"
-- on purpose: nothing is kept. Every item in that list must say "ok": true. Then apply the migration.
begin;
-- Every account has a Tasks space (owner, 2026-10-09). Until now the space was made by the first
-- task (mcp/lib/tasks.ts tasksSpace, which stays as the fallback when the space is renamed or
-- deleted). Now sign-up makes it, and accounts made before this get one now.
--
-- Same name and description as tasksSpace: "Tasks", "Things to do, with due dates", top level, not
-- restricted. An account that already has a top-level space called Tasks (any case) gets nothing:
-- tasksSpace uses that one. Safe to run twice.
--
-- handle_new_auth_user is the sign-up trigger's function (20260928120100_knowledge_path.sql); it
-- runs as its owner (security definer) with an empty search_path, so every name is qualified. The
-- app_user insert is unchanged. Nothing here grants anything: the function stays revoked from
-- public, anon and authenticated.

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_user (id, email, display_name)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  -- The Tasks space, owned by the new account (the ✅ Tasks tile's tasks go here by default).
  insert into public.space (owner_user_id, parent_id, name, description, is_restricted)
  select new.id, null, 'Tasks', 'Things to do, with due dates', false
  where exists (select 1 from public.app_user u where u.id = new.id)
    and not exists (
      select 1 from public.space s
      where s.owner_user_id = new.id and s.parent_id is null and lower(s.name) = 'tasks'
    );
  return new;
end;
$$;
revoke execute on function handle_new_auth_user() from public, anon, authenticated;

-- Accounts made before this migration.
insert into space (owner_user_id, parent_id, name, description, is_restricted)
select u.id, null, 'Tasks', 'Things to do, with due dates', false
from app_user u
where not exists (
  select 1 from space s
  where s.owner_user_id = u.id and s.parent_id is null and lower(s.name) = 'tasks'
);
-- Shared setup, pasted at the top of every test file (after `begin;`).
-- Creates two throwaway users inside the test transaction. Everything is
-- rolled back at the end of the file, so nothing persists in the project.

create temp table _results (n serial, test text, passed boolean, detail text);
grant insert, select on _results to authenticated, anon;
grant usage on sequence _results_n_seq to authenticated, anon;

create function pg_temp.check(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into _results (test, passed, detail) values (p_test, coalesce(p_ok, false), p_detail);
$$;

-- A 384-dim unit vector with a 1 at position k (as pgvector text).
create function pg_temp.vec(k int) returns text language sql immutable as $$
  select '[' || string_agg(case when g = k then '1' else '0' end, ',' order by g) || ']'
  from generate_series(1, 384) g;
$$;

create function pg_temp.chunks(p_content text, k int) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('content', p_content, 'embedding', pg_temp.vec(k)));
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'test-user-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'test-user-b@example.invalid', 'authenticated', 'authenticated');
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
select pg_temp.check('anon sees no space', (select count(*) = 0 from space));
reset role;
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
