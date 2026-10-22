begin;
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
-- Test: usage tracking (20261026120000_usage_tracking.sql, docs/usage-tracking-plan.md step 1,
-- D34). record_usage() adds only to the caller's own rows for the UTC day, all or nothing, with every
-- field checked (a known kind, a short name as detail, never text; counts, tokens and cost capped);
-- a user reads only their own rows and writes none directly; the admin functions answer only admins
-- (figures and user ids, an email only one at a time); maintenance takes the month's snapshot and
-- deletes rows older than 13 months; rows go with the account; anon gets nothing.

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.refused(text) to authenticated, anon;

-- ---------- A records ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select record_usage('[{"kind":"chat","detail":"gpt-6-luna","count":1,"model_calls":2,"input_tokens":1500,"cached_tokens":1000,"output_tokens":120,"cost_cents":0.21},
                      {"kind":"message","count":1},{"kind":"mapbox","count":3,"failures":1}]'::jsonb);
select record_usage('[{"kind":"chat","detail":"gpt-6-luna","count":1,"model_calls":1,"input_tokens":500,"output_tokens":40,"cost_cents":0.05}]'::jsonb);
select pg_temp.check('adds to the day''s row: two chats, three model calls, 0.26 cents',
  (select count = 2 and model_calls = 3 and input_tokens = 2000 and cached_tokens = 1000 and output_tokens = 160 and cost_cents = 0.26
   from usage_day where kind = 'chat' and detail = 'gpt-6-luna' and day = usage_today()));
select pg_temp.check('the UTC day', (select bool_and(day = (now() at time zone 'utc')::date) from usage_day));
select pg_temp.check('active today, as Free', (select plan = 'free' from user_day where day = usage_today()));
select pg_temp.check('Mapbox counts and failures', (select count = 3 and failures = 1 from usage_day where kind = 'mapbox'));

-- ---------- Every field checked; nothing written when any row is wrong ----------
select pg_temp.check('an unknown kind is refused', pg_temp.refused($q$select record_usage('[{"kind":"lunch"}]')$q$) is not null);
select pg_temp.check('an unknown field is refused (no text can ride along)',
  pg_temp.refused($q$select record_usage('[{"kind":"chat","note":"my wifi password is hunter2"}]')$q$) like 'unknown field%');
select pg_temp.check('detail must be a short name, never a sentence',
  pg_temp.refused($q$select record_usage('[{"kind":"error","detail":"Call Mom about the bank"}]')$q$) = 'detail must be a short name');
select pg_temp.check('detail longer than 60 is refused',
  pg_temp.refused(format($q$select record_usage('[{"kind":"error","detail":"%s"}]')$q$, repeat('a', 61))) is not null);
select pg_temp.check('more than 5 cents in one row is refused',
  pg_temp.refused($q$select record_usage('[{"kind":"chat","cost_cents":6}]')$q$) like 'cost must be%');
select pg_temp.check('a count over 100 is refused', pg_temp.refused($q$select record_usage('[{"kind":"save","count":101}]')$q$) is not null);
select pg_temp.check('a fraction of a count is refused', pg_temp.refused($q$select record_usage('[{"kind":"save","count":1.5}]')$q$) is not null);
select pg_temp.check('a number sent as text is refused', pg_temp.refused($q$select record_usage('[{"kind":"save","count":"1"}]')$q$) is not null);
select pg_temp.check('negative tokens are refused', pg_temp.refused($q$select record_usage('[{"kind":"chat","input_tokens":-1}]')$q$) is not null);
select pg_temp.check('more than 20 rows are refused',
  pg_temp.refused(format('select record_usage(%L)', (select jsonb_agg('{"kind":"save","count":1}'::jsonb) from generate_series(1, 21))::text)) is not null);
select pg_temp.check('all or nothing: a good row before a bad one is not written',
  pg_temp.refused($q$select record_usage('[{"kind":"search","count":1},{"kind":"nope"}]')$q$) is not null
  and not exists (select 1 from usage_day where kind = 'search'));

-- ---------- Own rows only ----------
select pg_temp.check('nobody writes the table directly',
  pg_temp.refused($q$insert into usage_day (user_id, day, kind) values ('00000000-0000-4000-a000-00000000000a', current_date, 'save')$q$) like 'permission denied%');
