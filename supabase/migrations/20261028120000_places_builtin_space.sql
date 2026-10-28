-- A Places space, step 1 (docs/places-space-plan.md, D45; owner's answers 2026-10-28: Q1 an existing
-- "Places" becomes the built-in one, Q2 every note marked as a place moves into Places, the rest as
-- recommended). After a tester could not pick the place she had saved in a space she named Places.
--
--   * space.built_in also allows 'places' (still at most one per account, space_built_in_once).
--     space_built_in_guard is unchanged: like Tasks, Memories, Recipes and Cocktails it cannot be
--     deleted, renamed, moved or restricted. Sub-spaces under it are allowed (Places/Kids).
--   * _ensure_built_in_spaces marks or makes all five, as before: the user's own oldest top-level,
--     not restricted space named "Places" (any case) is marked rather than duplicated; a restricted
--     one is left alone, and none is made beside it (rule 3). Sign-up already calls it.
--   * _move_places_into_places(user): every live place (item_type 'place') of the account moves into
--     Places, from any space that is not restricted and not under a restricted space; one already
--     in Places or a sub-space of it stays. A place in a restricted space stays there, so it never
--     becomes visible (rule 3). Old Home notes (kind "home", D36) are left alone. Moving changes no
--     text, so no revision is written (rule 7: nothing to keep); a place shared on its own (D32)
--     keeps its share.
--   * Every existing account gets the space and the move now. Safe to run twice.
--
-- From now on the server saves every place into Places (step 2); nothing here forces it.

alter table space drop constraint space_built_in_check;
alter table space add constraint space_built_in_check
  check (built_in in ('tasks', 'memories', 'recipes', 'cocktails', 'places'));

-- Marks or makes the account's built-in spaces. Runs as its owner (sign-up and migrations only).
create or replace function _ensure_built_in_spaces(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_name text;
  v_desc text;
  v_id uuid;
begin
  foreach v_kind in array array['tasks', 'memories', 'recipes', 'cocktails', 'places'] loop
    if exists (select 1 from public.space where owner_user_id = p_user and built_in = v_kind) then
      continue;
    end if;
    v_name := case v_kind
      when 'tasks' then 'Tasks' when 'memories' then 'Memories'
      when 'recipes' then 'Recipes' when 'places' then 'Places' else 'Cocktails' end;
    v_desc := case v_kind
      when 'tasks' then 'Things to do, with due dates'
      when 'memories' then 'What Wilma remembered about you'
      when 'recipes' then 'Meals to cook: full recipes or links'
      when 'places' then 'Spots you go to: restaurants, parks, the library, the pool'
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

-- Every live place of the account into Places (Q2), except from restricted spaces (rule 3). Returns
-- how many moved.
create function _move_places_into_places(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_places uuid;
  v_moved int;
begin
  select id into v_places from public.space where owner_user_id = p_user and built_in = 'places';
  if v_places is null then
    return 0;
  end if;
  with recursive
  -- The account's spaces general search may look in: not restricted, not under a restricted one.
  visible (id) as (
    select s.id from public.space s
    where s.owner_user_id = p_user and s.parent_id is null and not s.is_restricted
    union all
    select s.id from public.space s join visible v on s.parent_id = v.id
    where not s.is_restricted
  ) cycle id set looped using path,
  -- Places and everything under it: a place there stays where it is.
  in_places (id) as (
    select v_places
    union all
    select s.id from public.space s join in_places p on s.parent_id = p.id
  ) cycle id set looped using path
  update public.item i set space_id = v_places
  where i.item_type = 'place'
    and i.deleted_at is null
    and i.metadata ->> 'kind' is distinct from 'home'
    and i.space_id in (select id from visible where not looped)
    and i.space_id not in (select id from in_places where not looped);
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

revoke execute on function _ensure_built_in_spaces(uuid), _move_places_into_places(uuid)
  from public, anon, authenticated;

-- Every account: the Places space, then its places into it.
select public._ensure_built_in_spaces(u.id) from public.app_user u;
select public._move_places_into_places(u.id) from public.app_user u;
