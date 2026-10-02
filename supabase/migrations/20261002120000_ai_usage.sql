-- AI allowance for the chat function (docs/phase5-a5b-chat-function-plan.md, design.md D22).
--
--   * ai_usage: one row per person per month (UTC): cost in cents and number of requests.
--     People read only their own rows; nobody writes the table directly. The chat function
--     adds to it through record_ai_usage(), as the signed-in user, which only ever adds.
--   * Limits are data, not code: ai_settings holds the default monthly limit (100 cents = $1),
--     app_user.ai_monthly_limit_cents an optional personal limit (null = the default).
--   * app_user.is_admin and the admin_* functions: the admin sees and changes usage figures and
--     limits only, never notes, spaces, secrets or conversations. This is the one documented
--     exception to "every row is owned" (CLAUDE.md rule 5), limited to these numbers.
--     is_admin is not writable by users: it is set by hand in the database.

-- =========================================================
-- Tables and columns
-- =========================================================

create table ai_settings (
  id                           boolean primary key default true check (id),  -- exactly one row
  default_monthly_limit_cents  numeric(10,2) not null default 100
                               check (default_monthly_limit_cents between 0 and 100000),
  updated_at                   timestamptz not null default now()
);
insert into ai_settings default values;

alter table app_user
  add column ai_monthly_limit_cents numeric(10,2)
    constraint app_user_ai_limit_check check (ai_monthly_limit_cents between 0 and 100000),
  add column is_admin boolean not null default false;

create table ai_usage (
  user_id     uuid not null references app_user (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  cost_cents  numeric(14,6) not null default 0 check (cost_cents >= 0),
  requests    int not null default 0 check (requests >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, month)
);

alter table ai_settings enable row level security;
alter table ai_usage    enable row level security;

create policy ai_usage_own on ai_usage for select using (user_id = auth.uid());
-- ai_settings: no policies; read through my_ai_allowance(), changed through admin_set_default_limit().

-- =========================================================
-- Functions
-- =========================================================

-- The current month, as stored in ai_usage (UTC, so it resets at the same moment for everyone).
create function ai_month() returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'utc')::date;
$$;

-- The caller's allowance this month: what the chat function checks before calling the model.
create function my_ai_allowance() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_limit numeric;
  v_used numeric;
  v_requests int;
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  select coalesce(u.ai_monthly_limit_cents, s.default_monthly_limit_cents) into v_limit
  from public.app_user u cross join public.ai_settings s where u.id = v_uid;
  if v_limit is null then raise exception 'no account' using errcode = 'P0002'; end if;
  select coalesce(sum(a.cost_cents), 0), coalesce(sum(a.requests), 0) into v_used, v_requests
  from public.ai_usage a where a.user_id = v_uid and a.month = public.ai_month();
  return jsonb_build_object(
    'month', public.ai_month(),
    'used_cents', round(v_used, 4),
    'requests', v_requests,
    'limit_cents', v_limit,
    'used_fraction', case when v_limit = 0 then 1 else round(least(v_used / v_limit, 1), 4) end);
end;
$$;

-- Adds one request's cost to the caller's month. Only ever adds: a negative, missing or
-- oversized amount (over 100 cents, far above any single chat message) is refused.
create function record_ai_usage(p_cost_cents numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  if p_cost_cents is null or p_cost_cents < 0 or p_cost_cents > 100 then
    raise exception 'cost must be between 0 and 100 cents' using errcode = '22023';
  end if;
  insert into public.ai_usage as a (user_id, month, cost_cents, requests)
  values (v_uid, public.ai_month(), p_cost_cents, 1)
  on conflict (user_id, month) do update
    set cost_cents = a.cost_cents + excluded.cost_cents,
        requests = a.requests + 1,
        updated_at = now();
  return public.my_ai_allowance();
end;
$$;

-- ---------- admin: usage figures and limits only ----------

create function require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select u.is_admin from public.app_user u where u.id = auth.uid()), false) then
    raise exception 'admin only' using errcode = '42501';
  end if;
end;
$$;

-- Everyone's usage this month and limit. Email and numbers only.
create function admin_ai_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'month', public.ai_month(),
    'default_limit_cents', (select s.default_monthly_limit_cents from public.ai_settings s),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', u.id,
               'email', u.email,
               'used_cents', round(coalesce(a.cost_cents, 0), 4),
               'requests', coalesce(a.requests, 0),
               'personal_limit_cents', u.ai_monthly_limit_cents,
               'limit_cents', coalesce(u.ai_monthly_limit_cents, s.default_monthly_limit_cents))
             order by u.email)
      from public.app_user u
      cross join public.ai_settings s
      left join public.ai_usage a on a.user_id = u.id and a.month = public.ai_month()), '[]'::jsonb));
end;
$$;

-- A person's own limit; null goes back to the default.
create function admin_set_ai_limit(p_user_id uuid, p_cents numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_cents is not null and (p_cents < 0 or p_cents > 100000) then
    raise exception 'limit must be between 0 and 100000 cents' using errcode = '22023';
  end if;
  update public.app_user set ai_monthly_limit_cents = p_cents where id = p_user_id;
  if not found then raise exception 'no such person' using errcode = 'P0002'; end if;
  return jsonb_build_object('user_id', p_user_id, 'personal_limit_cents', p_cents);
end;
$$;

create function admin_set_default_limit(p_cents numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_cents is null or p_cents < 0 or p_cents > 100000 then
    raise exception 'limit must be between 0 and 100000 cents' using errcode = '22023';
  end if;
  update public.ai_settings set default_monthly_limit_cents = p_cents, updated_at = now() where id;
  return jsonb_build_object('default_limit_cents', p_cents);
end;
$$;

-- =========================================================
-- Privileges
-- =========================================================

revoke all on ai_settings, ai_usage from public, anon, authenticated;
grant select on ai_usage to authenticated;  -- RLS: own rows only
-- A person may read their own limit and whether they are the admin (the app shows the admin
-- screen only then); neither is writable (no update grant).
grant select (ai_monthly_limit_cents, is_admin) on app_user to authenticated;

revoke execute on function
  ai_month(), my_ai_allowance(), record_ai_usage(numeric), require_admin(),
  admin_ai_overview(), admin_set_ai_limit(uuid, numeric), admin_set_default_limit(numeric)
  from public, anon;
grant execute on function
  ai_month(), my_ai_allowance(), record_ai_usage(numeric),
  admin_ai_overview(), admin_set_ai_limit(uuid, numeric), admin_set_default_limit(numeric)
  to authenticated;
