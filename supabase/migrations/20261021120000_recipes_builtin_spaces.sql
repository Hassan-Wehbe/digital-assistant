-- Recipes and cocktails, step 1 (docs/recipes-plan.md, D43; owner's answers 2026-10-20, Q1 and
-- Q2): two more built-in spaces on every account, Recipes and Cocktails.
--
--   * space.built_in also allows 'recipes' and 'cocktails' (still at most one of each per account,
--     space_built_in_once). space_built_in_guard is unchanged: like Tasks and Memories, they cannot
--     be deleted, renamed, moved or restricted, and nobody but sign-up and a migration marks one.
--   * _ensure_built_in_spaces marks or makes all four, as before: the user's own oldest top-level,
--     not restricted space of that name (any case) is marked rather than duplicated; a restricted
--     one is left alone and never marked, and no second space of that name is made beside it
--     (rule 3: a space the user locked stays locked). Sign-up (handle_new_auth_user) already calls
--     it, so new accounts get them with no change there.
--   * Every existing account gets them now. Safe to run twice.
--
-- Recipes and cocktails are ordinary items in them (item_type 'recipe' and 'cocktail'; no schema
-- change, item_type is free text); search, revisions, the recycle bin and RLS apply as they are.
-- Nothing new is granted: the helper stays revoked from public, anon and authenticated.

alter table space drop constraint space_built_in_check;
alter table space add constraint space_built_in_check
  check (built_in in ('tasks', 'memories', 'recipes', 'cocktails'));

-- Marks or makes the account's built-in spaces. Runs as its owner (sign-up and migrations only).
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
end;
$$;
revoke execute on function _ensure_built_in_spaces(uuid) from public, anon, authenticated;

-- Accounts made before this migration.
select _ensure_built_in_spaces(u.id) from app_user u;
