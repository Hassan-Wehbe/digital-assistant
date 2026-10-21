begin;
-- Ages, step 1 (docs/age-plan.md, D44; owner's answers 2026-10-20: all as recommended, Q5 option B):
-- the age check, keeping only its result.
--
--   * app_user.alcohol_from: the first day of the month after the person turns 21 (so never early,
--     at most a month late), or '-infinity' once they are 21 or over. That is all Wilma keeps: the
--     month and year of birth are used to work it out and are never written to a table, a log or an
--     error message. null: not asked yet (accounts made before this, and older app versions);
--     treated as under 21 for drinks (Q6).
--   * Sign-up: the app sends birth_month and birth_year with the sign-up. The Before User Created
--     hook checks them against signup_setting.min_age (18 now; 13 after the lawyer, step 4, Q10)
--     and refuses an account under it, keeping nothing. The sign-up trigger stores only
--     alcohol_from and removes birth_month and birth_year from the account's metadata, as it does
--     the invite code. Older app versions still send the 18+ box (age_confirmed) and no date: that
--     still works, and they are asked once later.
--   * set_birth_month(month, year): for accounts made before (asked once in the app). Only when not
--     yet set (Q7: a mistake goes through support).
--   * is_21() and my_age_status(): read the caller's own row only. The drinks rules that use them
--     (Mocktails under 21) are step 2.
--
-- Every row stays owned (CLAUDE.md rule 5): no one reads or writes alcohol_from directly; the
-- functions act on the caller's own row. Nothing new is granted to anon.

-- =========================================================
-- Columns
-- =========================================================

alter table app_user add column alcohol_from date;

alter table signup_setting
  add column min_age int not null default 18 constraint signup_setting_min_age_check check (min_age between 13 and 21);

-- =========================================================
-- Helpers (no one calls these directly)
-- =========================================================

-- A whole number from the sign-up metadata (a JSON number), or null.
create function _meta_int(p_value jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'number' and p_value::text ~ '^[0-9]{1,4}$' then p_value::text::int end;
$$;

-- A month and year of birth that can be real: month 1-12, from 1900, not after this month.
create function _birth_ok(p_month int, p_year int, p_today date) returns boolean
language sql immutable set search_path = '' as $$
  select p_month between 1 and 12 and p_year between 1900 and extract(year from p_today)::int
         and make_date(p_year, p_month, 1) <= p_today;
$$;

-- Whether someone born in that month is surely p_age today: counted from the first day of the
-- month after their birthday month, so never early.
create function _age_reached(p_month int, p_year int, p_age int, p_today date) returns boolean
language sql immutable set search_path = '' as $$
  select (make_date(p_year + p_age, p_month, 1) + interval '1 month')::date <= p_today;
$$;

-- What is kept (Q5 option B): '-infinity' when 21 or over, else the day cocktails open.
create function _alcohol_from(p_month int, p_year int, p_today date) returns date
language sql immutable set search_path = '' as $$
  select case when public._age_reached(p_month, p_year, 21, p_today) then '-infinity'::date
              else (make_date(p_year + 21, p_month, 1) + interval '1 month')::date end;
$$;

-- =========================================================
-- Sign-up
-- =========================================================

-- Supabase Auth's Before User Created hook (from 20261011120000_invite_signup.sql): the invite
-- code as before; then either the month and year of birth (newer apps) or the 18+ box (older apps).
create or replace function hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_setting public.signup_setting;
  v_code public.invite_code;
  v_problem text;
  v_month int := public._meta_int(v_meta -> 'birth_month');
  v_year int := public._meta_int(v_meta -> 'birth_year');
begin
  select * into v_setting from public.signup_setting;
  if nullif(btrim(v_meta ->> 'invite_code'), '') is null then
    if coalesce(v_setting.signup_mode, 'invite') = 'invite' then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', 'An invite code is needed to create an account.'));
    end if;
  else
    select * into v_code from public.invite_code
    where code_hash = public.invite_code_hash(v_meta ->> 'invite_code');
    v_problem := public.invite_code_problem(v_code);
    if v_problem is not null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', v_problem));
    end if;
  end if;

  if v_meta ? 'birth_month' or v_meta ? 'birth_year' then
    -- The messages never repeat the date.
    if v_month is null or v_year is null or not public._birth_ok(v_month, v_year, current_date) then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', 'Please enter your month and year of birth.'));
    end if;
    if not public._age_reached(v_month, v_year, coalesce(v_setting.min_age, 18), current_date) then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', format('Wilma is for people %s and over.', coalesce(v_setting.min_age, 18))));
    end if;
    if v_meta ->> 'terms_version' is distinct from v_setting.terms_version then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', 'Please accept the privacy policy and testing terms.'));
    end if;
    return '{}'::jsonb;
  end if;

  if v_meta -> 'age_confirmed' is distinct from 'true'::jsonb
     or v_meta ->> 'terms_version' is distinct from v_setting.terms_version then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Please confirm you are 18 or older and accept the privacy policy and testing terms.'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- The sign-up trigger (last changed in 20261012120000_memory_builtin_spaces.sql; the invite code,
-- the account and the built-in spaces are as there). New: alcohol_from from the month and year of
-- birth, which are then removed from the account's metadata.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code public.invite_code;
  v_problem text;
  v_terms text := (select s.terms_version from public.signup_setting s);
  v_min_age int := coalesce((select s.min_age from public.signup_setting s), 18);
  v_month int := public._meta_int(v_meta -> 'birth_month');
  v_year int := public._meta_int(v_meta -> 'birth_year');
  v_birth boolean;
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
  v_birth := coalesce(v_month is not null and v_year is not null and public._birth_ok(v_month, v_year, current_date), false);
  v_accepted := v_meta ->> 'terms_version' = v_terms
    and (v_meta -> 'age_confirmed' = 'true'::jsonb
         or (v_birth and public._age_reached(v_month, v_year, v_min_age, current_date)));

  insert into public.app_user (id, email, display_name, plan, terms_version, terms_accepted_at, age_confirmed, alcohol_from)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name',
          coalesce(v_code.grants_plan, 'free'),
          case when v_accepted then v_terms end,
          case when v_accepted then now() end,
          coalesce(v_accepted, false),
          case when v_birth then public._alcohol_from(v_month, v_year, current_date) end)
  on conflict (id) do nothing;

  if v_code.id is not null then
    update public.invite_code set uses = uses + 1 where id = v_code.id;
    insert into public.invite_use (invite_code_id, user_id) values (v_code.id, new.id)
    on conflict do nothing;
  end if;
  -- The code and the month and year of birth have done their job; none is kept with the account.
  if v_meta ?| array['invite_code', 'birth_month', 'birth_year'] then
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'invite_code' - 'birth_month' - 'birth_year'
    where id = new.id;
  end if;

  -- The built-in spaces, owned by the new account (Tasks, Memories, Recipes, Cocktails).
  if exists (select 1 from public.app_user u where u.id = new.id) then
    perform public._ensure_built_in_spaces(new.id);
  end if;
  return new;
