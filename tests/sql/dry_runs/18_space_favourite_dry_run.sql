-- DRY RUN of 20261018120000_space_favourite.sql with SQL test 18 (tests/sql/dry_run.sh). Paste ALL of it
-- into the Supabase SQL editor and run it. It ends with the error "DRY RUN RESULTS (rolled back): [...]"
-- on purpose: nothing is kept. Every item in that list must say "ok": true (34 checks). Then apply the migration.
begin;
-- Favourite spaces for Home (docs/home-cleanup-plan.md step 1, design D38; owner 2026-10-18: "home
-- spaces should be my favourites, there should be a way to do this").
--
--   * space_favourite: up to 6 of a person's spaces, in the order Home shows them. Kept on the
--     server so the choice survives a new phone. It is a preference, not content: nothing here is
--     searched, embedded or shared.
--   * Restricted spaces never become favourites (rule 3: Home never hints at them), nor does a
--     space nested anywhere under a restricted one, nor the built-in Tasks space (the Tasks tile is
--     the way to tasks). Both are checked when the list is saved and again when it is read, so a
--     favourite later restricted or moved under a restricted space simply stops being shown (and
--     the next save leaves it out).
--   * RLS: each person reads only their own rows (rule 5). anon gets nothing. authenticated may
--     only read; the list changes only through set_favourite_spaces, which replaces it whole, so a
--     stray write can never favourite someone else's space or a restricted one.
--   * Deleting a space or the account removes its favourite rows (cascade).

-- =========================================================
-- The table
-- =========================================================

create table space_favourite (
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  space_id    uuid not null references space (id) on delete cascade,
  position    smallint not null constraint space_favourite_position_check check (position between 1 and 6),
  created_at  timestamptz not null default now(),
  primary key (user_id, space_id),
  constraint space_favourite_position_once unique (user_id, position)
);
create index space_favourite_space_idx on space_favourite (space_id);

alter table space_favourite enable row level security;
create policy space_favourite_own on space_favourite for select
  using (user_id = auth.uid());

-- =========================================================
-- Reading and saving the list
-- =========================================================

-- The person's favourites in Home's order, only those that may still be shown: their own, not
-- restricted, not under a restricted space, not Tasks.
create function my_favourite_spaces() returns uuid[]
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(f.space_id order by f.position), '{}')
  from public.space_favourite f
  join public.space s on s.id = f.space_id
  where f.user_id = auth.uid()
    and s.built_in is distinct from 'tasks'
    and f.space_id in (select public.searchable_space_ids());
$$;

