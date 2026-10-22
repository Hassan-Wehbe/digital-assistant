-- Usage tracking, step 1 (docs/usage-tracking-plan.md; design D34; owner's answers 2026-10-22: all
-- as recommended). Counts per user per UTC day, never content: AI by purpose with tokens and the
-- model, Mapbox and weather requests, features, errors. Written by the server after each reply
-- (step 2) through one function; read only by admins (the admin page, steps 3-4).
--
--   * usage_day: one row per user, UTC day (Q1), kind and detail, added to. `detail` is a model
--     name, a tool name, an error code or a feature: a short fixed-shape word, never text a user
--     wrote (lower-case letters, digits and . _ : / -, at most 60).
--   * user_day: the days a user was active, with Free or Pro that day.
--   * usage_snapshot: notes, memories and attachment storage per user, once a month (Q4).
--   * record_usage(rows): the caller's own rows only, each checked and capped.
--   * am_i_admin(), and admin_* functions behind require_admin(): figures and user ids only; an
--     email only for one user at a time (Q2). admin_usage_maintenance() takes this month's snapshot
--     and deletes rows older than 13 months (Q3); the admin page calls it when opened.
--
-- RLS on every table: a user reads only their own rows; nobody writes directly. Rows go with the
-- account (on delete cascade). Nothing for anon.

create table usage_day (
  user_id        uuid not null references app_user (id) on delete cascade,
  day            date not null,
  kind           text not null check (kind in (
                   'chat', 'day_plan', 'classify', 'memory', 'outing', 'recipe_suggest', 'recipe_import',
                   'mapbox', 'weather', 'google_places',
                   'message', 'save', 'search', 'memory_kept', 'fair_use_hit', 'error', 'mcp_call')),
  detail         text not null default '' check (detail ~ '^[a-z0-9._:/-]{0,60}$'),
  count          int not null default 0 check (count >= 0),
  model_calls    int not null default 0 check (model_calls >= 0),
  input_tokens   bigint not null default 0 check (input_tokens >= 0),
  cached_tokens  bigint not null default 0 check (cached_tokens >= 0),
  output_tokens  bigint not null default 0 check (output_tokens >= 0),
  cost_cents     numeric(14,6) not null default 0 check (cost_cents >= 0),
  failures       int not null default 0 check (failures >= 0),
  updated_at     timestamptz not null default now(),
  primary key (user_id, day, kind, detail)
);
create index usage_day_day_idx on usage_day (day);

create table user_day (
  user_id  uuid not null references app_user (id) on delete cascade,
  day      date not null,
  plan     text not null,
  primary key (user_id, day)
);
create index user_day_day_idx on user_day (day);

create table usage_snapshot (
  user_id        uuid not null references app_user (id) on delete cascade,
  month          date not null check (extract(day from month) = 1),
  notes          int not null default 0,
  memories       int not null default 0,
  storage_bytes  bigint not null default 0,
  taken_at       timestamptz not null default now(),
  primary key (user_id, month)
);

alter table usage_day enable row level security;
alter table user_day enable row level security;
alter table usage_snapshot enable row level security;
create policy usage_day_own on usage_day for select using (user_id = auth.uid());
create policy user_day_own on user_day for select using (user_id = auth.uid());
create policy usage_snapshot_own on usage_snapshot for select using (user_id = auth.uid());
revoke all on usage_day, user_day, usage_snapshot from anon;
revoke insert, update, delete, truncate on usage_day, user_day, usage_snapshot from authenticated;
grant select on usage_day, user_day, usage_snapshot to authenticated;

-- The UTC day (Q1), as ai_month() is the UTC month.
create function usage_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'utc')::date;
$$;

-- =========================================================
-- Writing: the caller's own rows
-- =========================================================