end;
$$;

-- =========================================================
-- For a signed-in person: their own row only
-- =========================================================

-- What the app shows: asked yet, 21 or over, and when cocktails open (never the birth date).
create function my_age_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'asked', u.alcohol_from is not null,
    'is_21', coalesce(u.alcohol_from <= current_date, false),
    'alcohol_from', case when u.alcohol_from > current_date then to_char(u.alcohol_from, 'YYYY-MM-DD') end)
  from public.app_user u where u.id = auth.uid();
$$;

-- For the server's drinks rules (step 2): false when not asked yet.
create function is_21() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.alcohol_from <= current_date from public.app_user u where u.id = auth.uid()), false);
$$;

-- Accounts made before this, asked once in the app. Set once (Q7); the month and year are only
-- used to work out alcohol_from, and no message repeats them.
create function set_birth_month(p_month int, p_year int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_from date;
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  select u.alcohol_from into v_from from public.app_user u where u.id = v_uid for update;
  if not found then raise exception 'no such person' using errcode = 'P0002'; end if;
  if v_from is not null then
    raise exception 'Your age is already set. If it is wrong, contact us.' using errcode = 'P0001';
  end if;
  if p_month is null or p_year is null or not public._birth_ok(p_month, p_year, current_date) then
    raise exception 'Please enter a real month and year of birth.' using errcode = '22023';
  end if;
  update public.app_user set alcohol_from = public._alcohol_from(p_month, p_year, current_date) where id = v_uid;
  return public.my_age_status();
end;
$$;

-- =========================================================
-- Privileges
-- =========================================================

revoke execute on function _meta_int(jsonb), _birth_ok(int, int, date), _age_reached(int, int, int, date),
  _alcohol_from(int, int, date), hook_before_user_created(jsonb), handle_new_auth_user()
  from public, anon, authenticated;
revoke execute on function my_age_status(), is_21(), set_birth_month(int, int) from public, anon;
grant execute on function my_age_status(), is_21(), set_birth_month(int, int) to authenticated;
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
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
