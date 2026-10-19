begin;
-- The household (docs/planners-plan.md step 1, design D40; owner 2026-10-19: all as recommended).
-- Who is in the family, for Family day: each person a label ("Me", "Sam", "Kid 1"), adult or
-- child, and for a child an optional birth year (Q3: the age stays right). Nothing more.
--
--   * household_member: at most 10 people per account, in the order the app shows them. Never an
--     item: never searched, embedded, remembered or shared (rules 3 and 4 never meet it). A
--     removed person is gone for good (a setting, like a home; rule 8 is about items).
--   * RLS: each person reads and changes only their own rows (rule 5). anon gets nothing.
--     authenticated may insert and change the label, kind, birth year and position, never the
--     owner.
--   * The planner (step 2) sends the AI roles and ages only ("child 6"), never a label (Q4).
--
-- Credential-looking text in a label is refused by the app before it gets here (rule 9).

-- =========================================================
-- The table
-- =========================================================

create table household_member (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  label       text not null constraint household_member_label_check check (char_length(btrim(label)) between 1 and 40),
  kind        text not null constraint household_member_kind_check check (kind in ('adult', 'child')),
  birth_year  smallint,
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Only a child has a birth year: nothing more is kept about an adult.
  constraint household_member_birth_year_check check (birth_year is null or (kind = 'child' and birth_year >= 1900))
);
create unique index household_member_label_once on household_member (user_id, lower(btrim(label)));
create index household_member_user_idx on household_member (user_id, position);

alter table household_member enable row level security;
create policy household_member_own on household_member for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =========================================================
-- Rules kept by the database
-- =========================================================

-- Before a row is written: the label trimmed, a birth year not in the future, at most 10 people,
-- a new one placed last, the owner never changed. security definer only so it can count the
-- person's other rows (it changes nothing but the row being written).
create function household_member_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.label := btrim(new.label);
  if new.birth_year is not null and new.birth_year > extract(year from now())::int then
    raise exception 'A birth year cannot be in the future.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A household member cannot be given to someone else.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
  end if;
  if (select count(*) from public.household_member m where m.user_id = new.user_id) >= 10 then
    raise exception 'A household holds at most 10 people. Remove one first.' using errcode = 'P0001';
  end if;
  new.position := coalesce((select max(m.position) + 1 from public.household_member m where m.user_id = new.user_id), 0);
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger household_member_before
  before insert or update on household_member
  for each row execute function household_member_before();

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on household_member from public, anon, authenticated;
grant select, delete on household_member to authenticated;                        -- RLS: own rows only
grant insert (label, kind, birth_year) on household_member to authenticated;      -- placed last by the trigger
grant update (label, kind, birth_year, position) on household_member to authenticated;
revoke execute on function household_member_before() from public, anon, authenticated;
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
-- Test: the household (20261020120000_household.sql, docs/planners-plan.md step 1). Each person
-- sees and changes only their own household (rule 5); anon gets nothing; labels trimmed and once
-- per name; a birth year only for a child, never in the future; at most 10; new people placed
-- last; the owner never changed; deleting the account takes the household with it.

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', u), true);
$$;

-- ---------- A adds the family ----------
select pg_temp.as_user('a');
set local role authenticated;

insert into household_member (label, kind) values ('  Me ', 'adult');
insert into household_member (label, kind) values ('Sam', 'adult');
insert into household_member (label, kind, birth_year) values ('Kid 1', 'child', 2020);
insert into household_member (label, kind) values ('Kid 2', 'child');

select pg_temp.check('four people, the owner is the signed-in person',
  (select count(*) = 4 and bool_and(user_id = auth.uid()) from household_member));
select pg_temp.check('labels are trimmed',
  (select count(*) = 1 from household_member where label = 'Me'));
select pg_temp.check('each new one is placed last',
  (select array_agg(label order by position) = array['Me', 'Sam', 'Kid 1', 'Kid 2'] from household_member));
select pg_temp.check('a child without a birth year is fine',
  (select birth_year is null from household_member where label = 'Kid 2'));

