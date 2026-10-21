begin;
-- Ages, step 2 (docs/age-plan.md, D44; Q8): the built-in drinks space is called Mocktails under 21
-- (or until the age is given) and Cocktails from 21. The same space and notes; only its name
-- changes, by Wilma (users still cannot rename a built-in space).
--
--   * _sync_drinks_space(user): sets the name from app_user.alcohol_from (is_21's rule). When the
--     user already has another top-level space with that name, it is left as it is (no clash, no
--     error).
--   * sync_drinks_space(): the caller's own, for the MCP server's list_spaces (the app lists spaces
--     on every open, so a 21st birthday shows by itself; no scheduled job is needed).
--   * _ensure_built_in_spaces (sign-up) and set_birth_month() now end with it; every existing
--     account is set now (not asked yet: Mocktails, Q6).
--   * space_built_in_guard lets only these functions (running as the table owner) switch the drinks
--     space between Cocktails and Mocktails; every other rename of a built-in space is still refused.
--
-- The other drinks rules (suggestions, saving, the chat) are in the edge functions. Nothing new is
-- granted to anon; the helper is callable by no one.

-- The built-in space guard (from 20261012120000_memory_builtin_spaces.sql), with one exception: the
-- drinks space may switch between Cocktails and Mocktails when Wilma's own functions do it (they run
-- as the table owner; a signed-in user, anon or the service role still cannot rename it).
create or replace function space_built_in_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_what text;
begin
  if tg_op = 'INSERT' then
    -- Only migrations and sign-up (as the table owner) make built-in spaces.
    if new.built_in is not null and current_user in ('anon', 'authenticated', 'service_role') then
      raise exception 'Only Wilma makes built-in spaces.' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.built_in is not null
       and exists (select 1 from public.app_user u where u.id = old.owner_user_id) then
      raise exception '"%" is a built-in space, so it can''t be deleted.', old.name using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.built_in is distinct from old.built_in and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'Only Wilma marks built-in spaces.' using errcode = '42501';
  end if;
  if old.built_in is not null then
    v_what := case
      when new.name is distinct from old.name
           and not (old.built_in = 'cocktails' and new.name in ('Cocktails', 'Mocktails')
                    and current_user not in ('anon', 'authenticated', 'service_role')) then 'renamed'
      when new.parent_id is distinct from old.parent_id then 'moved'
      when new.is_restricted is distinct from old.is_restricted then 'restricted'
      when new.owner_user_id is distinct from old.owner_user_id then 'given away'
    end;
    if v_what is not null then
      raise exception '"%" is a built-in space, so it can''t be %.', old.name, v_what using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function space_built_in_guard() from public, anon, authenticated;

