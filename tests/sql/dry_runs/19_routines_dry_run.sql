-- DRY RUN of 20261019120000_routines.sql with SQL test 19 (tests/sql/dry_run.sh). Paste ALL of it
-- into the Supabase SQL editor and run it. It ends with the error "DRY RUN RESULTS (rolled back): [...]"
-- on purpose: nothing is kept. Every item in that list must say "ok": true (30 checks). Then apply the migration.
begin;
-- Routines, step 1 (docs/routines-plan.md, design D39; owner's answers 2026-10-18). A routine is an
-- item (item_type 'routine') in the Tasks space and its tasks are ordinary tasks with
-- metadata.routine_id: no new table for them (D5). This migration adds two things:
--
--   * task_not_today: My day's "✕ Not today" on a suggested routine task, kept on the server so it
--     holds on every device (Q5). Only a task id and a day, never task text. A table, not task
--     metadata, so a dismissal writes no revision (rule 7 stays about real edits). RLS own rows
--     (rule 5); a row can only name the user's own live task in a searchable space (rule 3); anon
--     gets nothing; rows older than a couple of days are dropped as new ones are written.
--   * The recycle bin takes a routine's tasks with it (Q8: deleting a routine deletes all its
--     tasks): delete_item on a routine bins its live tasks at the same moment; restore_item brings
--     back those binned with it; purge_item deletes them for good with it, and deleted_item_files
--     lists their files too, so the server removes them from Storage first. Soft delete first, as
--     always (rule 8). Other items work exactly as before.

-- =========================================================
-- Not today
-- =========================================================

create table task_not_today (
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  task_id     uuid not null references item (id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, task_id, day)
);
create index task_not_today_task_idx on task_not_today (task_id);

alter table task_not_today enable row level security;
create policy task_not_today_read on task_not_today for select
  using (user_id = auth.uid());
create policy task_not_today_remove on task_not_today for delete
  using (user_id = auth.uid());
create policy task_not_today_add on task_not_today for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.item i
      where i.id = task_id and i.item_type = 'task' and i.deleted_at is null
        and i.space_id in (select public.searchable_space_ids())
    )
  );

-- Before a row is written: a day near today (the phone's date may be a day either side of the
-- server's), and the person's rows for days long gone dropped.
create function task_not_today_before() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.day < current_date - 2 or new.day > current_date + 400 then
    raise exception 'Not today is for today or a coming day.' using errcode = '22023';
  end if;
  delete from public.task_not_today where user_id = new.user_id and day < current_date - 2;
  return new;
end;
$$;

create trigger task_not_today_before
  before insert on task_not_today
  for each row execute function task_not_today_before();

-- =========================================================
-- The recycle bin and a routine's tasks
-- =========================================================

-- Move a note to the recycle bin; a routine takes its live tasks with it, at the same moment.
create or replace function delete_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_at    timestamptz := now();
  v_title text;
  v_type  text;
  v_tasks int := 0;
begin
  update public.item i set deleted_at = v_at
  from public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is null
  returning i.title, i.item_type into v_title, v_type;
  if not found then
    raise exception 'item not found (or already in the recycle bin)' using errcode = 'P0002';
  end if;
  if v_type = 'routine' then
    update public.item i set deleted_at = v_at
    from public.space sp
    where sp.id = i.space_id and sp.owner_user_id = v_uid and i.deleted_at is null
      and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text;
    get diagnostics v_tasks = row_count;
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'in_recycle_bin', true, 'tasks', v_tasks);
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'in_recycle_bin', true);
end;
$$;

-- Take a note back out of the recycle bin; a routine brings back the tasks binned with it.
create or replace function restore_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_at    timestamptz;
  v_title text;
  v_type  text;
  v_tasks int := 0;
begin
  select i.deleted_at, i.item_type into v_at, v_type
  from public.item i join public.space sp on sp.id = i.space_id
  where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null;
  update public.item i set deleted_at = null
  from public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is not null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found in the recycle bin' using errcode = 'P0002';
  end if;
  if v_type = 'routine' then
    update public.item i set deleted_at = null
    from public.space sp
    where sp.id = i.space_id and sp.owner_user_id = v_uid and i.deleted_at = v_at
      and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text;
    get diagnostics v_tasks = row_count;
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'restored', true, 'tasks', v_tasks);
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'restored', true);
end;
$$;