create function pg_temp.refused(p_test text, p_sql text, p_states text[]) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.check(p_test, false, 'it went through');
exception when others then
  perform pg_temp.check(p_test, sqlstate = any (p_states), sqlstate || ' ' || sqlerrm);
end;
$$;
select pg_temp.refused('an adult has no birth year',
  $q$insert into household_member (label, kind, birth_year) values ('Grandpa', 'adult', 1950)$q$, array['23514']);
select pg_temp.refused('a birth year in the future is refused',
  $q$insert into household_member (label, kind, birth_year) values ('Baby', 'child', 2999)$q$, array['22023']);
select pg_temp.refused('a birth year before 1900 is refused',
  $q$insert into household_member (label, kind, birth_year) values ('Old', 'child', 1800)$q$, array['23514']);
select pg_temp.refused('the kind is adult or child',
  $q$insert into household_member (label, kind) values ('Rex', 'dog')$q$, array['23514']);
select pg_temp.refused('a blank label is refused',
  $q$insert into household_member (label, kind) values ('   ', 'adult')$q$, array['23514']);
select pg_temp.refused('a label of more than 40 characters is refused',
  $q$insert into household_member (label, kind) values (repeat('x', 41), 'adult')$q$, array['23514']);
select pg_temp.refused('one person per name',
  $q$insert into household_member (label, kind) values ('sam ', 'adult')$q$, array['23505']);
select pg_temp.refused('the owner cannot be written directly',
  $q$insert into household_member (user_id, label, kind) values ('00000000-0000-4000-a000-00000000000b', 'Spy', 'adult')$q$, array['42501']);
select pg_temp.refused('the owner cannot be changed',
  $q$update household_member set user_id = '00000000-0000-4000-a000-00000000000b' where label = 'Sam'$q$, array['42501']);

update household_member set birth_year = 2018, label = 'Kid 2 ' where label = 'Kid 2';
select pg_temp.check('a child''s birth year and label can change',
  (select birth_year = 2018 from household_member where label = 'Kid 2'));
update household_member set position = 0 where label = 'Kid 1';
update household_member set position = 2 where label = 'Me';
select pg_temp.check('the order can change',
  (select (array_agg(label order by position, label))[1] = 'Kid 1' from household_member));
select pg_temp.refused('a child that becomes an adult keeps no birth year',
  $q$update household_member set kind = 'adult' where label = 'Kid 1'$q$, array['23514']);

-- At most 10.
insert into household_member (label, kind) select 'Guest ' || g, 'adult' from generate_series(1, 6) g;
select pg_temp.check('ten people', (select count(*) = 10 from household_member));
select pg_temp.refused('an eleventh is refused',
  $q$insert into household_member (label, kind) values ('One more', 'adult')$q$, array['P0001']);

-- ---------- B sees and changes nothing of A's ----------
select pg_temp.as_user('b');
select pg_temp.check('B sees none of A''s household', (select count(*) = 0 from household_member));
update household_member set label = 'Mine now';
delete from household_member;
insert into household_member (label, kind) values ('B', 'adult');
select pg_temp.check('B has only their own', (select count(*) = 1 and bool_and(label = 'B') from household_member));
select pg_temp.as_user('a');
select pg_temp.check('B''s update and delete touched none of A''s rows',
  (select count(*) = 10 and bool_and(label <> 'Mine now') from household_member));

delete from household_member where label like 'Guest %';
select pg_temp.check('A removes people', (select count(*) = 4 from household_member));

-- ---------- anon: nothing ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform 1 from public.household_member;
  perform pg_temp.check('anon cannot read the household', false, 'read');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read the household', true, sqlerrm);
end $$;
do $$
begin
  insert into public.household_member (label, kind) values ('Anon', 'adult');
  perform pg_temp.check('anon cannot add to a household', false, 'inserted');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot add to a household', true, sqlerrm);
end $$;

-- ---------- Deleting the account ----------
reset role;
select pg_temp.check('the household goes with the account (on delete cascade)',
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.household_member'::regclass and contype = 'f'
     and confrelid = 'public.app_user'::regclass and confdeltype = 'c'));
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
