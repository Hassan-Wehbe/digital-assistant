-- Test: a classification's cost (migration ai_cost_only; one-box plan step 6, Q4). It adds to
-- the month's cost, never to the requests, only for the signed-in person, and only ever adds.
-- Needs migration ai_usage. Everything runs as a signed-in test user.

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', u), true);
$$;

select pg_temp.as_user('a');
set local role authenticated;
select record_ai_usage(0.02);
select record_ai_cost(0.005);
select record_ai_cost(0.005);
select pg_temp.check('a classification adds its cost but not a request',
  (select (a ->> 'used_cents')::numeric = 0.03 and (a ->> 'requests')::int = 1 from my_ai_allowance() a));
select pg_temp.check('it returns the allowance after the cost',
  (select (r ->> 'used_cents')::numeric = 0.03 from record_ai_cost(0) r));

do $$
begin
  perform record_ai_cost(-1);
  perform pg_temp.check('a negative amount is refused', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a negative amount is refused', sqlstate = '22023', sqlerrm);
end $$;
do $$
begin
  perform record_ai_cost(6);
  perform pg_temp.check('more than 5 cents is refused (a classification costs far less)', false, 'call succeeded');
exception when others then
  perform pg_temp.check('more than 5 cents is refused (a classification costs far less)', sqlstate = '22023', sqlerrm);
end $$;
do $$
begin
  perform record_ai_cost(null);
  perform pg_temp.check('a missing amount is refused', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a missing amount is refused', sqlstate = '22023', sqlerrm);
end $$;

-- B starts with nothing; A's cost is not B's.
select pg_temp.as_user('b');
select record_ai_cost(0.01);
select pg_temp.check('a cost lands on the caller only (B)',
  (select (a ->> 'used_cents')::numeric = 0.01 and (a ->> 'requests')::int = 0 from my_ai_allowance() a));
select pg_temp.check('B sees only their own usage row', (select count(*) = 1 from ai_usage));
select pg_temp.as_user('a');
select pg_temp.check('A is unchanged by B',
  (select (a ->> 'used_cents')::numeric = 0.03 from my_ai_allowance() a));

-- The limit applies to classifications too: a used-up month reads as used up.
reset role;
update app_user set ai_monthly_limit_cents = 0.03 where id = '00000000-0000-4000-a000-00000000000a';
set local role authenticated;
select pg_temp.check('classifications count against the limit',
  (select (a ->> 'used_fraction')::numeric = 1 from my_ai_allowance() a));

reset role;
select pg_temp.check('anon cannot call it',
  not has_function_privilege('anon', 'record_ai_cost(numeric)', 'execute'));
select pg_temp.check('a signed-in person can',
  has_function_privilege('authenticated', 'record_ai_cost(numeric)', 'execute'));