-- Replaces the whole list with p_ids, in that order (null or empty clears it). Refuses more than 6,
-- the same space twice, and any space that is not the person's own, searchable and not Tasks,
-- without changing anything. security definer only because authenticated has no write grants on
-- the table; it writes nothing but the signed-in person's own rows.
create function set_favourite_spaces(p_ids uuid[]) returns uuid[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[] := coalesce(p_ids, '{}');
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if array_position(v_ids, null) is not null then
    raise exception 'A favourite needs a space.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 6 then
    raise exception 'You can have at most 6 favourite spaces. Remove one first.' using errcode = 'P0001';
  end if;
  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'A space can be a favourite only once.' using errcode = '22023';
  end if;
  -- One message for every refused space, so it never says whether a space exists, is someone
  -- else's or is restricted.
  if exists (
    select 1 from unnest(v_ids) x
    where x not in (select public.searchable_space_ids())
       or exists (select 1 from public.space s where s.id = x and (s.owner_user_id <> v_user or s.built_in = 'tasks'))
  ) then
    raise exception 'That space cannot be a favourite.' using errcode = 'P0001';
  end if;

  delete from public.space_favourite where user_id = v_user;
  insert into public.space_favourite (user_id, space_id, position)
  select v_user, x, n from unnest(v_ids) with ordinality as t (x, n);

  return public.my_favourite_spaces();
end;
$$;

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on space_favourite from public, anon, authenticated;
grant select on space_favourite to authenticated;               -- RLS: own rows only

revoke execute on function my_favourite_spaces() from public, anon;
grant execute on function my_favourite_spaces() to authenticated;
revoke execute on function set_favourite_spaces(uuid[]) from public, anon;
grant execute on function set_favourite_spaces(uuid[]) to authenticated;
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
-- Test: favourite spaces for Home (20261018120000_space_favourite.sql, docs/home-cleanup-plan.md
-- step 1). Each person sees and changes only their own list (rule 5); anon gets nothing; the list is
-- saved whole, in order, at most 6, each space once; restricted spaces, spaces under them and Tasks
-- are refused (rule 3) and, if restricted later, no longer shown; the table cannot be written
-- directly; deleting a space removes it from the list.

-- A's space by name, whoever is signed in (security definer, so B's tests can name A's spaces).
create function pg_temp.sid(p_name text) returns uuid language sql stable security definer as $$
  select id from public.space where name = p_name and owner_user_id = '00000000-0000-4000-a000-00000000000a';
$$;
grant execute on function pg_temp.sid(text) to authenticated;

-- ---------- A makes some spaces ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('Recipes'), ('Work'), ('House');
insert into space (name, is_restricted) values ('Private', true);
insert into space (name, parent_id) values ('Inner', (select id from space where name = 'Private'));
insert into space (name, parent_id, is_restricted)
  values ('Locked child', (select id from space where name = 'Work'), true);
insert into space (name, parent_id) values ('Gartner', (select id from space where name = 'Work'));
insert into space (name) select 'Extra ' || g from generate_series(1, 4) g;

select pg_temp.check('a new account has no favourites', (select my_favourite_spaces() = '{}'));

select pg_temp.check('saving Work, Recipes returns them in that order',
  (select set_favourite_spaces(array[pg_temp.sid('Work'), pg_temp.sid('Recipes')])
          = array[pg_temp.sid('Work'), pg_temp.sid('Recipes')]));
select pg_temp.check('my_favourite_spaces reads them back in order',
  (select my_favourite_spaces() = array[pg_temp.sid('Work'), pg_temp.sid('Recipes')]));
select pg_temp.check('the rows belong to A, positions 1 and 2',
  (select count(*) = 2 and bool_and(user_id = auth.uid()) and min(position) = 1 and max(position) = 2
   from space_favourite));
select pg_temp.check('a space nested under a plain space can be a favourite',
  (select set_favourite_spaces(array[pg_temp.sid('Gartner'), pg_temp.sid('Recipes'), pg_temp.sid('Work')])
          = array[pg_temp.sid('Gartner'), pg_temp.sid('Recipes'), pg_temp.sid('Work')]));
select pg_temp.check('saving again replaces the whole list (reordered, one removed)',
  (select set_favourite_spaces(array[pg_temp.sid('Recipes'), pg_temp.sid('Work')])
          = array[pg_temp.sid('Recipes'), pg_temp.sid('Work')]));
select pg_temp.check('the removed one''s row is gone', (select count(*) = 2 from space_favourite));
select pg_temp.check('six spaces are allowed',
  (select cardinality(set_favourite_spaces(array[pg_temp.sid('Recipes'), pg_temp.sid('Work'), pg_temp.sid('House'),
                                                  pg_temp.sid('Extra 1'), pg_temp.sid('Extra 2'), pg_temp.sid('Extra 3')])) = 6));
select set_favourite_spaces(array[pg_temp.sid('Recipes'), pg_temp.sid('Work')]);

-- ---------- Refused, and nothing changes ----------
create function pg_temp.refused(p_test text, p_ids uuid[], p_message text) returns void
language plpgsql as $$
begin
  perform public.set_favourite_spaces(p_ids);
  perform pg_temp.check(p_test, false, 'saved');
exception when others then
  perform pg_temp.check(p_test,
    sqlerrm like p_message and public.my_favourite_spaces() = array[pg_temp.sid('Recipes'), pg_temp.sid('Work')],
    sqlerrm);
end;
$$;

select pg_temp.refused('a restricted space is refused',
  array[pg_temp.sid('Private')], 'That space cannot be a favourite.');
select pg_temp.refused('a space under a restricted one is refused',
  array[pg_temp.sid('Inner')], 'That space cannot be a favourite.');
select pg_temp.refused('a restricted space inside a plain one is refused',
  array[pg_temp.sid('Locked child')], 'That space cannot be a favourite.');
select pg_temp.refused('one restricted space refuses the whole list',
  array[pg_temp.sid('House'), pg_temp.sid('Private')], 'That space cannot be a favourite.');
select pg_temp.refused('the built-in Tasks space is refused',
  array[(select id from space where built_in = 'tasks')], 'That space cannot be a favourite.');
select pg_temp.refused('a space that does not exist is refused',
  array[gen_random_uuid()], 'That space cannot be a favourite.');
select pg_temp.refused('seven spaces are refused',
  array[pg_temp.sid('Recipes'), pg_temp.sid('Work'), pg_temp.sid('House'), pg_temp.sid('Extra 1'),
        pg_temp.sid('Extra 2'), pg_temp.sid('Extra 3'), pg_temp.sid('Extra 4')], 'You can have at most 6%');
select pg_temp.refused('the same space twice is refused',
  array[pg_temp.sid('House'), pg_temp.sid('House')], 'A space can be a favourite only once.');
select pg_temp.refused('an empty entry is refused',
  array[pg_temp.sid('House'), null], 'A favourite needs a space.');

do $$
begin
  insert into space_favourite (space_id, position) values (pg_temp.sid('Private'), 3);
  perform pg_temp.check('the table cannot be written directly (insert)', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the table cannot be written directly (insert)', true, sqlerrm);
end $$;
do $$
begin
  update space_favourite set space_id = pg_temp.sid('Private') where position = 1;
  perform pg_temp.check('the table cannot be written directly (update)', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the table cannot be written directly (update)', true, sqlerrm);
end $$;
do $$
begin
  delete from space_favourite;
  perform pg_temp.check('the table cannot be written directly (delete)', false, 'delete succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the table cannot be written directly (delete)', true, sqlerrm);
end $$;

-- ---------- B: own list only ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
insert into space (name) values ('B recipes');

select pg_temp.check('B sees none of A''s favourite rows', (select count(*) = 0 from space_favourite));
select pg_temp.check('B''s list is empty', (select my_favourite_spaces() = '{}'));
do $$
begin
  perform set_favourite_spaces(array[pg_temp.sid('Recipes')]);
  perform pg_temp.check('B cannot favourite A''s space', false, 'saved');
exception when others then
  perform pg_temp.check('B cannot favourite A''s space', sqlerrm = 'That space cannot be a favourite.', sqlerrm);
end $$;
select pg_temp.check('B can favourite their own space',
  (select set_favourite_spaces(array[(select id from space where name = 'B recipes')])
          = array[(select id from space where name = 'B recipes')]));
select pg_temp.check('B can clear their list (empty)',
  (select set_favourite_spaces('{}') = '{}'));
select pg_temp.check('null clears too', (select set_favourite_spaces(null) = '{}'));

-- ---------- anon: nothing ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform 1 from public.space_favourite;
  perform pg_temp.check('anon cannot read the table', false, 'read succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read the table', true, sqlerrm);
end $$;
do $$
begin
  perform public.my_favourite_spaces();
  perform pg_temp.check('anon cannot call my_favourite_spaces', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call my_favourite_spaces', true, sqlerrm);
end $$;
do $$
begin
  perform public.set_favourite_spaces('{}');
  perform pg_temp.check('anon cannot call set_favourite_spaces', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call set_favourite_spaces', true, sqlerrm);
end $$;

-- ---------- Back to A ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('B saving and clearing their list left A''s alone',
  (select my_favourite_spaces() = array[pg_temp.sid('Recipes'), pg_temp.sid('Work')]));

-- ---------- Later changes to A's spaces ----------
reset role;
update space set is_restricted = true where id = pg_temp.sid('Recipes');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('a favourite made restricted later is no longer shown',
  (select my_favourite_spaces() = array[pg_temp.sid('Work')]));

reset role;
update space set is_restricted = false where id = pg_temp.sid('Recipes');
update space set parent_id = pg_temp.sid('Private') where id = pg_temp.sid('Recipes');
set local role authenticated;
select pg_temp.check('a favourite moved under a restricted space is no longer shown',
  (select my_favourite_spaces() = array[pg_temp.sid('Work')]));

reset role;
create temp table _work as select pg_temp.sid('Work') as id;
grant select on _work to authenticated;
delete from space where id = (select id from _work);
set local role authenticated;
select pg_temp.check('deleting a space removes it from the list',
  (select count(*) = 0 from space_favourite where space_id = (select id from _work)));
select pg_temp.check('only the hidden Recipes row is left',
  (select count(*) = 1 and bool_and(space_id = pg_temp.sid('Recipes')) from space_favourite)
  and (select my_favourite_spaces() = '{}'));
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
