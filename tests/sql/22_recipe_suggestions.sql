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
