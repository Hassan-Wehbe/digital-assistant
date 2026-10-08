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
