-- Test: invite-only sign-up (20261011120000_invite_signup.sql). Codes are stored hashed; the
-- Before User Created hook refuses a sign-up without a code, with a wrong, expired or used-up
-- code, or without 18+ and the current terms; a valid code (any case, with or without dashes)
-- passes. The sign-up trigger counts one use, starts the account on the code's plan, records the
-- terms, drops the code from the account's metadata and refuses a code's use past its limit.
-- Open mode lets a sign-up through without a code. Users cannot read the tables or make codes;
-- anon can ask only signup_mode().

create function pg_temp.hook(p_meta jsonb) returns text language sql as $$
  select coalesce(hook_before_user_created(jsonb_build_object('metadata', '{}'::jsonb,
           'user', jsonb_build_object('email', 'x@example.invalid', 'user_metadata', p_meta))) -> 'error' ->> 'message', 'ok');
$$;
create function pg_temp.meta(p_code text) returns jsonb language sql as $$
  select jsonb_build_object('invite_code', p_code, 'age_confirmed', true,
           'terms_version', (select terms_version from signup_setting));
$$;

create temp table _codes (name text primary key, code text);
insert into _codes values
  ('one',     create_invite_code('test: one use', 1, 14, 'free')),
  ('pro',     create_invite_code('test: pro tester', 2, 14, 'pro')),
  ('expired', create_invite_code('test: expired', 1, 1, 'free'));
update invite_code set expires_at = now() - interval '1 minute' where note = 'test: expired';

select pg_temp.check('a code reads WILMA-XXXX-XXXX',
  (select bool_and(code ~ '^WILMA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$') from _codes), (select string_agg(code, ' ') from _codes));
select pg_temp.check('only the hash is stored',
  (select count(*) = 3 from invite_code i join _codes c on i.code_hash = invite_code_hash(c.code))
  and not exists (select 1 from invite_code i, _codes c where i::text like '%' || c.code || '%'));

select pg_temp.check('hook: no code is refused',
  pg_temp.hook(pg_temp.meta(null)) = 'An invite code is needed to create an account.', pg_temp.hook(pg_temp.meta(null)));
select pg_temp.check('hook: a wrong code is refused',
  pg_temp.hook(pg_temp.meta('WILMA-AAAA-AAAA')) like 'This invite code is not valid%');
select pg_temp.check('hook: an expired code is refused',
  pg_temp.hook(pg_temp.meta((select code from _codes where name = 'expired'))) like 'This invite code has expired%');
select pg_temp.check('hook: 18+ and terms are required',
  pg_temp.hook(pg_temp.meta((select code from _codes where name = 'one')) - 'age_confirmed') like 'Please confirm you are 18%'
  and pg_temp.hook(pg_temp.meta((select code from _codes where name = 'one')) || '{"terms_version":"old"}') like 'Please confirm you are 18%'
  and pg_temp.hook(pg_temp.meta((select code from _codes where name = 'one')) || '{"age_confirmed":"yes"}') like 'Please confirm you are 18%');
select pg_temp.check('hook: a valid code passes, in any case and without dashes',
  pg_temp.hook(pg_temp.meta((select code from _codes where name = 'one'))) = 'ok'
  and pg_temp.hook(pg_temp.meta((select lower(replace(code, '-', ' ')) from _codes where name = 'one'))) = 'ok');

-- A sign-up with the Pro tester code.
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-a000-0000000000c1', 'test-invite-1@example.invalid', 'authenticated', 'authenticated',
   pg_temp.meta((select code from _codes where name = 'pro')) || '{"full_name":"Tess"}');
select pg_temp.check('the account starts on the code''s plan, with the terms recorded',
  (select plan = 'pro' and age_confirmed and terms_version = (select terms_version from signup_setting)
          and terms_accepted_at is not null and display_name = 'Tess'
   from app_user where id = '00000000-0000-4000-a000-0000000000c1'));