select pg_temp.check('nobody changes a count directly', pg_temp.refused($q$update usage_day set count = 0$q$) like 'permission denied%');
reset role;
select pg_temp.as_user('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select record_usage('[{"kind":"recipe_suggest","detail":"gpt-6-luna","count":1,"model_calls":1,"cost_cents":0.04},{"kind":"fair_use_hit","detail":"day_plan","count":1}]'::jsonb);
select pg_temp.check('B sees only B''s rows', (select count(*) = 2 from usage_day) and (select count(*) = 1 from user_day));
select pg_temp.check('not an admin: am_i_admin() is false', not am_i_admin());
select pg_temp.check('not an admin: the overview is refused', pg_temp.refused('select admin_usage_overview()') = 'admin only');
select pg_temp.check('not an admin: per user is refused', pg_temp.refused('select admin_usage_users(null)') = 'admin only');
select pg_temp.check('not an admin: an email is refused',
  pg_temp.refused($q$select admin_user_email('00000000-0000-4000-a000-00000000000a')$q$) = 'admin only');
select pg_temp.check('not an admin: maintenance is refused', pg_temp.refused('select admin_usage_maintenance()') = 'admin only');
reset role;

-- ---------- A is an admin ----------
update app_user set is_admin = true where id = '00000000-0000-4000-a000-00000000000a';
-- An old row, 14 months ago, and something to snapshot.
insert into usage_day (user_id, day, kind, count) values ('00000000-0000-4000-a000-00000000000b', usage_today() - interval '14 months', 'save', 1);
insert into user_day (user_id, day, plan) values ('00000000-0000-4000-a000-00000000000b', usage_today() - interval '14 months', 'free');
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('admin: am_i_admin() is true', am_i_admin());
select pg_temp.check('admin: the overview counts users, active today and this month''s cost',
  (select (o ->> 'users')::int >= 2 and (o ->> 'active_today')::int >= 2 and (o ->> 'month_cost_cents')::numeric >= 0.30
   from (select admin_usage_overview() o) x), (select admin_usage_overview()::text));
select pg_temp.check('admin: daily totals by kind, with users per day',
  (select exists (select 1 from jsonb_array_elements(d -> 'rows') r where r ->> 'kind' = 'chat' and (r ->> 'count')::int = 2)
   from (select admin_usage_daily(usage_today() - 1, usage_today()) d) x));
select pg_temp.check('admin: a range over 400 days is refused',
  pg_temp.refused('select admin_usage_daily(current_date - 500, current_date)') is not null);
select pg_temp.check('admin: per user, ids and counts, never an email',
  (select jsonb_array_length(u) >= 2 and u::text not like '%@%'
     and exists (select 1 from jsonb_array_elements(u) e where e ->> 'short_id' = '00000000' and e -> 'kinds' ? 'chat')
   from (select admin_usage_users(null) u) x));
select pg_temp.check('admin: one email on tap', admin_user_email('00000000-0000-4000-a000-00000000000b') = 'test-user-b@example.invalid');
select pg_temp.check('admin: maintenance takes the month''s snapshot and deletes rows over 13 months old',
  (select (m ->> 'snapshots_taken')::int >= 2 and (m ->> 'rows_deleted')::int >= 2 from (select admin_usage_maintenance() m) x));
select pg_temp.check('admin: a second maintenance takes no second snapshot', (admin_usage_maintenance() ->> 'snapshots_taken')::int = 0);
reset role;
select pg_temp.check('the old rows are gone', not exists (select 1 from usage_day where day < usage_today() - interval '13 months')
  and not exists (select 1 from user_day where day < usage_today() - interval '13 months'));

-- ---------- Gone with the account ----------
delete from auth.users where id = '00000000-0000-4000-a000-00000000000b';
select pg_temp.check('rows go with the account',
  not exists (select 1 from usage_day where user_id = '00000000-0000-4000-a000-00000000000b')
  and not exists (select 1 from usage_snapshot where user_id = '00000000-0000-4000-a000-00000000000b'));

-- ---------- anon ----------
set local role anon;
do $$
declare
  t text;
begin
  foreach t in array array['select record_usage(''[]'')', 'select am_i_admin()', 'select admin_usage_overview()', 'select count(*) from usage_day']
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
