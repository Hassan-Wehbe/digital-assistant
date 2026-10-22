-- Test: the age check switched off (20261025120000_age_check_off.sql; owner, 2026-10-22; D44
-- changed). Off by default: everyone is treated as 21 or over (is_21, my_age_status), every drinks
-- space is Cocktails (renamed back now and at sign-up), sign-up checks 18 and over with the 18+ box
-- or with a month and year (versionCode 25); switching it on brings the age rules back; the switch
-- helper is callable by no one; anon gets nothing; nobody but the owner changes the setting.

create temp table _code (code text);
insert into _code values (create_invite_code('test: age off', 10, 14, 'free'));
grant select on _code to authenticated;
create function pg_temp.hook(p_meta jsonb) returns text language sql as $$
  select coalesce(hook_before_user_created(jsonb_build_object('metadata', '{}'::jsonb,
           'user', jsonb_build_object('email', 'x@example.invalid', 'user_metadata', p_meta))) -> 'error' ->> 'message', 'ok');
$$;
create function pg_temp.born(p_years int) returns jsonb language sql as $$
  select jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting),
           'birth_month', extract(month from d)::int, 'birth_year', extract(year from d)::int)
  from (select (date_trunc('month', current_date) - make_interval(years => p_years, months => 1))::date d) x;
$$;
create function pg_temp.drinks(p_user uuid) returns text language sql as $$
  select name from space where owner_user_id = p_user and built_in = 'cocktails';
$$;

select pg_temp.check('the age check is off', (select not age_check from signup_setting));

-- ---------- Sign-up: 18 and over, either way ----------
select pg_temp.check('the 18+ box signs up',
  pg_temp.hook(jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting), 'age_confirmed', true)) = 'ok');
select pg_temp.check('without the box: refused',
  pg_temp.hook(jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting))) like 'Please confirm you are 18 or older%');
select pg_temp.check('versionCode 25''s month and year: 19 signs up', pg_temp.hook(pg_temp.born(19)) = 'ok');
select pg_temp.check('versionCode 25''s month and year: 17 is refused', pg_temp.hook(pg_temp.born(17)) = 'Wilma is for people 18 and over.');

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-a000-0000000000f1', 'test-off-box@example.invalid', 'authenticated', 'authenticated',
   jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting), 'age_confirmed', true)),
  ('00000000-0000-4000-a000-0000000000f2', 'test-off-19@example.invalid', 'authenticated', 'authenticated', pg_temp.born(19));
select pg_temp.check('a sign-up with the box: Cocktails', pg_temp.drinks('00000000-0000-4000-a000-0000000000f1') = 'Cocktails');
select pg_temp.check('a sign-up at 19 (versionCode 25): Cocktails too', pg_temp.drinks('00000000-0000-4000-a000-0000000000f2') = 'Cocktails');

-- ---------- Everyone 21 or over for drinks ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('is_21() is true at 19 while off', is_21());
select pg_temp.check('my_age_status() says asked and 21 or over, with no month', my_age_status() = '{"asked": true, "is_21": true}'::jsonb, my_age_status()::text);
select pg_temp.check('sync_drinks_space() keeps Cocktails', sync_drinks_space() = 'Cocktails');
do $$
begin
  perform _age_check_on();
  perform pg_temp.check('users cannot call the switch helper', false, 'allowed');
exception when insufficient_privilege then
  perform pg_temp.check('users cannot call the switch helper', true, sqlerrm);
end $$;
do $$
begin
  update signup_setting set age_check = true;
  perform pg_temp.check('users cannot switch it on', (select not age_check from signup_setting), 'switched');
exception when others then
  perform pg_temp.check('users cannot switch it on', true, sqlerrm);
end $$;
reset role;

-- ---------- Switched on: the age rules come back ----------
update signup_setting set age_check = true;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('on: 19 is not 21', not is_21());
select pg_temp.check('on: the next listing says Mocktails', sync_drinks_space() = 'Mocktails');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('on: an account that never gave an age is asked', (my_age_status() ->> 'asked')::boolean = false);
reset role;
update signup_setting set age_check = false;

-- ---------- anon ----------
set local role anon;
do $$
declare
  t text;
begin
  foreach t in array array['select is_21()', 'select my_age_status()', 'select _age_check_on()']
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
