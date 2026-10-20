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
