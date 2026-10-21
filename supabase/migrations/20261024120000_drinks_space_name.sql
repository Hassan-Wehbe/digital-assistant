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
