-- Deleting notes, spaces and (through the existing delete_attachment) files.
-- Owner's decisions (2026-09-30):
--   * A deleted note goes to a recycle bin (soft delete, CLAUDE.md rule 8): hidden from
--     the app, search and Claude, listed in the bin, restorable. Deleting it for good
--     (purge) is a separate, explicit action on a note already in the bin.
--   * A space can be deleted only when it is empty: no notes (not even in the bin), no
--     sub-spaces, no vault secrets. The foreign keys cascade, so without this check a
--     space delete would silently take its notes and secrets with it.
--
-- Files: purging a note removes its attachment rows here; the MCP server deletes the
-- Storage objects first (deleted_item_files), as delete_attachment does for one file.
-- All functions answer only for the caller's own spaces.

-- Move a note to the recycle bin.
create or replace function delete_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_title text;
begin
  update public.item i set deleted_at = now()
  from public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found (or already in the recycle bin)' using errcode = 'P0002';
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'in_recycle_bin', true);
end;
$$;

-- Take a note back out of the recycle bin.
create or replace function restore_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_title text;
begin
  update public.item i set deleted_at = null
  from public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is not null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found in the recycle bin' using errcode = 'P0002';
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'restored', true);
end;
$$;

-- The recycle bin, most recently deleted first. Notes from restricted spaces are left
-- out, as they are from search (CLAUDE.md rule 3).
create or replace function list_deleted_items(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'deleted_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', i.id, 'title', i.title, 'item_type', i.item_type,
      'space_id', i.space_id, 'deleted_at', i.deleted_at,
      'attachments', (select count(*) from public.attachment a where a.item_id = i.id)) as x
    from public.item i
    join public.space sp on sp.id = i.space_id and sp.owner_user_id = public._vault_require_user()
    where i.deleted_at is not null
      and i.space_id in (select public.searchable_space_ids())
    order by i.deleted_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) t;
$$;

-- The Storage paths of a binned note's files, for the server to delete before purge_item.
create or replace function deleted_item_files(p_item_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_keys text[];
begin
  if not exists (
    select 1 from public.item i join public.space sp on sp.id = i.space_id
    where i.id = p_item_id and sp.owner_user_id = v_uid and i.deleted_at is not null) then
    raise exception 'item not found in the recycle bin (only notes in the bin can be deleted for good)'
      using errcode = 'P0002';
  end if;
  select coalesce(array_agg(a.storage_key order by a.created_at), '{}') into v_keys
  from public.attachment a where a.item_id = p_item_id;
  return v_keys;
end;
$$;

-- Delete a binned note for good: the note, its history, search text, links, tags,
-- attachment rows and open upload links (all by foreign-key cascade).
create or replace function purge_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_title text;
begin
  delete from public.item i
  using public.space sp
  where i.id = p_item_id and sp.id = i.space_id and sp.owner_user_id = v_uid
    and i.deleted_at is not null
  returning i.title into v_title;
  if not found then
    raise exception 'item not found in the recycle bin (only notes in the bin can be deleted for good)'
      using errcode = 'P0002';
  end if;
  return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'purged', true);
end;
$$;

-- Delete an empty space. Refuses, saying what is still inside, otherwise.
create or replace function delete_space(p_space_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := public._vault_require_user();
  v_name    text;
  v_live    int;
  v_binned  int;
  v_subs    int;
  v_secrets int;
  v_parts   text[] := '{}';
begin
  select name into v_name from public.space where id = p_space_id and owner_user_id = v_uid
  for update;
  if not found then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    into v_live, v_binned from public.item where space_id = p_space_id;
  select count(*) into v_subs from public.space where parent_id = p_space_id;
  select count(*) into v_secrets from public.secret where space_id = p_space_id;

  if v_live > 0 then
    v_parts := v_parts || format('%s %s', v_live, case when v_live = 1 then 'note' else 'notes' end);
  end if;
  if v_binned > 0 then
    v_parts := v_parts || format('%s %s in the recycle bin', v_binned, case when v_binned = 1 then 'note' else 'notes' end);
  end if;
  if v_subs > 0 then
    v_parts := v_parts || format('%s %s', v_subs, case when v_subs = 1 then 'sub-space' else 'sub-spaces' end);
  end if;
  if v_secrets > 0 then
    v_parts := v_parts || format('%s vault %s', v_secrets, case when v_secrets = 1 then 'password' else 'passwords' end);
  end if;
  if cardinality(v_parts) > 0 then
    raise exception '"%" is not empty: it still holds %. Only an empty space can be deleted.',
      v_name, array_to_string(v_parts, ', ') using errcode = 'P0001';
  end if;

  delete from public.space where id = p_space_id and owner_user_id = v_uid;
  return jsonb_build_object('space_id', p_space_id, 'name', v_name, 'deleted', true);
end;
$$;

revoke execute on function
  delete_item(uuid), restore_item(uuid), list_deleted_items(int), deleted_item_files(uuid),
  purge_item(uuid), delete_space(uuid)
  from public, anon;
grant execute on function
  delete_item(uuid), restore_item(uuid), list_deleted_items(int), deleted_item_files(uuid),
  purge_item(uuid), delete_space(uuid)
  to authenticated;
