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