-- The Storage paths of a binned note's files (and, for a routine, of the tasks binned with it), for
-- the server to delete before purge_item.
create or replace function deleted_item_files(p_item_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_at   timestamptz;
  v_type text;
  v_keys text[];
begin
  select i.deleted_at, i.item_type into v_at, v_type
  from public.item i join public.space sp on sp.id = i.space_id
  where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null;
  if not found then
    raise exception 'item not found in the recycle bin (only notes in the bin can be deleted for good)'
      using errcode = 'P0002';
  end if;
  select coalesce(array_agg(a.storage_key order by a.created_at), '{}') into v_keys
  from public.attachment a
  where a.item_id = p_item_id
     or (v_type = 'routine' and a.item_id in (
       select i.id from public.item i join public.space sp on sp.id = i.space_id
       where sp.owner_user_id = v_uid and i.deleted_at = v_at
         and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text));
  return v_keys;
end;
$$;

-- Delete a binned note for good; a routine takes the tasks binned with it.
create or replace function purge_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_at    timestamptz;
  v_title text;
  v_type  text;
  v_tasks int := 0;
begin
  select i.deleted_at, i.item_type into v_at, v_type
  from public.item i join public.space sp on sp.id = i.space_id
  where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null;
  if v_type = 'routine' then
    delete from public.item i
    using public.space sp
    where sp.id = i.space_id and sp.owner_user_id = v_uid and i.deleted_at = v_at
      and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text;
    get diagnostics v_tasks = row_count;
  end if;
  delete from public.item i
  using public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is not null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found in the recycle bin (only notes in the bin can be deleted for good)'
      using errcode = 'P0002';
  end if;
  if v_type = 'routine' then
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'purged', true, 'tasks', v_tasks);
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'purged', true);
end;
$$;

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on task_not_today from public, anon, authenticated;
grant select, delete on task_not_today to authenticated;     -- RLS: own rows only
grant insert (task_id, day) on task_not_today to authenticated;

revoke execute on function task_not_today_before() from public, anon, authenticated;

-- The replaced functions keep their grants; stated again so this file reads on its own.
revoke execute on function delete_item(uuid), restore_item(uuid), deleted_item_files(uuid), purge_item(uuid)
  from public, anon;
grant execute on function delete_item(uuid), restore_item(uuid), deleted_item_files(uuid), purge_item(uuid)
  to authenticated;
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
-- Test: routines step 1 (20261019120000_routines.sql, docs/routines-plan.md). "Not today" rows are
-- the user's own (rule 5), only for their own live task in a searchable space (rule 3), only for a
-- day near today, never written directly for someone else; anon gets nothing; old rows go. The
-- recycle bin takes a routine's tasks with it and brings back only those binned with it (Q8,
-- rule 8); B can do none of it to A's routine. Rows are inserted as the test's superuser; every
-- check runs as the signed-in user.

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', u), true);
$$;

-- ---------- A's and B's items (as the superuser) ----------
insert into space (owner_user_id, name) values
  ('00000000-0000-4000-a000-00000000000a', 'Chores'),
  ('00000000-0000-4000-a000-00000000000b', 'B chores');
insert into space (owner_user_id, name, is_restricted) values ('00000000-0000-4000-a000-00000000000a', 'Locked', true);

create temp table _ids (name text primary key, id uuid not null default gen_random_uuid());
insert into _ids (name) values ('routine'), ('laundry'), ('vacuum'), ('old'), ('other'), ('note'), ('locked'), ('b_task');
grant select on _ids to authenticated, anon;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp._ids where name = p $$;
grant execute on function pg_temp.id(text) to authenticated, anon;

create function pg_temp.sp(owner text, p_name text) returns uuid language sql stable as $$
  select id from public.space where name = p_name and owner_user_id = format('00000000-0000-4000-a000-00000000000%s', owner)::uuid;
$$;

