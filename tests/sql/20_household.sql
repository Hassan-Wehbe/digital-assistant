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
