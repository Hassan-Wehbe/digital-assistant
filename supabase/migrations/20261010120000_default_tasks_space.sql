-- Every account has a Tasks space (owner, 2026-10-09). Until now the space was made by the first
-- task (mcp/lib/tasks.ts tasksSpace, which stays as the fallback when the space is renamed or
-- deleted). Now sign-up makes it, and accounts made before this get one now.
--
-- Same name and description as tasksSpace: "Tasks", "Things to do, with due dates", top level, not
-- restricted. An account that already has a top-level space called Tasks (any case) gets nothing:
-- tasksSpace uses that one. Safe to run twice.
--
-- handle_new_auth_user is the sign-up trigger's function (20260928120100_knowledge_path.sql); it
-- runs as its owner (security definer) with an empty search_path, so every name is qualified. The
-- app_user insert is unchanged. Nothing here grants anything: the function stays revoked from
-- public, anon and authenticated.

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_user (id, email, display_name)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  -- The Tasks space, owned by the new account (the ✅ Tasks tile's tasks go here by default).
  insert into public.space (owner_user_id, parent_id, name, description, is_restricted)
  select new.id, null, 'Tasks', 'Things to do, with due dates', false
  where exists (select 1 from public.app_user u where u.id = new.id)
    and not exists (
      select 1 from public.space s
      where s.owner_user_id = new.id and s.parent_id is null and lower(s.name) = 'tasks'
    );
  return new;
end;
$$;
revoke execute on function handle_new_auth_user() from public, anon, authenticated;

-- Accounts made before this migration.
insert into space (owner_user_id, parent_id, name, description, is_restricted)
select u.id, null, 'Tasks', 'Things to do, with due dates', false
from app_user u
where not exists (
  select 1 from space s
  where s.owner_user_id = u.id and s.parent_id is null and lower(s.name) = 'tasks'
);
