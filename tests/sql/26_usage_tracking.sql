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