-- p_rows: a JSON array of at most 20 objects {kind, detail?, count?, model_calls?, input_tokens?,
-- cached_tokens?, output_tokens?, cost_cents?, failures?}. Anything else, a field out of range or
-- an unknown kind refuses the whole call (nothing is written).
create function record_usage(p_rows jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.usage_today();
  v_row jsonb;
  v_key text;
  v_int int;
  v_big bigint;
  v_cost numeric;
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'rows must be an array of at most 20' using errcode = '22023';
  end if;
  -- Check every row first: all or nothing.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'each row must be an object' using errcode = '22023'; end if;
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('kind', 'detail', 'count', 'model_calls', 'input_tokens', 'cached_tokens', 'output_tokens', 'cost_cents', 'failures') then
        raise exception 'unknown field %', left(v_key, 40) using errcode = '22023';
      end if;
      if v_key not in ('kind', 'detail') and jsonb_typeof(v_row -> v_key) <> 'number' then
        raise exception '% must be a number', v_key using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(v_row -> 'kind') <> 'string' then raise exception 'kind is required' using errcode = '22023'; end if;
    if v_row ? 'detail' and (jsonb_typeof(v_row -> 'detail') <> 'string' or (v_row ->> 'detail') !~ '^[a-z0-9._:/-]{0,60}$') then
      raise exception 'detail must be a short name' using errcode = '22023';
    end if;
    v_cost := coalesce((v_row ->> 'cost_cents')::numeric, 0);
    if v_cost < 0 or v_cost > 5 then raise exception 'cost must be between 0 and 5 cents' using errcode = '22023'; end if;
    foreach v_key in array array['count', 'model_calls', 'failures'] loop
      if v_row ? v_key then
        v_big := (v_row ->> v_key)::numeric;
        if v_big < 0 or v_big > 100 or (v_row ->> v_key)::numeric <> v_big then
          raise exception '% must be a whole number from 0 to 100', v_key using errcode = '22023';
        end if;
      end if;
    end loop;
    foreach v_key in array array['input_tokens', 'cached_tokens', 'output_tokens'] loop
      if v_row ? v_key then
        v_big := (v_row ->> v_key)::numeric;
        if v_big < 0 or v_big > 2000000 or (v_row ->> v_key)::numeric <> v_big then
          raise exception '% must be a whole number from 0 to 2000000', v_key using errcode = '22023';
        end if;
      end if;
    end loop;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    insert into public.usage_day as u (user_id, day, kind, detail, count, model_calls, input_tokens, cached_tokens, output_tokens, cost_cents, failures)
    values (v_uid, v_day, v_row ->> 'kind', coalesce(v_row ->> 'detail', ''),
            coalesce((v_row ->> 'count')::int, 0), coalesce((v_row ->> 'model_calls')::int, 0),
            coalesce((v_row ->> 'input_tokens')::bigint, 0), coalesce((v_row ->> 'cached_tokens')::bigint, 0),
            coalesce((v_row ->> 'output_tokens')::bigint, 0), coalesce((v_row ->> 'cost_cents')::numeric, 0),
            coalesce((v_row ->> 'failures')::int, 0))
    on conflict (user_id, day, kind, detail) do update set
      count = u.count + excluded.count,
      model_calls = u.model_calls + excluded.model_calls,
      input_tokens = u.input_tokens + excluded.input_tokens,
      cached_tokens = u.cached_tokens + excluded.cached_tokens,
      output_tokens = u.output_tokens + excluded.output_tokens,
      cost_cents = u.cost_cents + excluded.cost_cents,
      failures = u.failures + excluded.failures,
      updated_at = now();
  end loop;
  -- Active today, with Free or Pro as it is now.
  insert into public.user_day (user_id, day, plan)
  select v_uid, v_day, coalesce(u.plan, 'free') from public.app_user u where u.id = v_uid
  on conflict (user_id, day) do nothing;
end;
$$;

-- =========================================================
-- Reading: admins only (Q8: the owner's account, app_user.is_admin)
-- =========================================================

-- For the admin page's first screen: never an error, just yes or no.
create function am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_admin from public.app_user u where u.id = auth.uid()), false);
$$;

-- The headline tiles: users, active users, this month's cost, and the months already in ai_usage (Q7).
create function admin_usage_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := public.usage_today();
  v_month date := date_trunc('month', public.usage_today())::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'today', v_today,
    'users', (select count(*) from public.app_user),
    'pro_users', (select count(*) from public.app_user where plan = 'pro'),
    'active_today', (select count(distinct user_id) from public.user_day where day = v_today),
    'active_7', (select count(distinct user_id) from public.user_day where day > v_today - 7),
    'active_30', (select count(distinct user_id) from public.user_day where day > v_today - 30),
    'month', v_month,
    'month_cost_cents', (select round(coalesce(sum(cost_cents), 0), 4) from public.usage_day where day >= v_month),
    'month_days_so_far', (v_today - v_month + 1),
    'month_days', extract(day from (v_month + interval '1 month - 1 day'))::int,
    'ai_months', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'cost_cents', round(m.cost, 4), 'requests', m.requests) order by m.month)
      from (select month, sum(cost_cents) cost, sum(requests) requests from public.ai_usage group by month) m), '[]'::jsonb),
    'tracking_since', (select min(day) from public.usage_day));
end;
$$;

