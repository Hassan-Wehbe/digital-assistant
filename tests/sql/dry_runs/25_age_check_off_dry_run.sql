begin;
-- Ages switched off (owner, 2026-10-22; docs/age-plan.md "Switched off"; design D44 changed): Wilma
-- stays 18 and over, sign-up goes back to the 18+ box, and everyone gets cocktails, as before the
-- age plan. The age code is kept, switched off by one setting, so it can come back later:
--
--   * signup_setting.age_check (false): off. While off,
--       - is_21() is true for everyone (the edge functions' drinks rules then let cocktails through);
--       - my_age_status() says asked and 21 or over, so the app never asks and shows cocktails (the
--         versionCode 25 app too, with no update);
--       - _sync_drinks_space() names every drinks space Cocktails (all are renamed back now).
--   * The sign-up hook is unchanged: the 18+ box (newer builds again) and the month and year of
--     birth (versionCode 25) both still check 18 and over. alcohol_from is still worked out from
--     the month and year when given, and is simply not used while the check is off.
--
-- Switching it back on is `update signup_setting set age_check = true;` (then the next listing
-- renames the drinks spaces). Nothing new is granted; the helper is callable by no one.

alter table signup_setting add column age_check boolean not null default false;
comment on column signup_setting.age_check is
  'D44: the age check for drinks (cocktails from 21, mocktails before). Off: everyone is treated as 21+.';

create function _age_check_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.age_check from public.signup_setting s), false);
$$;

-- As 20261023120000_age_check.sql, but asked and 21 or over for everyone while the check is off.
create or replace function my_age_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public._age_check_on()
    then jsonb_build_object('asked', true, 'is_21', true)
    else jsonb_build_object(
      'asked', u.alcohol_from is not null,
      'is_21', coalesce(u.alcohol_from <= current_date, false),
      'alcohol_from', case when u.alcohol_from > current_date then to_char(u.alcohol_from, 'YYYY-MM-DD') end)
    end
  from public.app_user u where u.id = auth.uid();
$$;

-- As 20261023120000_age_check.sql; true for everyone while the check is off.
create or replace function is_21() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public._age_check_on()
    or coalesce((select u.alcohol_from <= current_date from public.app_user u where u.id = auth.uid()), false);
$$;

-- As 20261024120000_drinks_space_name.sql; Cocktails for everyone while the check is off.
create or replace function _sync_drinks_space(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_space public.space;
begin
  select case when not public._age_check_on() or u.alcohol_from <= current_date then 'Cocktails' else 'Mocktails' end
  into v_name
  from public.app_user u where u.id = p_user;
  if v_name is null then return null; end if;
  select * into v_space from public.space where owner_user_id = p_user and built_in = 'cocktails';
  if v_space.id is null or v_space.name = v_name then return v_space.name; end if;
  if exists (
    select 1 from public.space s
    where s.owner_user_id = p_user and s.id <> v_space.id
      and s.parent_id is not distinct from v_space.parent_id and lower(s.name) = lower(v_name)
  ) then
    return v_space.name;
  end if;
  update public.space set name = v_name where id = v_space.id;
  return v_name;
end;
$$;

revoke execute on function _age_check_on() from public, anon, authenticated;
revoke execute on function _sync_drinks_space(uuid) from public, anon, authenticated;
revoke execute on function my_age_status(), is_21() from public, anon;
grant execute on function my_age_status(), is_21() to authenticated;

-- Every account's drinks space back to Cocktails.
select _sync_drinks_space(u.id) from app_user u;
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
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
