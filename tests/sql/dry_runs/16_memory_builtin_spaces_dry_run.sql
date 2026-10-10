-- DRY RUN of 20261012120000_memory_builtin_spaces.sql with SQL test 16 (tests/sql/dry_run.sh). Paste ALL of it
-- into the Supabase SQL editor and run it. It ends with the error "DRY RUN RESULTS (rolled back): [...]"
-- on purpose: nothing is kept. Every item in that list must say "ok": true. Then apply the migration.
begin;
-- Automatic memory, step 1 (docs/memory-plan.md, owner 2026-10-10): built-in spaces, the Memories
-- space, and the memory switch.
--
--   * space.built_in: 'tasks' or 'memories' on each account's built-in spaces, null on the user's
--     own. At most one of each per account. Set only here and at sign-up, never by the user.
--   * space_built_in_guard: a built-in space cannot be deleted, renamed, moved or restricted, by
--     anyone (the app, the chat, the Claude connector, the SQL editor as a user). Its description
--     can change, and the notes inside stay the user's. Deleting the whole account still removes it
--     (the account's app_user row is gone by then).
--   * Every account gets a Memories space ("What Wilma remembered about you"), top level, not
--     restricted, and its Tasks space is marked built-in: the oldest top-level, not restricted
--     space called Tasks (any case), the one 20261010120000_default_tasks_space.sql made; an
--     account without one (renamed or deleted since) gets a new one. A top-level "Memories" the
--     user already made is marked rather than duplicated. Safe to run twice.
--   * app_user.memory_on: off by default (Q3); each user reads and changes only their own (RLS
--     policy app_user_self, as distance_unit).
--   * Memory notes are ordinary items with item_type 'memory' (no schema change: item_type is
--     free text); search, revisions, the recycle bin and RLS apply as they are.
--
-- handle_new_auth_user is the version from 20261011120000_invite_signup.sql, with the Tasks insert
-- replaced by _ensure_built_in_spaces. Nothing new is granted to anon; the helper is revoked from
-- public, anon and authenticated.

-- =========================================================
-- Columns
-- =========================================================

alter table space
  add column built_in text
  constraint space_built_in_check check (built_in in ('tasks', 'memories'));
create unique index space_built_in_once on space (owner_user_id, built_in) where built_in is not null;
-- Readable like the rest of the space (the app shows the BUILT-IN badge).

alter table app_user
  add column memory_on boolean not null default false;
grant select (memory_on) on app_user to authenticated;
grant update (memory_on) on app_user to authenticated;

-- =========================================================
-- The guard
-- =========================================================

create function space_built_in_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_what text;
begin
  if tg_op = 'INSERT' then
    -- Only this migration and sign-up (as the table owner) make built-in spaces.
    if new.built_in is not null and current_user in ('anon', 'authenticated', 'service_role') then
      raise exception 'Only Wilma makes built-in spaces.' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.built_in is not null
       and exists (select 1 from public.app_user u where u.id = old.owner_user_id) then
      raise exception '"%" is a built-in space, so it can''t be deleted.', old.name using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.built_in is distinct from old.built_in and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'Only Wilma marks built-in spaces.' using errcode = '42501';
  end if;
  if old.built_in is not null then
    v_what := case
      when new.name is distinct from old.name then 'renamed'
      when new.parent_id is distinct from old.parent_id then 'moved'
      when new.is_restricted is distinct from old.is_restricted then 'restricted'
      when new.owner_user_id is distinct from old.owner_user_id then 'given away'
    end;
    if v_what is not null then
      raise exception '"%" is a built-in space, so it can''t be %.', old.name, v_what using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function space_built_in_guard() from public, anon, authenticated;

create trigger space_built_in_guard
  before insert or update or delete on space
  for each row execute function space_built_in_guard();

-- =========================================================
-- The built-in spaces for one account
-- =========================================================

-- Marks or makes the account's Tasks and Memories spaces. Runs as its owner (sign-up and this
-- migration only).
create function _ensure_built_in_spaces(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_name text;
  v_desc text;
  v_id uuid;
begin
  foreach v_kind in array array['tasks', 'memories'] loop
    if exists (select 1 from public.space where owner_user_id = p_user and built_in = v_kind) then
      continue;
    end if;
    v_name := case v_kind when 'tasks' then 'Tasks' else 'Memories' end;
    v_desc := case v_kind when 'tasks' then 'Things to do, with due dates' else 'What Wilma remembered about you' end;
    -- The user's own top-level space of that name (oldest first), when it is not restricted.
    select id into v_id from public.space
    where owner_user_id = p_user and parent_id is null and lower(name) = lower(v_name) and not is_restricted
    order by created_at, id
    limit 1;
    if v_id is not null then
      update public.space set built_in = v_kind where id = v_id;
    else
      insert into public.space (owner_user_id, parent_id, name, description, is_restricted, built_in)
      values (p_user, null, v_name, v_desc, false, v_kind)
      on conflict do nothing;  -- a restricted space of that exact name: left alone
    end if;
  end loop;
end;
$$;
revoke execute on function _ensure_built_in_spaces(uuid) from public, anon, authenticated;

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code public.invite_code;
  v_problem text;
  v_terms text := (select s.terms_version from public.signup_setting s);
  v_accepted boolean;
begin
  -- The invite code, locked until the sign-up commits. The hook has already checked it; this
  -- check again stops two sign-ups at once from both taking a code's last use.
  if nullif(btrim(v_meta ->> 'invite_code'), '') is not null then
    select * into v_code from public.invite_code
    where code_hash = public.invite_code_hash(v_meta ->> 'invite_code')
    for update;
    v_problem := public.invite_code_problem(v_code);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
  v_accepted := v_meta -> 'age_confirmed' = 'true'::jsonb and v_meta ->> 'terms_version' = v_terms;

  insert into public.app_user (id, email, display_name, plan, terms_version, terms_accepted_at, age_confirmed)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name',
          coalesce(v_code.grants_plan, 'free'),
          case when v_accepted then v_terms end,
          case when v_accepted then now() end,
          coalesce(v_accepted, false))
  on conflict (id) do nothing;

  if v_code.id is not null then
    update public.invite_code set uses = uses + 1 where id = v_code.id;
    insert into public.invite_use (invite_code_id, user_id) values (v_code.id, new.id)
    on conflict do nothing;
    -- The code has done its job; it is not kept with the account.
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'invite_code' where id = new.id;
  end if;

  -- The built-in spaces, owned by the new account: Tasks (the ✅ Tasks tile's tasks go here by
  -- default) and Memories (what Wilma remembers, docs/memory-plan.md). Neither can be deleted,
  -- renamed, moved or restricted (space_built_in_guard below).
  if exists (select 1 from public.app_user u where u.id = new.id) then
    perform public._ensure_built_in_spaces(new.id);
  end if;
  return new;
end;
$$;
revoke execute on function handle_new_auth_user() from public, anon, authenticated;

-- Accounts made before this migration.
select _ensure_built_in_spaces(u.id) from app_user u;
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
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