insert into item (id, space_id, item_type, title, metadata) values
  (pg_temp.id('routine'), pg_temp.sp('a', 'Chores'), 'routine', 'Weekend reset', '{"repeat":"weekly","when":"any_day","starts_on":"2026-10-01","suggest":true}'),
  (pg_temp.id('laundry'), pg_temp.sp('a', 'Chores'), 'task', 'Laundry', jsonb_build_object('status', 'open', 'priority', 'normal', 'repeat', 'weekly', 'routine_id', pg_temp.id('routine'))),
  (pg_temp.id('vacuum'),  pg_temp.sp('a', 'Chores'), 'task', 'Vacuum',  jsonb_build_object('status', 'open', 'priority', 'normal', 'repeat', 'weekly', 'routine_id', pg_temp.id('routine'))),
  (pg_temp.id('old'),     pg_temp.sp('a', 'Chores'), 'task', 'Old one', jsonb_build_object('status', 'open', 'priority', 'normal', 'repeat', 'weekly', 'routine_id', pg_temp.id('routine'))),
  (pg_temp.id('other'),   pg_temp.sp('a', 'Chores'), 'task', 'Call the bank', '{"status":"open","priority":"normal"}'),
  (pg_temp.id('note'),    pg_temp.sp('a', 'Chores'), 'note', 'A note', '{}'),
  (pg_temp.id('locked'),  pg_temp.sp('a', 'Locked'), 'task', 'Locked task', '{"status":"open","priority":"normal"}'),
  (pg_temp.id('b_task'),  pg_temp.sp('b', 'B chores'), 'task', 'B task', '{"status":"open","priority":"normal"}');
-- "Old one" was binned on its own, a week ago: it must not come back with the routine.
update item set deleted_at = now() - interval '7 days' where id = pg_temp.id('old');
insert into attachment (item_id, storage_key, original_filename, mime_type)
values (pg_temp.id('laundry'), '00000000-0000-4000-a000-00000000000a/laundry/tag.jpg', 'tag.jpg', 'image/jpeg');

-- A row for a day long gone, written past the trigger, to show it is dropped later.
alter table task_not_today disable trigger task_not_today_before;
insert into task_not_today (user_id, task_id, day) values ('00000000-0000-4000-a000-00000000000a', pg_temp.id('vacuum'), current_date - 10);
alter table task_not_today enable trigger task_not_today_before;

-- ---------- Not today, as A ----------
select pg_temp.as_user('a');
set local role authenticated;

insert into task_not_today (task_id, day) values (pg_temp.id('laundry'), current_date);
select pg_temp.check('A marks a task of theirs not today',
  (select count(*) = 1 and bool_and(user_id = auth.uid()) from task_not_today where day = current_date));
select pg_temp.check('the row for a day long gone was dropped',
  (select count(*) = 0 from task_not_today where day < current_date - 2));
insert into task_not_today (task_id, day) values (pg_temp.id('vacuum'), current_date + 1);
select pg_temp.check('a coming day is fine', (select count(*) = 2 from task_not_today));

create function pg_temp.refused(p_test text, p_task uuid, p_day date) returns void
language plpgsql as $$
begin
  insert into public.task_not_today (task_id, day) values (p_task, p_day);
  perform pg_temp.check(p_test, false, 'inserted');
exception when others then
  perform pg_temp.check(p_test, sqlstate in ('42501', '22023'), sqlerrm);
end;
$$;
select pg_temp.refused('not for B''s task', pg_temp.id('b_task'), current_date);
select pg_temp.refused('not for a note', pg_temp.id('note'), current_date);
select pg_temp.refused('not for a task in a restricted space', pg_temp.id('locked'), current_date);
select pg_temp.refused('not for a task in the bin', pg_temp.id('old'), current_date);
select pg_temp.refused('not for a day long gone', pg_temp.id('other'), current_date - 5);
select pg_temp.refused('not for a day far ahead', pg_temp.id('other'), current_date + 500);
do $$
begin
  insert into task_not_today (user_id, task_id, day) values ('00000000-0000-4000-a000-00000000000b', pg_temp.id('other'), current_date);
  perform pg_temp.check('the owner cannot be written directly', false, 'inserted');
exception when insufficient_privilege then
  perform pg_temp.check('the owner cannot be written directly', true, sqlerrm);
end $$;
do $$
begin
  update task_not_today set day = current_date + 3;
  perform pg_temp.check('a row cannot be changed', false, 'updated');
exception when insufficient_privilege then
  perform pg_temp.check('a row cannot be changed', true, sqlerrm);
end $$;

