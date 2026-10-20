-- Test: the age check (20261023120000_age_check.sql, docs/age-plan.md step 1, Q5 option B). The
-- sign-up hook takes a month and year of birth (newer apps) or the 18+ box (older apps), refuses an
-- account under the minimum age, and never repeats the date; the sign-up trigger keeps only
-- alcohol_from (21 or over, or the month cocktails open) and removes the month and year from the
-- account's metadata; set_birth_month() works once for older accounts; is_21() and my_age_status()
-- read only the caller's own row; nobody writes alcohol_from directly; anon gets nothing.

create temp table _code (code text);
insert into _code values (create_invite_code('test: ages', 10, 14, 'free'));

create function pg_temp.hook(p_meta jsonb) returns text language sql as $$
  select coalesce(hook_before_user_created(jsonb_build_object('metadata', '{}'::jsonb,
           'user', jsonb_build_object('email', 'x@example.invalid', 'user_metadata', p_meta))) -> 'error' ->> 'message', 'ok');
$$;
-- A sign-up's metadata with a month and year of birth this many years and months ago.
create function pg_temp.born(p_years int, p_months int default 0) returns jsonb language sql as $$
  select jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting),
           'birth_month', extract(month from d)::int, 'birth_year', extract(year from d)::int)
  from (select (date_trunc('month', current_date) - make_interval(years => p_years, months => p_months))::date d) x;
$$;

select pg_temp.check('the minimum age is 18 for now', (select min_age = 18 from signup_setting));

-- ---------- The hook ----------
select pg_temp.check('hook: 30 years old passes', pg_temp.hook(pg_temp.born(30)) = 'ok', pg_temp.hook(pg_temp.born(30)));
select pg_temp.check('hook: 17 is under 18 and refused',
  pg_temp.hook(pg_temp.born(17)) = 'Wilma is for people 18 and over.', pg_temp.hook(pg_temp.born(17)));
select pg_temp.check('hook: born this month 18 years ago is not yet counted 18 (never early)',
  pg_temp.hook(pg_temp.born(18)) = 'Wilma is for people 18 and over.');
select pg_temp.check('hook: born last month 18 years ago is 18', pg_temp.hook(pg_temp.born(18, 1)) = 'ok');
select pg_temp.check('hook: an impossible or missing date is refused, and the message never repeats it',
  pg_temp.hook(pg_temp.born(30) || '{"birth_month":13}') = 'Please enter your month and year of birth.'
  and pg_temp.hook(pg_temp.born(30) || '{"birth_month":"5"}') = 'Please enter your month and year of birth.'
  and pg_temp.hook(pg_temp.born(30) - 'birth_year') = 'Please enter your month and year of birth.'
  and pg_temp.hook(pg_temp.born(30) || '{"birth_year":1850}') = 'Please enter your month and year of birth.'
  and pg_temp.hook(pg_temp.born(-1)) = 'Please enter your month and year of birth.');
select pg_temp.check('hook: the date path still needs the current terms',
  pg_temp.hook(pg_temp.born(30) || '{"terms_version":"old"}') = 'Please accept the privacy policy and testing terms.');
select pg_temp.check('hook: an older app''s 18+ box still works',
  pg_temp.hook(jsonb_build_object('invite_code', (select code from _code), 'age_confirmed', true,
                                  'terms_version', (select terms_version from signup_setting))) = 'ok');
update signup_setting set min_age = 13;
select pg_temp.check('hook: with the minimum at 13 (after the lawyer), 15 passes and 12 is refused',
  pg_temp.hook(pg_temp.born(15)) = 'ok' and pg_temp.hook(pg_temp.born(12)) = 'Wilma is for people 13 and over.');
update signup_setting set min_age = 18;

-- ---------- Sign-ups: only the result is kept ----------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-a000-0000000000d1', 'test-age-30@example.invalid', 'authenticated', 'authenticated', pg_temp.born(30)),
  ('00000000-0000-4000-a000-0000000000d2', 'test-age-19@example.invalid', 'authenticated', 'authenticated', pg_temp.born(19)),
  ('00000000-0000-4000-a000-0000000000d3', 'test-age-old-app@example.invalid', 'authenticated', 'authenticated',
   jsonb_build_object('invite_code', (select code from _code), 'age_confirmed', true, 'terms_version', (select terms_version from signup_setting)));
select pg_temp.check('30 years old: kept as 21 or over, no month', (select alcohol_from = '-infinity'::date and age_confirmed
  and terms_accepted_at is not null from app_user where id = '00000000-0000-4000-a000-0000000000d1'));
