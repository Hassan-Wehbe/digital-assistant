begin;
-- Recipes and cocktails, step 5 (docs/recipes-plan.md, D43; owner's answers 2026-10-20, Q10): the
-- daily count of "What's for dinner?" and "Make a cocktail" suggestions.
--
--   * Everyone may ask (not a Pro feature): up to ai_settings.free_suggestions_per_day a day (10),
--     and ai_settings.pro_suggestions_per_day (50) with Pro. The limits are data, not code.
--   * recipe_suggestion_usage: how many each person asked for on each day (UTC). People read their
--     own rows; nobody writes the table directly. The chat function's suggestion route calls
--     use_recipe_suggestion() as the signed-in user before its AI request: it says whether the
--     person is under today's limit, and counts the suggestion only then (as use_day_plan()).
--   * Each suggestion is also an AI request, counted against the month's AI allowance as before.
--
-- Every row stays owned (CLAUDE.md rule 5). Nothing is granted to anon.

alter table ai_settings
  add column free_suggestions_per_day int not null default 10
    constraint ai_settings_free_suggestions_check check (free_suggestions_per_day between 0 and 1000),
  add column pro_suggestions_per_day int not null default 50
    constraint ai_settings_pro_suggestions_check check (pro_suggestions_per_day between 0 and 1000);

create table recipe_suggestion_usage (
  user_id     uuid not null references app_user (id) on delete cascade,
  day         date not null,
  used        int not null default 0 check (used >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table recipe_suggestion_usage enable row level security;
create policy recipe_suggestion_usage_own on recipe_suggestion_usage for select using (user_id = auth.uid());

-- Before a suggestion: is the caller under today's limit (Pro's or everyone's)? Counts it only when
-- allowed. {"allowed": true, "used": n, "limit": l, "pro": bool} or
-- {"allowed": false, "reason": "limit", "used": n, "limit": l, "pro": bool}
create function use_recipe_suggestion() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_pro boolean;
  v_limit int;
  v_day date := (now() at time zone 'utc')::date;
  v_used int;
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  select coalesce(u.plan, 'free') = 'pro' into v_pro from public.app_user u where u.id = v_uid;
  if v_pro is null then raise exception 'no such person' using errcode = 'P0002'; end if;
  select case when v_pro then s.pro_suggestions_per_day else s.free_suggestions_per_day end
  into v_limit from public.ai_settings s;
  -- One row per person and day, locked while it is counted, so two at once cannot both slip under.
  insert into public.recipe_suggestion_usage (user_id, day) values (v_uid, v_day)
  on conflict (user_id, day) do nothing;
  select r.used into v_used from public.recipe_suggestion_usage r
  where r.user_id = v_uid and r.day = v_day for update;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used, 'limit', v_limit, 'pro', v_pro);
  end if;
  update public.recipe_suggestion_usage set used = used + 1, updated_at = now()
  where user_id = v_uid and day = v_day;
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit, 'pro', v_pro);
end;
$$;

revoke all on recipe_suggestion_usage from public, anon, authenticated;
grant select on recipe_suggestion_usage to authenticated;  -- RLS: own rows only

revoke execute on function use_recipe_suggestion() from public, anon;
grant execute on function use_recipe_suggestion() to authenticated;
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
-- Test: the daily count of recipe and cocktail suggestions (20261022120000_recipe_suggestions.sql,
-- docs/recipes-plan.md step 5, Q10). Everyone may ask, up to the Free limit a day; Pro gets the
-- higher limit; a refused one is not counted; each person counts separately and reads only their
-- own count; nobody writes it directly; anon gets nothing.

-- Small limits for the test (as the owner); both are settings, not code.
update ai_settings set free_suggestions_per_day = 2, pro_suggestions_per_day = 3;
select pg_temp.check('the limits default to 10 Free and 50 Pro',
  (select column_default = '10' from information_schema.columns
   where table_name = 'ai_settings' and column_name = 'free_suggestions_per_day')
  and (select column_default = '50' from information_schema.columns
       where table_name = 'ai_settings' and column_name = 'pro_suggestions_per_day'));

-- ---------- A, on Free ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('Free: the first suggestion is allowed and counted',
  (select use_recipe_suggestion() = '{"allowed": true, "used": 1, "limit": 2, "pro": false}'::jsonb));
select pg_temp.check('the second too',
  (select (use_recipe_suggestion()->>'used')::int = 2));
select pg_temp.check('the third is over the Free limit',
  (select use_recipe_suggestion() = '{"allowed": false, "reason": "limit", "used": 2, "limit": 2, "pro": false}'::jsonb));
select pg_temp.check('a refused one is not counted',
  (select used = 2 from recipe_suggestion_usage where user_id = auth.uid()));
do $$
begin
  update recipe_suggestion_usage set used = 0;
  perform pg_temp.check('nobody resets their own count', (select used = 2 from recipe_suggestion_usage), 'update allowed');
exception when insufficient_privilege then
  perform pg_temp.check('nobody resets their own count', true, sqlerrm);
end $$;
do $$
begin
  insert into recipe_suggestion_usage (user_id, day, used) values (auth.uid(), '2000-01-01', 0);
  perform pg_temp.check('nobody writes counts directly', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('nobody writes counts directly', true, sqlerrm);
end $$;

-- ---------- B, on Pro: their own, higher count ----------
reset role;
update app_user set plan = 'pro' where id = '00000000-0000-4000-a000-00000000000b';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('Pro: counted separately from A, with the Pro limit',
  (select use_recipe_suggestion() = '{"allowed": true, "used": 1, "limit": 3, "pro": true}'::jsonb));
select use_recipe_suggestion();
select pg_temp.check('Pro: the third is still allowed',
  (select (use_recipe_suggestion()->>'allowed')::boolean));
select pg_temp.check('Pro: the fourth is over the Pro limit',
  (select use_recipe_suggestion()->>'reason' = 'limit'));
select pg_temp.check('B reads only their own count',
  (select count(*) = 1 and bool_and(user_id = auth.uid()) from recipe_suggestion_usage));

-- ---------- anon ----------
reset role;
set local role anon;
do $$
begin
  perform use_recipe_suggestion();
  perform pg_temp.check('anon cannot ask', false, 'allowed');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot ask', true, sqlerrm);
end $$;
do $$
begin
  perform count(*) from recipe_suggestion_usage;
  perform pg_temp.check('anon cannot read counts', false, 'read allowed');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read counts', true, sqlerrm);
end $$;
reset role;

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform use_recipe_suggestion();
  perform pg_temp.check('without a signed-in user, nothing is counted', false, 'allowed');
exception when others then
  perform pg_temp.check('without a signed-in user, nothing is counted', sqlstate = '42501', sqlerrm);
end $$;

-- ---------- Deleting the account removes its counts ----------
delete from auth.users where id = '00000000-0000-4000-a000-00000000000a';
select pg_temp.check('deleting an account removes its counts',
  not exists (select 1 from recipe_suggestion_usage where user_id = '00000000-0000-4000-a000-00000000000a'));
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