select pg_temp.check('one use is counted and recorded',
  (select uses = 1 from invite_code where note = 'test: pro tester')
  and exists (select 1 from invite_use u join invite_code i on i.id = u.invite_code_id
              where i.note = 'test: pro tester' and u.user_id = '00000000-0000-4000-a000-0000000000c1'));
select pg_temp.check('the code is not kept with the account',
  (select not (raw_user_meta_data ? 'invite_code') and raw_user_meta_data ->> 'full_name' = 'Tess'
   from auth.users where id = '00000000-0000-4000-a000-0000000000c1'));
select pg_temp.check('the new account still gets its Tasks space',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-0000000000c1' and name = 'Tasks'));

-- A one-use code, used once; a second sign-up with it is refused by the trigger too (two at once).
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-a000-0000000000c2', 'test-invite-2@example.invalid', 'authenticated', 'authenticated',
   pg_temp.meta((select code from _codes where name = 'one')));
select pg_temp.check('a normal code starts the account on free',
  (select plan = 'free' from app_user where id = '00000000-0000-4000-a000-0000000000c2'));
select pg_temp.check('hook: a used-up code is refused',
  pg_temp.hook(pg_temp.meta((select code from _codes where name = 'one'))) like 'This invite code has been used up%');
do $$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data) values
    ('00000000-0000-4000-a000-0000000000c3', 'test-invite-3@example.invalid', 'authenticated', 'authenticated',
     pg_temp.meta((select code from _codes where name = 'one')));
  perform pg_temp.check('the trigger refuses a code past its limit', false, 'account made');
exception when invalid_parameter_value then
  perform pg_temp.check('the trigger refuses a code past its limit', sqlerrm like 'This invite code has been used up%', sqlerrm);
end $$;
select pg_temp.check('the refused sign-up left nothing behind',
  not exists (select 1 from app_user where id = '00000000-0000-4000-a000-0000000000c3')
  and (select uses = 1 from invite_code where note = 'test: one use'));

select pg_temp.check('an account made without a code (the dashboard, these tests) is still made',
  (select plan = 'free' and not age_confirmed and terms_version is null
   from app_user where id = '00000000-0000-4000-a000-00000000000a'));

update signup_setting set signup_mode = 'open';
select pg_temp.check('open mode: no code needed, terms still are',
  pg_temp.hook(pg_temp.meta(null)) = 'ok' and pg_temp.hook('{}'::jsonb) like 'Please confirm you are 18%');
select pg_temp.check('open mode: a wrong code is still refused',
  pg_temp.hook(pg_temp.meta('WILMA-AAAA-AAAA')) like 'This invite code is not valid%');
update signup_setting set signup_mode = 'invite';

-- What a signed-in person can do.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('a person reads their own plan and terms',
  (select plan = 'pro' and age_confirmed from app_user));
do $$
declare
  t text;
begin
  foreach t in array array['select count(*) from invite_code', 'select count(*) from invite_use',
                           'select count(*) from signup_setting', 'select create_invite_code(''x'')',
                           'select hook_before_user_created(''{}'')', 'update app_user set plan = ''pro''',
                           'update app_user set terms_version = ''x''']
  loop
    begin
      execute t;
      perform pg_temp.check('authenticated is refused: ' || t, false, 'allowed');
    exception when insufficient_privilege then
      perform pg_temp.check('authenticated is refused: ' || t, true, sqlerrm);
    end;
  end loop;
end $$;
select pg_temp.check('a signed-in person can ask the sign-up mode', signup_mode() = 'invite');
reset role;

set local role anon;
select pg_temp.check('anon can ask the sign-up mode', signup_mode() = 'invite');
do $$
declare
  t text;
begin
  foreach t in array array['select count(*) from invite_code', 'select count(*) from signup_setting',
                           'select create_invite_code(''x'')', 'select hook_before_user_created(''{}'')',
                           'select invite_code_hash(''x'')']
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
