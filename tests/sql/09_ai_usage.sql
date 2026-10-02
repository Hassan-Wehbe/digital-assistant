-- Test: AI allowance and admin limits (migration ai_usage; CLAUDE.md rule 5, design.md D22).
-- Every write attempt names the test user's own row (also keeps SQL tools from asking to
-- confirm a table-wide change). Everything checked runs as a signed-in test user; only making A the admin and adding an old
-- month's row are done directly, as the test's superuser.

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', u), true);
$$;

-- An old month for B, which must not count this month.
insert into ai_usage (user_id, month, cost_cents, requests)
values ('00000000-0000-4000-a000-00000000000b', (ai_month() - interval '1 month')::date, 99, 50);

-- ---------- a person's own allowance ----------
select pg_temp.as_user('b');
set local role authenticated;
select pg_temp.check('a new person starts at the default $1, nothing used',
  (select a ->> 'limit_cents' = '100.00' and (a ->> 'used_cents')::numeric = 0 and (a ->> 'requests')::int = 0
   from my_ai_allowance() a));
select record_ai_usage(0.03);
select record_ai_usage(0.05);
select pg_temp.check('each request adds its cost and counts once',
  (select (a ->> 'used_cents')::numeric = 0.08 and (a ->> 'requests')::int = 2 from my_ai_allowance() a));
select pg_temp.check('last month does not count this month',
  (select (a ->> 'used_cents')::numeric < 1 from my_ai_allowance() a));
select pg_temp.check('a person sees their own months', (select count(*) = 2 from ai_usage));

do $$
begin
  perform record_ai_usage(-5);
  perform pg_temp.check('a negative amount is refused (usage only ever goes up)', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a negative amount is refused (usage only ever goes up)', sqlstate = '22023', sqlerrm);
end $$;
do $$
begin
  perform record_ai_usage(500);
  perform pg_temp.check('an oversized amount is refused', false, 'call succeeded');
exception when others then
  perform pg_temp.check('an oversized amount is refused', sqlstate = '22023', sqlerrm);
end $$;
do $$
begin
  perform record_ai_usage(null);
  perform pg_temp.check('a missing amount is refused', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a missing amount is refused', sqlstate = '22023', sqlerrm);
end $$;
do $$
begin
  update ai_usage set cost_cents = 0 where user_id = '00000000-0000-4000-a000-00000000000b';
  perform pg_temp.check('nobody lowers their usage directly', false, 'update succeeded');
exception when others then
  perform pg_temp.check('nobody lowers their usage directly', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  delete from ai_usage where user_id = '00000000-0000-4000-a000-00000000000b';
  perform pg_temp.check('nobody deletes their usage directly', false, 'delete succeeded');
exception when others then
  perform pg_temp.check('nobody deletes their usage directly', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  insert into ai_usage (user_id, month) values ('00000000-0000-4000-a000-00000000000b', '2000-01-01');
  perform pg_temp.check('nobody writes usage rows directly', false, 'insert succeeded');
exception when others then
  perform pg_temp.check('nobody writes usage rows directly', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  update app_user set is_admin = true where id = '00000000-0000-4000-a000-00000000000b';
  perform pg_temp.check('a person cannot make themselves admin', false, 'update succeeded');
exception when others then
  perform pg_temp.check('a person cannot make themselves admin', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  update app_user set ai_monthly_limit_cents = 100000 where id = '00000000-0000-4000-a000-00000000000b';
  perform pg_temp.check('a person cannot raise their own limit', false, 'update succeeded');
exception when others then
  perform pg_temp.check('a person cannot raise their own limit', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  perform * from ai_settings;
  perform pg_temp.check('the settings row is not readable directly', false, 'select succeeded');
exception when others then
  perform pg_temp.check('the settings row is not readable directly', sqlstate = '42501', sqlerrm);
end $$;
select pg_temp.check('a person reads their own limit and admin flag',
  (select count(*) = 1 and bool_and(ai_monthly_limit_cents is null and not is_admin) from app_user));

-- ---------- a non-admin is refused by every admin function ----------
do $$
begin
  perform admin_ai_overview();
  perform pg_temp.check('a non-admin cannot see the overview', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a non-admin cannot see the overview', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  perform admin_set_ai_limit('00000000-0000-4000-a000-00000000000b', 100000);
  perform pg_temp.check('a non-admin cannot set a personal limit', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a non-admin cannot set a personal limit', sqlstate = '42501', sqlerrm);
end $$;
do $$
begin
  perform admin_set_default_limit(100000);
  perform pg_temp.check('a non-admin cannot set the default limit', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a non-admin cannot set the default limit', sqlstate = '42501', sqlerrm);
end $$;

-- ---------- A cannot see B's usage ----------
select pg_temp.as_user('a');
select pg_temp.check('another person''s usage is invisible', (select count(*) = 0 from ai_usage));
select pg_temp.check('another person''s spending does not count against me',
  (select (a ->> 'used_cents')::numeric = 0 from my_ai_allowance() a));

-- ---------- the admin ----------
reset role;
update app_user set is_admin = true where id = '00000000-0000-4000-a000-00000000000a';
set local role authenticated;
create temp table _o as select admin_ai_overview() as o;
create temp view _b as
  select p from _o, jsonb_array_elements(o -> 'people') p
  where p ->> 'user_id' = '00000000-0000-4000-a000-00000000000b';
select pg_temp.check('the overview shows each person''s usage this month and limit',
  (select (p ->> 'used_cents')::numeric = 0.08 and (p ->> 'requests')::int = 2
          and p ->> 'limit_cents' = '100.00' and p -> 'personal_limit_cents' = 'null'::jsonb from _b));
select pg_temp.check('the overview holds numbers and email only',
  (select bool_and(k in ('user_id', 'email', 'used_cents', 'requests', 'personal_limit_cents', 'limit_cents'))
   from _o, jsonb_array_elements(o -> 'people') p, jsonb_object_keys(p) k));
select pg_temp.check('the admin still sees only their own usage rows', (select count(*) = 0 from ai_usage));

select admin_set_ai_limit('00000000-0000-4000-a000-00000000000b', 500);
select admin_set_default_limit(200);
select pg_temp.as_user('b');
select pg_temp.check('a personal limit overrides the default',
  (select a ->> 'limit_cents' = '500.00' from my_ai_allowance() a));
select pg_temp.as_user('a');
select admin_set_ai_limit('00000000-0000-4000-a000-00000000000b', null);
select pg_temp.as_user('b');
select pg_temp.check('clearing it goes back to the (changed) default',
  (select a ->> 'limit_cents' = '200.00' from my_ai_allowance() a));
select pg_temp.as_user('a');
do $$
begin
  perform admin_set_default_limit(-1);
  perform pg_temp.check('a negative limit is refused', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a negative limit is refused', sqlstate = '22023', sqlerrm);
end $$;
select admin_set_default_limit(0);
select pg_temp.as_user('b');
select pg_temp.check('a zero limit reads as fully used',
  (select (a ->> 'used_fraction')::numeric = 1 from my_ai_allowance() a));

-- ---------- signed out ----------
reset role;
set local role anon;
do $$
begin
  perform record_ai_usage(0.01);
  perform pg_temp.check('signed out: no usage can be recorded', false, 'call succeeded');
exception when others then
  perform pg_temp.check('signed out: no usage can be recorded', sqlstate = '42501', sqlerrm);
end $$;
reset role;
