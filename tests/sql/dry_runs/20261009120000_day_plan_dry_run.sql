-- Dry run of supabase/migrations/20261009120000_day_plan.sql with tests/sql/13_day_plan.sql, built by
-- tests/sql/dry_run.sh. Paste all of it into the Supabase SQL editor: it ends with the error
-- "DRY RUN RESULTS (rolled back): [...]" and keeps nothing. Every item must say "ok": true.
begin;
-- Pro and the day planner's fair use (docs/phase6-day-planner-step2-plan.md, "Premium").
--
--   * app_user.plan: 'free' (the default) or 'pro'. Planning the day is a Pro feature (owner,
--     2026-10-08). People read their own plan (the app shows the Pro badge from it) but never
--     change it: only admin_set_plan() does, until Google Play purchases set it (later), and Pro
--     tester invite codes will set it at sign-up (docs/signup-plan.md Q9).
--   * day_plan_usage: how many day plans each person asked for on each day (UTC). People read
--     their own rows; nobody writes the table directly. The chat function's day route calls
--     use_day_plan() as the signed-in user before planning: it says whether the person is Pro and
--     under the day's fair-use limit, and counts the plan only then.
--   * The limit is data, not code: ai_settings.day_plans_per_day (30; Q11).
--
-- Every row stays owned (CLAUDE.md rule 5); the admin changes plans only, as with AI limits.

-- =========================================================
-- Tables and columns
-- =========================================================

alter table app_user
  add column plan text not null default 'free'
  constraint app_user_plan_check check (plan in ('free', 'pro'));

alter table ai_settings
  add column day_plans_per_day int not null default 30
  constraint ai_settings_day_plans_check check (day_plans_per_day between 0 and 1000);

create table day_plan_usage (
  user_id     uuid not null references app_user (id) on delete cascade,
  day         date not null,
  plans       int not null default 0 check (plans >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table day_plan_usage enable row level security;
create policy day_plan_usage_own on day_plan_usage for select using (user_id = auth.uid());

-- =========================================================
-- Functions
-- =========================================================

-- Before a day plan: is the caller Pro and under today's limit? Counts the plan only when allowed.
-- {"allowed": true, "used": n, "limit": l} or {"allowed": false, "reason": "pro_required" | "fair_use", ...}
create function use_day_plan() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limit int;
  v_day date := (now() at time zone 'utc')::date;
  v_used int;
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  select u.plan into v_plan from public.app_user u where u.id = v_uid;
  if coalesce(v_plan, 'free') <> 'pro' then
    return jsonb_build_object('allowed', false, 'reason', 'pro_required');
  end if;
  select s.day_plans_per_day into v_limit from public.ai_settings s;
  -- One row per person and day, locked while it is counted, so two plans at once cannot both
  -- slip under the limit.
  insert into public.day_plan_usage (user_id, day) values (v_uid, v_day)
  on conflict (user_id, day) do nothing;
  select d.plans into v_used from public.day_plan_usage d
  where d.user_id = v_uid and d.day = v_day for update;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'fair_use', 'used', v_used, 'limit', v_limit);
  end if;
  update public.day_plan_usage set plans = plans + 1, updated_at = now()
  where user_id = v_uid and day = v_day;
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit);
end;
$$;

