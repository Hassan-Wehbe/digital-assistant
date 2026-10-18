-- Routines, step 1 (docs/routines-plan.md, design D39; owner's answers 2026-10-18). A routine is an
-- item (item_type 'routine') in the Tasks space and its tasks are ordinary tasks with
-- metadata.routine_id: no new table for them (D5). This migration adds two things:
--
--   * task_not_today: My day's "✕ Not today" on a suggested routine task, kept on the server so it
--     holds on every device (Q5). Only a task id and a day, never task text. A table, not task
--     metadata, so a dismissal writes no revision (rule 7 stays about real edits). RLS own rows
--     (rule 5); a row can only name the user's own live task in a searchable space (rule 3); anon
--     gets nothing; rows older than a couple of days are dropped as new ones are written.
--   * The recycle bin takes a routine's tasks with it (Q8: deleting a routine deletes all its
--     tasks): delete_item on a routine bins its live tasks at the same moment; restore_item brings
--     back those binned with it; purge_item deletes them for good with it, and deleted_item_files
--     lists their files too, so the server removes them from Storage first. Soft delete first, as
--     always (rule 8). Other items work exactly as before.

-- =========================================================
-- Not today
-- =========================================================

create table task_not_today (
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  task_id     uuid not null references item (id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, task_id, day)
);
create index task_not_today_task_idx on task_not_today (task_id);

alter table task_not_today enable row level security;
create policy task_not_today_read on task_not_today for select
  using (user_id = auth.uid());
create policy task_not_today_remove on task_not_today for delete
  using (user_id = auth.uid());
create policy task_not_today_add on task_not_today for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.item i
      where i.id = task_id and i.item_type = 'task' and i.deleted_at is null
        and i.space_id in (select public.searchable_space_ids())
    )
  );

-- Before a row is written: a day near today (the phone's date may be a day either side of the
-- server's), and the person's rows for days long gone dropped.
create function task_not_today_before() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.day < current_date - 2 or new.day > current_date + 400 then
    raise exception 'Not today is for today or a coming day.' using errcode = '22023';
  end if;
  delete from public.task_not_today where user_id = new.user_id and day < current_date - 2;
  return new;
end;
$$;

create trigger task_not_today_before
  before insert on task_not_today
  for each row execute function task_not_today_before();

-- =========================================================
-- The recycle bin and a routine's tasks
-- =========================================================

-- Move a note to the recycle bin; a routine takes its live tasks with it, at the same moment.
create or replace function delete_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_at    timestamptz := now();
  v_title text;
  v_type  text;
  v_tasks int := 0;
begin
  update public.item i set deleted_at = v_at
  from public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is null
  returning i.title, i.item_type into v_title, v_type;
  if not found then
    raise exception 'item not found (or already in the recycle bin)' using errcode = 'P0002';
  end if;
  if v_type = 'routine' then
    update public.item i set deleted_at = v_at
    from public.space sp
    where sp.id = i.space_id and sp.owner_user_id = v_uid and i.deleted_at is null
      and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text;
    get diagnostics v_tasks = row_count;
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'in_recycle_bin', true, 'tasks', v_tasks);
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'in_recycle_bin', true);
end;
$$;

-- Take a note back out of the recycle bin; a routine brings back the tasks binned with it.
create or replace function restore_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_at    timestamptz;
  v_title text;
  v_type  text;
  v_tasks int := 0;
begin
  select i.deleted_at, i.item_type into v_at, v_type
  from public.item i join public.space sp on sp.id = i.space_id
  where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null;
  update public.item i set deleted_at = null
  from public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is not null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found in the recycle bin' using errcode = 'P0002';
  end if;
  if v_type = 'routine' then
    update public.item i set deleted_at = null
    from public.space sp
    where sp.id = i.space_id and sp.owner_user_id = v_uid and i.deleted_at = v_at
      and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text;
    get diagnostics v_tasks = row_count;
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'restored', true, 'tasks', v_tasks);
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'restored', true);
end;
$$;

-- The Storage paths of a binned note's files (and, for a routine, of the tasks binned with it), for
-- the server to delete before purge_item.
create or replace function deleted_item_files(p_item_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_at   timestamptz;
  v_type text;
  v_keys text[];
begin
  select i.deleted_at, i.item_type into v_at, v_type
  from public.item i join public.space sp on sp.id = i.space_id
  where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null;
  if not found then
    raise exception 'item not found in the recycle bin (only notes in the bin can be deleted for good)'
      using errcode = 'P0002';
  end if;
  select coalesce(array_agg(a.storage_key order by a.created_at), '{}') into v_keys
  from public.attachment a
  where a.item_id = p_item_id
     or (v_type = 'routine' and a.item_id in (
       select i.id from public.item i join public.space sp on sp.id = i.space_id
       where sp.owner_user_id = v_uid and i.deleted_at = v_at
         and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text));
  return v_keys;
end;
$$;

-- Delete a binned note for good; a routine takes the tasks binned with it.
create or replace function purge_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_at    timestamptz;
  v_title text;
  v_type  text;
  v_tasks int := 0;
begin
  select i.deleted_at, i.item_type into v_at, v_type
  from public.item i join public.space sp on sp.id = i.space_id
  where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null;
  if v_type = 'routine' then
    delete from public.item i
    using public.space sp
    where sp.id = i.space_id and sp.owner_user_id = v_uid and i.deleted_at = v_at
      and i.item_type = 'task' and i.metadata ->> 'routine_id' = p_item_id::text;
    get diagnostics v_tasks = row_count;
  end if;
  delete from public.item i
  using public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is not null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found in the recycle bin (only notes in the bin can be deleted for good)'
      using errcode = 'P0002';
  end if;
  if v_type = 'routine' then
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'purged', true, 'tasks', v_tasks);
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'purged', true);
end;
$$;

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on task_not_today from public, anon, authenticated;
grant select, delete on task_not_today to authenticated;     -- RLS: own rows only
grant insert (task_id, day) on task_not_today to authenticated;

revoke execute on function task_not_today_before() from public, anon, authenticated;

-- The replaced functions keep their grants; stated again so this file reads on its own.
revoke execute on function delete_item(uuid), restore_item(uuid), deleted_item_files(uuid), purge_item(uuid)
  from public, anon;
grant execute on function delete_item(uuid), restore_item(uuid), deleted_item_files(uuid), purge_item(uuid)
  to authenticated;