-- The name the caller's drinks space should have, set by Wilma. Runs as its owner.
create function _sync_drinks_space(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_space public.space;
begin
  select case when u.alcohol_from <= current_date then 'Cocktails' else 'Mocktails' end into v_name
  from public.app_user u where u.id = p_user;
  if v_name is null then return null; end if;
  select * into v_space from public.space where owner_user_id = p_user and built_in = 'cocktails';
  if v_space.id is null or v_space.name = v_name then return v_space.name; end if;
  if exists (
    select 1 from public.space s
    where s.owner_user_id = p_user and s.id <> v_space.id
      and s.parent_id is not distinct from v_space.parent_id and lower(s.name) = lower(v_name)
  ) then
    return v_space.name;
  end if;
  update public.space set name = v_name where id = v_space.id;
  return v_name;
end;
$$;

create function sync_drinks_space() returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  return public._sync_drinks_space(auth.uid());
end;
$$;

-- As 20261021120000_recipes_builtin_spaces.sql, then the drinks space's name.
create or replace function _ensure_built_in_spaces(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_name text;
  v_desc text;
  v_id uuid;
begin
  foreach v_kind in array array['tasks', 'memories', 'recipes', 'cocktails'] loop
    if exists (select 1 from public.space where owner_user_id = p_user and built_in = v_kind) then
      continue;
    end if;
    v_name := case v_kind
      when 'tasks' then 'Tasks' when 'memories' then 'Memories'
      when 'recipes' then 'Recipes' else 'Cocktails' end;
    v_desc := case v_kind
      when 'tasks' then 'Things to do, with due dates'
      when 'memories' then 'What Wilma remembered about you'
      when 'recipes' then 'Meals to cook: full recipes or links'
      else 'Drinks to make: full recipes or links' end;
    -- The user's own top-level space of that name (oldest first), when it is not restricted.
    v_id := null;
    select id into v_id from public.space
    where owner_user_id = p_user and parent_id is null and lower(name) = lower(v_name) and not is_restricted
    order by created_at, id
    limit 1;
    if v_id is not null then
      update public.space set built_in = v_kind where id = v_id;
    elsif not exists (
      select 1 from public.space
      where owner_user_id = p_user and parent_id is null and lower(name) = lower(v_name)
    ) then
      insert into public.space (owner_user_id, parent_id, name, description, is_restricted, built_in)
      values (p_user, null, v_name, v_desc, false, v_kind)
      on conflict do nothing;
    end if;
    -- Otherwise only a restricted space of that name exists: left alone, nothing made beside it.
  end loop;
  -- Mocktails under 21 (or until the age is given), Cocktails from 21 (D44).
  perform public._sync_drinks_space(p_user);
end;
$$;

-- As 20261023120000_age_check.sql, then the drinks space's name.
create or replace function set_birth_month(p_month int, p_year int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_from date;
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  select u.alcohol_from into v_from from public.app_user u where u.id = v_uid for update;
  if not found then raise exception 'no such person' using errcode = 'P0002'; end if;
  if v_from is not null then
    raise exception 'Your age is already set. If it is wrong, contact us.' using errcode = 'P0001';
  end if;
  if p_month is null or p_year is null or not public._birth_ok(p_month, p_year, current_date) then
    raise exception 'Please enter a real month and year of birth.' using errcode = '22023';
  end if;
  update public.app_user set alcohol_from = public._alcohol_from(p_month, p_year, current_date) where id = v_uid;
  perform public._sync_drinks_space(v_uid);
  return public.my_age_status();
end;
$$;

revoke execute on function _sync_drinks_space(uuid), _ensure_built_in_spaces(uuid) from public, anon, authenticated;
revoke execute on function sync_drinks_space() from public, anon;
grant execute on function sync_drinks_space() to authenticated;
revoke execute on function set_birth_month(int, int) from public, anon;
grant execute on function set_birth_month(int, int) to authenticated;

-- Every account now (not asked yet: Mocktails).
select _sync_drinks_space(u.id) from app_user u;
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
-- Test: the built-in drinks space's name (20261024120000_drinks_space_name.sql, docs/age-plan.md step
-- 2, Q8). Mocktails until the age is given and under 21, Cocktails from 21; set at sign-up, when the
-- age is given and by sync_drinks_space() (the app lists spaces on every open); the same space and
-- notes; another space of that name is never clashed with; users still cannot rename it; only the
-- caller's own; anon gets nothing.

create function pg_temp.drinks(p_user uuid) returns text language sql as $$
  select name from space where owner_user_id = p_user and built_in = 'cocktails';
$$;
create temp table _code (code text);
insert into _code values (create_invite_code('test: drinks', 10, 14, 'free'));
create function pg_temp.born(p_years int) returns jsonb language sql as $$
  select jsonb_build_object('invite_code', (select code from _code), 'terms_version', (select terms_version from signup_setting),
           'birth_month', extract(month from d)::int, 'birth_year', extract(year from d)::int)
  from (select (date_trunc('month', current_date) - make_interval(years => p_years))::date d) x;
$$;

-- The test users were made before the migration runs in a dry run, and after it here: set them as
-- an existing account would be after the migration.
select _ensure_built_in_spaces(u.id) from app_user u where u.id in ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000b');
select pg_temp.check('not asked yet: the drinks space is Mocktails',
  pg_temp.drinks('00000000-0000-4000-a000-00000000000a') = 'Mocktails', pg_temp.drinks('00000000-0000-4000-a000-00000000000a'));

-- ---------- Sign-ups ----------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('00000000-0000-4000-a000-0000000000e1', 'test-drinks-30@example.invalid', 'authenticated', 'authenticated', pg_temp.born(30)),
  ('00000000-0000-4000-a000-0000000000e2', 'test-drinks-19@example.invalid', 'authenticated', 'authenticated', pg_temp.born(19));
select pg_temp.check('a sign-up at 30: Cocktails', pg_temp.drinks('00000000-0000-4000-a000-0000000000e1') = 'Cocktails');
select pg_temp.check('a sign-up at 19: Mocktails', pg_temp.drinks('00000000-0000-4000-a000-0000000000e2') = 'Mocktails');

-- ---------- A gives an age of 35: Cocktails, the same space ----------
insert into item (space_id, title, item_type, metadata)
select id, 'Virgin cucumber cooler', 'cocktail', '{"strength":"none"}'::jsonb
from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'cocktails';
create temp table _before as select id from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'cocktails';
grant select on _before to authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select set_birth_month(5, extract(year from current_date)::int - 35);
select pg_temp.check('giving an age of 21 or over: Cocktails, the same space with its notes',
  (select name = 'Cocktails' and id = (select id from _before) from space where built_in = 'cocktails')
  and exists (select 1 from item i join space s on s.id = i.space_id where s.built_in = 'cocktails' and i.title = 'Virgin cucumber cooler'));
select pg_temp.check('sync_drinks_space() keeps it Cocktails', sync_drinks_space() = 'Cocktails');
do $$
begin
  update space set name = 'Drinks' where built_in = 'cocktails';
  perform pg_temp.check('users still cannot rename it', false, 'renamed');
exception when others then
  perform pg_temp.check('users still cannot rename it', sqlerrm like '%built-in space%', sqlerrm);
end $$;
reset role;

-- ---------- B: 19, with their own top-level "Mocktails" space already ----------
insert into space (owner_user_id, parent_id, name) values ('00000000-0000-4000-a000-00000000000b', null, 'mocktails');
reset role;
update app_user set alcohol_from = '-infinity' where id = '00000000-0000-4000-a000-00000000000b';
select _sync_drinks_space('00000000-0000-4000-a000-00000000000b');
update app_user set alcohol_from = (date_trunc('month', current_date) + interval '2 years 1 month')::date
where id = '00000000-0000-4000-a000-00000000000b';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('under 21 with a space already called Mocktails: left as Cocktails, no error',
  sync_drinks_space() = 'Cocktails');
select pg_temp.check('B sees and changes only their own',
  (select count(*) = 1 from space where built_in = 'cocktails'));
do $$
begin
  perform _sync_drinks_space('00000000-0000-4000-a000-00000000000a');
  perform pg_temp.check('users cannot set another account''s space', false, 'allowed');
exception when insufficient_privilege then
  perform pg_temp.check('users cannot set another account''s space', true, sqlerrm);
end $$;
reset role;

-- ---------- Turning 21: the next listing shows Cocktails ----------
update space set name = 'Old mocktails' where owner_user_id = '00000000-0000-4000-a000-00000000000b' and built_in is null and name = 'mocktails';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('under 21 and no clash: Mocktails', sync_drinks_space() = 'Mocktails');
reset role;
update app_user set alcohol_from = current_date where id = '00000000-0000-4000-a000-00000000000b';
set local role authenticated;
select pg_temp.check('the month they turn 21 (alcohol_from reached): Cocktails on the next listing', sync_drinks_space() = 'Cocktails');
reset role;

-- ---------- anon ----------
set local role anon;
do $$
declare
  t text;
begin
  foreach t in array array['select sync_drinks_space()', 'select _sync_drinks_space(''00000000-0000-4000-a000-00000000000a'')']
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