-- A person's plan, set by the admin ('free' or 'pro').
create function admin_set_plan(p_user_id uuid, p_plan text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_plan is null or p_plan not in ('free', 'pro') then
    raise exception 'plan must be free or pro' using errcode = '22023';
  end if;
  update public.app_user set plan = p_plan where id = p_user_id;
  if not found then raise exception 'no such person' using errcode = 'P0002'; end if;
  return jsonb_build_object('user_id', p_user_id, 'plan', p_plan);
end;
$$;

-- =========================================================
-- Privileges
-- =========================================================

revoke all on day_plan_usage from public, anon, authenticated;
grant select on day_plan_usage to authenticated;  -- RLS: own rows only
-- A person reads their own plan (RLS policy app_user_self); no update grant, so never changes it.
grant select (plan) on app_user to authenticated;

revoke execute on function use_day_plan(), admin_set_plan(uuid, text) from public, anon;
grant execute on function use_day_plan(), admin_set_plan(uuid, text) to authenticated;
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
-- Test: Pro and the day planner's fair use (20261009120000_day_plan.sql). Free by default; a person
-- reads but never changes their plan; use_day_plan refuses Free, counts Pro plans and stops at the
-- day's limit; only the admin sets a plan; nobody reads another person's count; anon gets nothing.

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('a new person is on Free',
  (select plan = 'free' from app_user where id = auth.uid()));
select pg_temp.check('Free: a day plan is refused as pro_required',
  (select use_day_plan() = '{"allowed": false, "reason": "pro_required"}'::jsonb));
select pg_temp.check('a refused plan is not counted',
  (select count(*) = 0 from day_plan_usage));

do $$
begin
  update app_user set plan = 'pro' where id = auth.uid();
  perform pg_temp.check('a person cannot make themselves Pro', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('a person cannot make themselves Pro', true, sqlerrm);
end $$;
do $$
begin
  perform admin_set_plan(auth.uid(), 'pro');
  perform pg_temp.check('a non-admin cannot set a plan', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a non-admin cannot set a plan', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  insert into day_plan_usage (user_id, day, plans) values (auth.uid(), '2000-01-01', 0);
  perform pg_temp.check('nobody writes plan counts directly', false, 'insert succeeded');
exception when others then
  perform pg_temp.check('nobody writes plan counts directly', sqlstate = '42501', sqlerrm);
end $$;

-- ---------- B is the admin and makes A Pro; the day's limit is set to 2 for the test ----------
reset role;
update app_user set is_admin = true where id = '00000000-0000-4000-a000-00000000000b';
update ai_settings set day_plans_per_day = 2;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('the admin sets A to Pro',
  (select admin_set_plan('00000000-0000-4000-a000-00000000000a', 'pro')->>'plan' = 'pro'));
do $$
begin
  perform admin_set_plan('00000000-0000-4000-a000-00000000000a', 'gold');
  perform pg_temp.check('only free or pro', false, 'accepted');
exception when others then
  perform pg_temp.check('only free or pro', sqlstate = '22023', sqlerrm);
end $$;
select pg_temp.check('B (Free) still cannot plan',
  (select use_day_plan()->>'reason' = 'pro_required'));

-- ---------- A, now Pro ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('A reads Pro',
  (select plan = 'pro' from app_user where id = auth.uid()));
select pg_temp.check('first plan of the day is allowed and counted',
  (select use_day_plan() = '{"allowed": true, "used": 1, "limit": 2}'::jsonb));
select pg_temp.check('second plan is allowed',
  (select (use_day_plan()->>'allowed')::boolean));
select pg_temp.check('third plan is over the fair-use limit',
  (select use_day_plan() = '{"allowed": false, "reason": "fair_use", "used": 2, "limit": 2}'::jsonb));
select pg_temp.check('A reads their own count: 2',
  (select plans = 2 from day_plan_usage where user_id = auth.uid()));
do $$
begin
  update day_plan_usage set plans = 0 where user_id = auth.uid();
  perform pg_temp.check('nobody resets their own count', false, 'update succeeded');
exception when others then
  perform pg_temp.check('nobody resets their own count', sqlstate = '42501', sqlerrm);
end $$;

-- ---------- B cannot see A's count ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('B sees no plan counts of A',
  (select count(*) = 0 from day_plan_usage where user_id = '00000000-0000-4000-a000-00000000000a'));
select pg_temp.check('B cannot read A''s plan',
  (select count(*) = 0 from app_user where id = '00000000-0000-4000-a000-00000000000a'));

-- ---------- anonymous caller ----------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  perform use_day_plan();
  perform pg_temp.check('anon cannot ask for a plan', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot ask for a plan', true, sqlerrm);
end $$;
do $$
begin
  perform plan from app_user;
  perform pg_temp.check('anon cannot read plans', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read plans', true, sqlerrm);
end $$;
do $$
begin
  perform 1 from day_plan_usage;
  perform pg_temp.check('anon cannot read plan counts', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read plan counts', true, sqlerrm);
end $$;
reset role;
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