-- Daily totals by kind and detail between two days (at most 400 days), with active users per day.
create function admin_usage_daily(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'from and to: at most 400 days apart' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'kind', d.kind, 'detail', d.detail, 'count', d.count, 'model_calls', d.model_calls,
               'input_tokens', d.input_tokens, 'cached_tokens', d.cached_tokens, 'output_tokens', d.output_tokens,
               'cost_cents', round(d.cost_cents, 4), 'failures', d.failures, 'users', d.users)
             order by d.day, d.kind, d.detail)
      from (select day, kind, detail, sum(count) count, sum(model_calls) model_calls, sum(input_tokens) input_tokens,
                   sum(cached_tokens) cached_tokens, sum(output_tokens) output_tokens, sum(cost_cents) cost_cents,
                   sum(failures) failures, count(distinct user_id) users
            from public.usage_day where day between p_from and p_to group by day, kind, detail) d), '[]'::jsonb),
    'active', coalesce((
      select jsonb_agg(jsonb_build_object('day', a.day, 'users', a.users, 'pro', a.pro) order by a.day)
      from (select day, count(*) users, count(*) filter (where plan = 'pro') pro
            from public.user_day where day between p_from and p_to group by day) a), '[]'::jsonb));
end;
$$;

-- Per user for one month (its first day): user ids and counts only, never an email (Q2).
create function admin_usage_users(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := date_trunc('month', coalesce(p_month, public.usage_today()))::date;
  v_to date := (date_trunc('month', coalesce(p_month, public.usage_today())) + interval '1 month - 1 day')::date;
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', u.id,
             'short_id', left(u.id::text, 8),
             'plan', u.plan,
             'joined', u.created_at::date,
             'active_days', (select count(*) from public.user_day d where d.user_id = u.id and d.day between v_from and v_to),
             'cost_cents', (select round(coalesce(sum(x.cost_cents), 0), 4) from public.usage_day x where x.user_id = u.id and x.day between v_from and v_to),
             'kinds', coalesce((
               select jsonb_object_agg(k.kind, jsonb_build_object('count', k.count, 'model_calls', k.model_calls,
                        'cost_cents', round(k.cost_cents, 4), 'failures', k.failures))
               from (select kind, sum(count) count, sum(model_calls) model_calls, sum(cost_cents) cost_cents, sum(failures) failures
                     from public.usage_day x where x.user_id = u.id and x.day between v_from and v_to group by kind) k), '{}'::jsonb),
             'snapshot', (select jsonb_build_object('notes', s.notes, 'memories', s.memories, 'storage_bytes', s.storage_bytes)
                          from public.usage_snapshot s where s.user_id = u.id and s.month = v_from))
           order by u.created_at)
    from public.app_user u), '[]'::jsonb);
end;
$$;

-- One user's email, on tap (Q2).
create function admin_user_email(p_user_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (select u.email from public.app_user u where u.id = p_user_id);
end;
$$;

-- When the admin page opens: this month's snapshot for every account that has none yet (Q4), and
-- rows older than 13 months deleted (Q3). Returns what it did.
create function admin_usage_maintenance() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', public.usage_today())::date;
  v_cut date := (date_trunc('month', public.usage_today()) - interval '13 months')::date;
  v_snap int;
  v_gone int := 0;
  v_n int;
begin
  perform public.require_admin();
  insert into public.usage_snapshot (user_id, month, notes, memories, storage_bytes)
  select u.id, v_month,
         (select count(*) from public.item i join public.space s on s.id = i.space_id
           where s.owner_user_id = u.id and i.deleted_at is null and coalesce(s.built_in, '') <> 'memories'),
         (select count(*) from public.item i join public.space s on s.id = i.space_id
           where s.owner_user_id = u.id and i.deleted_at is null and s.built_in = 'memories'),
         (select coalesce(sum(a.size_bytes), 0) from public.attachment a join public.item i on i.id = a.item_id
            join public.space s on s.id = i.space_id where s.owner_user_id = u.id)
  from public.app_user u
  on conflict (user_id, month) do nothing;
  get diagnostics v_snap = row_count;
  delete from public.usage_day where day < v_cut;
  get diagnostics v_n = row_count; v_gone := v_gone + v_n;
  delete from public.user_day where day < v_cut;
  get diagnostics v_n = row_count; v_gone := v_gone + v_n;
  delete from public.usage_snapshot where month < v_cut;
  get diagnostics v_n = row_count; v_gone := v_gone + v_n;
  return jsonb_build_object('snapshots_taken', v_snap, 'rows_deleted', v_gone, 'kept_from', v_cut);
end;
$$;

revoke execute on function usage_today(), record_usage(jsonb), am_i_admin(), admin_usage_overview(),
  admin_usage_daily(date, date), admin_usage_users(date), admin_user_email(uuid), admin_usage_maintenance()
  from public, anon;
grant execute on function usage_today(), record_usage(jsonb), am_i_admin(), admin_usage_overview(),
  admin_usage_daily(date, date), admin_usage_users(date), admin_user_email(uuid), admin_usage_maintenance()
  to authenticated;