select pg_temp.check('19 years old: kept as the first day of the month after they turn 21',
  (select alcohol_from = (date_trunc('month', current_date) + interval '2 years 1 month')::date and age_confirmed
   from app_user where id = '00000000-0000-4000-a000-0000000000d2'));
select pg_temp.check('an older app''s sign-up: not asked yet (null)',
  (select alcohol_from is null and age_confirmed from app_user where id = '00000000-0000-4000-a000-0000000000d3'));
select pg_temp.check('the month and year of birth are removed from the accounts'' metadata',
  not exists (select 1 from auth.users where id::text like '00000000-0000-4000-a000-0000000000d%'
              and raw_user_meta_data ?| array['birth_month', 'birth_year', 'invite_code']));
select pg_temp.check('the birth year is nowhere in the account rows',
  not exists (select 1 from app_user u where u.id = '00000000-0000-4000-a000-0000000000d1'
              and u::text like '%' || extract(year from current_date - interval '30 years')::int || '%')
  and not exists (select 1 from auth.users a where a.id = '00000000-0000-4000-a000-0000000000d1'
              and a.raw_user_meta_data::text like '%' || extract(year from current_date - interval '30 years')::int || '%'));
select pg_temp.check('the new accounts still get their built-in spaces',
  (select count(*) = 4 from space where owner_user_id = '00000000-0000-4000-a000-0000000000d1' and built_in is not null));

-- ---------- A (made before; not asked yet) ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('not asked yet: not 21 for drinks',
  my_age_status() = '{"asked": false, "is_21": false, "alcohol_from": null}'::jsonb and not is_21());
do $$
begin
  perform set_birth_month(13, 1990);
  perform pg_temp.check('an impossible month is refused', false, 'allowed');
exception when invalid_parameter_value then
  perform pg_temp.check('an impossible month is refused, without repeating it', sqlerrm not like '%1990%' and sqlerrm not like '%13%', sqlerrm);
end $$;
do $$
begin
  perform set_birth_month(extract(month from current_date)::int, extract(year from current_date)::int + 1);
  perform pg_temp.check('a date in the future is refused', false, 'allowed');
exception when invalid_parameter_value then
  perform pg_temp.check('a date in the future is refused', true, sqlerrm);
end $$;
select pg_temp.check('35 years old: 21 or over, no date kept or shown',
  set_birth_month(5, extract(year from current_date)::int - 35) = '{"asked": true, "is_21": true, "alcohol_from": null}'::jsonb);
select pg_temp.check('is_21() then says yes', is_21());
do $$
begin
  perform set_birth_month(5, 2015);
  perform pg_temp.check('set once: a second answer is refused', false, 'allowed');
exception when raise_exception then
  perform pg_temp.check('set once: a second answer is refused (support fixes a mistake)', sqlerrm like 'Your age is already set%', sqlerrm);
end $$;
do $$
begin
  update app_user set alcohol_from = '-infinity';
  perform pg_temp.check('nobody writes alcohol_from directly', false, 'update allowed');
exception when insufficient_privilege then
  perform pg_temp.check('nobody writes alcohol_from directly', true, sqlerrm);
end $$;
reset role;

-- ---------- B: 21 exactly this month, so cocktails open next month ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('born this month 21 years ago: not yet 21 (never early), cocktails from next month',
  set_birth_month(extract(month from current_date)::int, extract(year from current_date)::int - 21)
    = jsonb_build_object('asked', true, 'is_21', false,
                         'alcohol_from', to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM-DD'))
  and not is_21());
select pg_temp.check('B''s status is their own, not A''s', (my_age_status() ->> 'is_21')::boolean = false);
reset role;

-- ---------- anon ----------
set local role anon;
do $$
declare
  t text;
begin
  foreach t in array array['select my_age_status()', 'select is_21()', 'select set_birth_month(5, 1990)',
                           'select _alcohol_from(5, 1990, current_date)', 'select _meta_int(''5'')']
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

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
do $$
begin
  perform _alcohol_from(5, 1990, current_date);
  perform pg_temp.check('the helpers are not callable by users', false, 'allowed');
exception when insufficient_privilege then
  perform pg_temp.check('the helpers are not callable by users', true, sqlerrm);
end $$;
reset role;

-- ---------- Deleting the account removes the result ----------
delete from auth.users where id = '00000000-0000-4000-a000-0000000000d1';
select pg_temp.check('deleting an account removes what was kept',
  not exists (select 1 from app_user where id = '00000000-0000-4000-a000-0000000000d1'));
