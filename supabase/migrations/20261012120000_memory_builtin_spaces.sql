-- Automatic memory, step 1 (docs/memory-plan.md, owner 2026-10-10): built-in spaces, the Memories
-- space, and the memory switch.
--
--   * space.built_in: 'tasks' or 'memories' on each account's built-in spaces, null on the user's
--     own. At most one of each per account. Set only here and at sign-up, never by the user.
--   * space_built_in_guard: a built-in space cannot be deleted, renamed, moved or restricted, by
--     anyone (the app, the chat, the Claude connector, the SQL editor as a user). Its description
--     can change, and the notes inside stay the user's. Deleting the whole account still removes it
--     (the account's app_user row is gone by then).
--   * Every account gets a Memories space ("What Wilma remembered about you"), top level, not
--     restricted, and its Tasks space is marked built-in: the oldest top-level, not restricted
--     space called Tasks (any case), the one 20261010120000_default_tasks_space.sql made; an
--     account without one (renamed or deleted since) gets a new one. A top-level "Memories" the
--     user already made is marked rather than duplicated. Safe to run twice.
--   * app_user.memory_on: off by default (Q3); each user reads and changes only their own (RLS
--     policy app_user_self, as distance_unit).
--   * Memory notes are ordinary items with item_type 'memory' (no schema change: item_type is
--     free text); search, revisions, the recycle bin and RLS apply as they are.
--
-- handle_new_auth_user is the version from 20261011120000_invite_signup.sql, with the Tasks insert
-- replaced by _ensure_built_in_spaces. Nothing new is granted to anon; the helper is revoked from
-- public, anon and authenticated.

-- =========================================================
-- Columns
-- =========================================================

alter table space
  add column built_in text
  constraint space_built_in_check check (built_in in ('tasks', 'memories'));
create unique index space_built_in_once on space (owner_user_id, built_in) where built_in is not null;
-- Readable like the rest of the space (the app shows the BUILT-IN badge).

alter table app_user
  add column memory_on boolean not null default false;
grant select (memory_on) on app_user to authenticated;
grant update (memory_on) on app_user to authenticated;

-- =========================================================
-- The guard
-- =========================================================

create function space_built_in_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_what text;
begin
  if tg_op = 'INSERT' then
    -- Only this migration and sign-up (as the table owner) make built-in spaces.
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
      when new.name is distinct from old.name then 'renamed'
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

create trigger space_built_in_guard
  before insert or update or delete on space
  for each row execute function space_built_in_guard();

-- =========================================================
-- The built-in spaces for one account
-- =========================================================

-- Marks or makes the account's Tasks and Memories spaces. Runs as its owner (sign-up and this
-- migration only).
create function _ensure_built_in_spaces(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_name text;
  v_desc text;
  v_id uuid;
begin
  foreach v_kind in array array['tasks', 'memories'] loop
    if exists (select 1 from public.space where owner_user_id = p_user and built_in = v_kind) then
      continue;
    end if;
    v_name := case v_kind when 'tasks' then 'Tasks' else 'Memories' end;
    v_desc := case v_kind when 'tasks' then 'Things to do, with due dates' else 'What Wilma remembered about you' end;
    -- The user's own top-level space of that name (oldest first), when it is not restricted.
    select id into v_id from public.space
    where owner_user_id = p_user and parent_id is null and lower(name) = lower(v_name) and not is_restricted
    order by created_at, id
    limit 1;
    if v_id is not null then
      update public.space set built_in = v_kind where id = v_id;
    else
      insert into public.space (owner_user_id, parent_id, name, description, is_restricted, built_in)
      values (p_user, null, v_name, v_desc, false, v_kind)
      on conflict do nothing;  -- a restricted space of that exact name: left alone
    end if;
  end loop;
end;
$$;
revoke execute on function _ensure_built_in_spaces(uuid) from public, anon, authenticated;

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code public.invite_code;
  v_problem text;
  v_terms text := (select s.terms_version from public.signup_setting s);
  v_accepted boolean;
begin
  -- The invite code, locked until the sign-up commits. The hook has already checked it; this
  -- check again stops two sign-ups at once from both taking a code's last use.
  if nullif(btrim(v_meta ->> 'invite_code'), '') is not null then
    select * into v_code from public.invite_code
    where code_hash = public.invite_code_hash(v_meta ->> 'invite_code')
    for update;
    v_problem := public.invite_code_problem(v_code);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
  v_accepted := v_meta -> 'age_confirmed' = 'true'::jsonb and v_meta ->> 'terms_version' = v_terms;

  insert into public.app_user (id, email, display_name, plan, terms_version, terms_accepted_at, age_confirmed)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name',
          coalesce(v_code.grants_plan, 'free'),
          case when v_accepted then v_terms end,
          case when v_accepted then now() end,
          coalesce(v_accepted, false))
  on conflict (id) do nothing;

  if v_code.id is not null then
    update public.invite_code set uses = uses + 1 where id = v_code.id;
    insert into public.invite_use (invite_code_id, user_id) values (v_code.id, new.id)
    on conflict do nothing;
    -- The code has done its job; it is not kept with the account.
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'invite_code' where id = new.id;
  end if;

  -- The built-in spaces, owned by the new account: Tasks (the ✅ Tasks tile's tasks go here by
  -- default) and Memories (what Wilma remembers, docs/memory-plan.md). Neither can be deleted,
  -- renamed, moved or restricted (space_built_in_guard below).
  if exists (select 1 from public.app_user u where u.id = new.id) then
    perform public._ensure_built_in_spaces(new.id);
  end if;
  return new;
end;
$$;
revoke execute on function handle_new_auth_user() from public, anon, authenticated;

-- Accounts made before this migration.
select _ensure_built_in_spaces(u.id) from app_user u;
