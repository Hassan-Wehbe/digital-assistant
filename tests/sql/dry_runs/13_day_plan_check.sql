-- SQL test 13 (Pro and fair use) against the live database, after migration 20261009120000_day_plan.sql
-- was applied. Paste all of it into the Supabase SQL editor: it ends with the error
-- "TEST RESULTS (rolled back): [...]" and keeps nothing. Every item must say "ok": true.
begin;
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
do $$ begin raise exception 'TEST RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed) order by n) from _results); end $$;
