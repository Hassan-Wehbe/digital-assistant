-- Test: the built-in drinks space's name (20261024120000_drinks_space_name.sql, docs/age-plan.md step
-- 2, Q8). Mocktails until the age is given and under 21, Cocktails from 21; set at sign-up, when the
-- age is given and by sync_drinks_space() (the app lists spaces on every open); the same space and
-- notes; another space of that name is never clashed with; users still cannot rename it; only the
-- caller's own; anon gets nothing.

-- The age check is switched off since 20261025120000_age_check_off.sql; these checks are for when it is on.
update signup_setting set age_check = true;

create function pg_temp.drinks(p_user uuid) returns text language sql as $$
  select name from space where owner_user_id = p_user and built_in = 'cocktails';
$$;
create temp table _code (code text);
insert into _code values (create_invite_code('test: drinks', 10, 14, 'free'));
create function pg_temp.born(p_years int) returns jsonb language sql as $$
  select jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting),
           'birth_month', extract(month from d)::int, 'birth_year', extract(year from d)::int)
  from (select (date_trunc('month', current_date) - make_interval(years => p_years))::date d) x;
$$;

-- The test users were made before the migration runs in a dry run, and after it here: set them as
-- an existing account would be after the migration.
select _ensure_built_in_spaces(u.id) from app_user u where u.id in ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000b');
select pg_temp.check('not asked yet: the drinks space is Mocktails',
  pg_temp.drinks('00000000-0000-4000-a000-00000000000a') = 'Mocktails', pg_temp.drinks('00000000-0000-4000-a000-00000000000a'));

-- ---------- Sign-ups ----------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-a000-0000000000e1', 'test-drinks-30@example.invalid', 'authenticated', 'authenticated', pg_temp.born(30)),
  ('00000000-0000-4000-a000-0000000000e2', 'test-drinks-19@example.invalid', 'authenticated', 'authenticated', pg_temp.born(19));
select pg_temp.check('a sign-up at 30: Cocktails', pg_temp.drinks('00000000-0000-4000-a000-0000000000e1') = 'Cocktails');
select pg_temp.check('a sign-up at 19: Mocktails', pg_temp.drinks('00000000-0000-4000-a000-0000000000e2') = 'Mocktails');

-- ---------- A gives an age of 35: Cocktails, the same space ----------
insert into item (space_id, title, item_type, metadata)
select id, 'Virgin cucumber cooler', 'cocktail', '{"strength":"none"}'::jsonb
from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'cocktails';
create temp table _before as select id from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'cocktails';
grant select on _before to authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select set_birth_month(5, extract(year from current_date)::int - 35);
select pg_temp.check('giving an age of 21 or over: Cocktails, the same space with its notes',
  (select name = 'Cocktails' and id = (select id from _before) from space where built_in = 'cocktails')
  and exists (select 1 from item i join space s on s.id = i.space_id where s.built_in = 'cocktails' and i.title = 'Virgin cucumber cooler'));
select pg_temp.check('sync_drinks_space() keeps it Cocktails', sync_drinks_space() = 'Cocktails');
do $$
begin
  update space set name = 'Drinks' where built_in = 'cocktails';
  perform pg_temp.check('users still cannot rename it', false, 'renamed');
exception when others then
  perform pg_temp.check('users still cannot rename it', sqlerrm like '%built-in space%', sqlerrm);
end $$;
reset role;

-- ---------- B: 19, with their own top-level "Mocktails" space already ----------
insert into space (owner_user_id, parent_id, name) values ('00000000-0000-4000-a000-00000000000b', null, 'mocktails');
reset role;
update app_user set alcohol_from = '-infinity' where id = '00000000-0000-4000-a000-00000000000b';
select _sync_drinks_space('00000000-0000-4000-a000-00000000000b');
update app_user set alcohol_from = (date_trunc('month', current_date) + interval '2 years 1 month')::date
where id = '00000000-0000-4000-a000-00000000000b';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('under 21 with a space already called Mocktails: left as Cocktails, no error',
  sync_drinks_space() = 'Cocktails');
select pg_temp.check('B sees and changes only their own',
  (select count(*) = 1 from space where built_in = 'cocktails'));
do $$
begin
  perform _sync_drinks_space('00000000-0000-4000-a000-00000000000a');
  perform pg_temp.check('users cannot set another account''s space', false, 'allowed');
exception when insufficient_privilege then
  perform pg_temp.check('users cannot set another account''s space', true, sqlerrm);
end $$;
reset role;

-- ---------- Turning 21: the next listing shows Cocktails ----------
update space set name = 'Old mocktails' where owner_user_id = '00000000-0000-4000-a000-00000000000b' and built_in is null and name = 'mocktails';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('under 21 and no clash: Mocktails', sync_drinks_space() = 'Mocktails');
reset role;
update app_user set alcohol_from = current_date where id = '00000000-0000-4000-a000-00000000000b';
set local role authenticated;
select pg_temp.check('the month they turn 21 (alcohol_from reached): Cocktails on the next listing', sync_drinks_space() = 'Cocktails');
reset role;

-- ---------- anon ----------
set local role anon;
do $$
declare
  t text;
begin
  foreach t in array array['select sync_drinks_space()', 'select _sync_drinks_space(''00000000-0000-4000-a000-00000000000a'')']
  loop
    begin
      execute t;
      perform pg_temp.check('anon is refused: ' || t, false, 'allowed');
    exception when insufficient_privilege then
      perform pg_temp.check('anon is refused: ' || t, true, sqlerrm);
    end;
  end loop;
end $$;
reset role;