-- ---------- B sees and removes nothing of A's ----------
select pg_temp.as_user('b');
select pg_temp.check('B sees none of A''s rows', (select count(*) = 0 from task_not_today));
delete from task_not_today;
select pg_temp.as_user('a');
select pg_temp.check('B''s delete removed none of A''s rows', (select count(*) = 2 from task_not_today));
delete from task_not_today where day = current_date + 1;
select pg_temp.check('A can take one back', (select count(*) = 1 from task_not_today));

-- ---------- anon: nothing ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform 1 from public.task_not_today;
  perform pg_temp.check('anon cannot read not-today rows', false, 'read');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read not-today rows', true, sqlerrm);
end $$;

-- ---------- The recycle bin and a routine's tasks ----------
reset role;
select pg_temp.as_user('b');
set local role authenticated;
do $$
begin
  perform public.delete_item(pg_temp.id('routine'));
  perform pg_temp.check('B cannot bin A''s routine', false, 'deleted');
exception when others then
  perform pg_temp.check('B cannot bin A''s routine', sqlstate = 'P0002', sqlerrm);
end $$;

select pg_temp.as_user('a');
select pg_temp.check('binning the routine takes its two live tasks',
  (select (delete_item(pg_temp.id('routine')) ->> 'tasks')::int = 2));
reset role;
create temp table _bin as select id, deleted_at from item where id in (pg_temp.id('routine'), pg_temp.id('laundry'), pg_temp.id('vacuum'), pg_temp.id('old'), pg_temp.id('other'));
grant select on _bin to authenticated;
set local role authenticated;
select pg_temp.check('the routine and its tasks share one moment in the bin',
  (select count(distinct deleted_at) = 1 from _bin where id in (pg_temp.id('routine'), pg_temp.id('laundry'), pg_temp.id('vacuum'))));
select pg_temp.check('another task is untouched', (select deleted_at is null from _bin where id = pg_temp.id('other')));
select pg_temp.check('the task binned on its own keeps its own moment',
  (select b.deleted_at < r.deleted_at from _bin b, _bin r where b.id = pg_temp.id('old') and r.id = pg_temp.id('routine')));
select pg_temp.check('the routine''s files include its tasks''',
  (select deleted_item_files(pg_temp.id('routine')) = array['00000000-0000-4000-a000-00000000000a/laundry/tag.jpg']));

select pg_temp.as_user('b');
do $$
begin
  perform public.restore_item(pg_temp.id('routine'));
  perform pg_temp.check('B cannot restore A''s routine', false, 'restored');
exception when others then
  perform pg_temp.check('B cannot restore A''s routine', sqlstate = 'P0002', sqlerrm);
end $$;

select pg_temp.as_user('a');
select pg_temp.check('restoring the routine brings back the two binned with it',
  (select (restore_item(pg_temp.id('routine')) ->> 'tasks')::int = 2));
reset role;
select pg_temp.check('they are live again; the old one stays in the bin',
  (select count(*) filter (where deleted_at is null) = 2 and count(*) filter (where deleted_at is not null) = 1
   from item where id in (pg_temp.id('laundry'), pg_temp.id('vacuum'), pg_temp.id('old'))));
set local role authenticated;

select pg_temp.check('a note binned alone says nothing about tasks',
  (select not (delete_item(pg_temp.id('note')) ? 'tasks')));
select pg_temp.check('a plain task binned alone takes nothing with it',
  (select not (delete_item(pg_temp.id('other')) ? 'tasks')));

select delete_item(pg_temp.id('routine'));
select pg_temp.check('purging the routine deletes its tasks binned with it',
  (select (purge_item(pg_temp.id('routine')) ->> 'tasks')::int = 2));
reset role;
select pg_temp.check('gone for good: the routine and its two tasks; the old one and the others stay',
  (select count(*) = 0 from item where id in (pg_temp.id('routine'), pg_temp.id('laundry'), pg_temp.id('vacuum')))
  and (select count(*) = 3 from item where id in (pg_temp.id('old'), pg_temp.id('other'), pg_temp.id('note'))));
select pg_temp.check('a purged task''s not-today rows went with it',
  (select count(*) = 0 from task_not_today where task_id = pg_temp.id('laundry')));
select pg_temp.check('a purged task''s attachment rows went with it',
  (select count(*) = 0 from attachment where item_id = pg_temp.id('laundry')));
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
