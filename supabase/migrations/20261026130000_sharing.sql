-- Sharing spaces and notes, step 1 (docs/sharing-plan.md; design D32, built on D14; owner's answers
-- 2026-10-26: all as recommended). Share a space (with its sub-spaces) or one note with another
-- Wilma user by email, "view" or "edit", optionally until a date; nothing is visible to them until
-- they accept. Everything is enforced here, in the database:
--
--   * space_share (new) and item_share (D14, now with an invitation status): who shared what with
--     which email, view or edit, invited / accepted / declined, an optional end date, stopped.
--     Users never read or write these tables directly; every step goes through the functions below.
--   * The recipient reads and edits only through functions that check access explicitly
--     (_item_access): search_items, get_item, get_attachment, save_item, update_item, delete_item.
--     No table policy changes for the recipient, so every other query (planners, suggestions,
--     memory, routines, favourites, the recycle bin) still sees only the user's own rows (Q7).
--   * Never shared (rules 3 and 4, Q8): restricted spaces and anything under one, Memories, Tasks
--     and anything under them, routines, and secrets (no function here reads `secret`; a shared
--     space's passwords stay the owner's alone). Restricting a shared space, or moving it or a
--     shared note under a restricted space, ends the sharing (Q9); access is re-checked on every
--     read anyway.
--   * Q2: the sharer is never told whether an email has a Wilma account: an invitation is kept by
--     email; until it is accepted the sharer sees "invited", whether the person has no account,
--     has not answered, declined or blocked them.
--   * Q4/Q5: an editor adds notes (owned by the space's owner, created_by records who), changes
--     notes (a revision is kept, edited_by records who) and moves notes to the owner's recycle bin;
--     no tags, files, moving, restoring or purging. Q11: block and report. Q13: 20 people per space
--     or note, 20 invitations a day.
--   * The old item_shared_read policy (an item_share row showed the note at once, with no
--     acceptance) is dropped; no code ever created a share, so nothing was exposed.

-- =========================================================
-- Tables
-- =========================================================

create table space_share (
  id                   uuid primary key default gen_random_uuid(),
  space_id             uuid not null references space (id) on delete cascade,
  shared_by_user_id    uuid not null references app_user (id) on delete cascade,
  shared_with_email    text not null check (shared_with_email = lower(btrim(shared_with_email)) and length(shared_with_email) between 3 and 320),
  shared_with_user_id  uuid references app_user (id) on delete cascade,  -- known once the account exists; fixed on accept
  permission           text not null default 'view' check (permission in ('view', 'edit')),
  status               text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  expires_at           timestamptz,
  revoked_at           timestamptz,
  ended_reason         text check (ended_reason in ('stopped', 'left', 'blocked', 'restricted', 'expired')),
  responded_at         timestamptz,
  created_at           timestamptz not null default now(),
  check (shared_with_user_id is null or shared_with_user_id <> shared_by_user_id)
);
-- One open share per space and email (declined ones stay open, so re-inviting changes nothing).
create unique index space_share_open_idx on space_share (space_id, shared_with_email) where revoked_at is null;
create index space_share_with_user_idx on space_share (shared_with_user_id);
create index space_share_with_email_idx on space_share (shared_with_email);
create index space_share_by_idx on space_share (shared_by_user_id, created_at);

alter table item_share
  add column shared_with_email text check (shared_with_email = lower(btrim(shared_with_email)) and length(shared_with_email) between 3 and 320),
  add column status       text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  add column ended_reason text check (ended_reason in ('stopped', 'left', 'blocked', 'restricted', 'expired')),
  add column responded_at timestamptz;
-- Rows made before this migration (none were made by Wilma) stay invitations: nothing shows until accepted.
update item_share sh set shared_with_email = lower(u.email) from app_user u where u.id = sh.shared_with_user_id;
alter table item_share alter column shared_with_email set not null;
alter table item_share alter column shared_with_user_id drop not null;
alter table item_share drop constraint item_share_check;
alter table item_share add constraint item_share_not_self check (shared_with_user_id is null or shared_with_user_id <> shared_by_user_id);
create unique index item_share_open_idx on item_share (item_id, shared_with_email) where revoked_at is null;
create index item_share_with_email_idx on item_share (shared_with_email);
create index item_share_by_created_idx on item_share (shared_by_user_id, created_at);

-- "Don't show me invitations from this person" (Q11).
create table share_block (
  user_id          uuid not null references app_user (id) on delete cascade,
  blocked_user_id  uuid not null references app_user (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (user_id, blocked_user_id),
  check (user_id <> blocked_user_id)
);

-- A report to Wilma's administrators (Q11): which share, by whom, a short reason. Never the content.
create table share_report (
  id                uuid primary key default gen_random_uuid(),
  reporter_user_id  uuid not null references app_user (id) on delete cascade,
  reported_user_id  uuid references app_user (id) on delete set null,
  share_kind        text not null check (share_kind in ('space', 'note')),
  share_id          uuid not null,
  reason            text not null default '' check (length(reason) <= 500),
  created_at        timestamptz not null default now()
);
create index share_report_reporter_idx on share_report (reporter_user_id, created_at);

-- Who added and who last changed a note (Q5), and who wrote each earlier version.
alter table item
  add column created_by uuid references app_user (id) on delete set null default auth.uid(),
  add column updated_by uuid references app_user (id) on delete set null;
-- No foreign key: deleting an account deletes its notes' revisions in the same step, and clearing a
-- key there would collide with that. An id whose account is gone simply names nobody (_person).
alter table item_revision
  add column edited_by uuid;
create index item_created_by_idx on item (created_by);
create index item_updated_by_idx on item (updated_by);
create index item_revision_edited_by_idx on item_revision (edited_by);

alter table space_share  enable row level security;
alter table share_block  enable row level security;
alter table share_report enable row level security;

-- Only the functions below touch the sharing tables.
drop policy item_shared_read on item;
drop policy item_share_owner on item_share;
drop policy item_share_recipient on item_share;
revoke all on space_share, item_share, share_block, share_report from public, anon, authenticated;

-- =========================================================
-- Revisions say who (rule 7)
-- =========================================================

-- created_by and updated_by are set here and by the functions below, never by a direct write
-- (a user writing their own rows through the API can't put someone else's name on a note).
create function item_before_insert() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.created_by := auth.uid();
    new.updated_by := null;
  end if;
  return new;
end;
$$;
create trigger item_before_insert
  before insert on item
  for each row execute function item_before_insert();

create or replace function item_before_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.created_by := old.created_by;
    new.updated_by := old.updated_by;
  end if;
  if (old.title, old.body_markdown, old.metadata)
     is distinct from (new.title, new.body_markdown, new.metadata) then
    insert into item_revision (item_id, revision_number, title, body_markdown, metadata, change_note, edited_by)
    values (
      old.id,
      coalesce((select max(revision_number) from item_revision where item_id = old.id), 0) + 1,
      old.title, old.body_markdown, old.metadata,
      nullif(current_setting('app.change_note', true), ''),
      coalesce(old.updated_by, old.created_by));
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- =========================================================
-- Access helpers (internal: not callable by users)
-- =========================================================

-- A space can be shared, and stays reachable through a share, only if neither it nor any space
-- above it is restricted (rule 3), Memories or Tasks (Q8). An unknown space is not shareable.
create function _space_shareable(p_space uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive up (id, parent_id, is_restricted, built_in) as (
    select s.id, s.parent_id, s.is_restricted, s.built_in from public.space s where s.id = p_space
    union all
    select s.id, s.parent_id, s.is_restricted, s.built_in from public.space s join up on s.id = up.parent_id
  ) cycle id set looped using path
  select exists (select 1 from up)
     and not exists (select 1 from up where is_restricted or built_in in ('memories', 'tasks') or looped);
$$;

-- An accepted share that is still running.
create function _share_live(p_status text, p_revoked timestamptz, p_expires timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_status = 'accepted' and p_revoked is null and (p_expires is null or p_expires > now());
$$;

-- The spaces shared with p_user (accepted, running, shareable) and every sub-space under them that
-- is not restricted, with the best permission and who shared it.
create function _shared_spaces(p_user uuid)
returns table (space_id uuid, permission text, share_id uuid, shared_by uuid)
language sql stable security definer set search_path = '' as $$
  with recursive roots as (
    select sh.space_id, sh.permission, sh.id as share_id, sh.shared_by_user_id as shared_by
    from public.space_share sh
    join public.space s on s.id = sh.space_id and s.owner_user_id = sh.shared_by_user_id
    where p_user is not null and sh.shared_with_user_id = p_user
      and public._share_live(sh.status, sh.revoked_at, sh.expires_at)
      and public._space_shareable(sh.space_id)
      and not exists (select 1 from public.share_block b where b.user_id = p_user and b.blocked_user_id = sh.shared_by_user_id)
  ),
  tree (space_id, permission, share_id, shared_by) as (
    select * from roots
    union all
    select s.id, t.permission, t.share_id, t.shared_by
    from public.space s join tree t on s.parent_id = t.space_id
    where not s.is_restricted and s.built_in is null
  ) cycle space_id set looped using path
  select distinct on (space_id) space_id, permission, share_id, shared_by
  from tree where not looped
  order by space_id, (permission = 'edit') desc;
$$;

-- What p_user may do with a note: 'owner', 'edit', 'view' or null. Deleted notes are only the
-- owner's. Routines are never shared.
create function _item_access(p_user uuid, p_item uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item  public.item;
  v_owner uuid;
  v_perm  text;
begin
  if p_user is null or p_item is null then return null; end if;
  select * into v_item from public.item where id = p_item;
  if not found then return null; end if;
  select owner_user_id into v_owner from public.space where id = v_item.space_id;
  if v_owner = p_user then return 'owner'; end if;
  if v_item.deleted_at is not null or v_item.item_type = 'routine' then return null; end if;
  select ss.permission into v_perm from public._shared_spaces(p_user) ss where ss.space_id = v_item.space_id;
  if v_perm = 'edit' then return 'edit'; end if;
  if exists (
    select 1 from public.item_share sh
    where sh.item_id = p_item and sh.shared_with_user_id = p_user and sh.shared_by_user_id = v_owner
      and public._share_live(sh.status, sh.revoked_at, sh.expires_at)
      and sh.permission = 'edit'
      and not exists (select 1 from public.share_block b where b.user_id = p_user and b.blocked_user_id = v_owner))
     and public._space_shareable(v_item.space_id) then
    return 'edit';
  end if;
  if v_perm = 'view' then return 'view'; end if;
  if exists (
    select 1 from public.item_share sh
    where sh.item_id = p_item and sh.shared_with_user_id = p_user and sh.shared_by_user_id = v_owner
      and public._share_live(sh.status, sh.revoked_at, sh.expires_at)
      and not exists (select 1 from public.share_block b where b.user_id = p_user and b.blocked_user_id = v_owner))
     and public._space_shareable(v_item.space_id) then
    return 'view';
  end if;
  return null;
end;
$$;

-- A person's name as the other side of a share sees it: their name, else their email.
create function _person(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when u.id is null then null
              else jsonb_build_object('name', coalesce(nullif(btrim(u.display_name), ''), u.email), 'email', u.email) end
  from (select p_user as id) x left join public.app_user u on u.id = x.id;
$$;

revoke execute on function _space_shareable(uuid), _share_live(text, timestamptz, timestamptz),
  _shared_spaces(uuid), _item_access(uuid, uuid), _person(uuid)
  from public, anon, authenticated;

-- Shared notes' files: Storage asks this when a recipient's signed link is made (rule 5: the
-- caller's own access, checked here).
create function _can_read_storage_key(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attachment a
    join public.item i on i.id = a.item_id and i.deleted_at is null
    where a.storage_key = p_key and public._item_access(auth.uid(), a.item_id) in ('owner', 'edit', 'view'));
$$;
revoke execute on function _can_read_storage_key(text) from public, anon;
grant execute on function _can_read_storage_key(text) to authenticated;

create policy attachments_select_shared on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public._can_read_storage_key(name));

-- =========================================================
-- Sharing (Q1-Q3, Q6, Q11, Q13)
-- =========================================================

-- Invitations not answered within 30 days lapse.
create function _invitation_open(p_status text, p_revoked timestamptz, p_expires timestamptz, p_created timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_status = 'invited' and p_revoked is null and (p_expires is null or p_expires > now())
     and p_created > now() - interval '30 days';
$$;
revoke execute on function _invitation_open(text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- Checks shared by share_space and share_item; returns the email to use.
create function _share_checks(p_uid uuid, p_email text, p_permission text, p_expires_at timestamptz) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 320 then
    raise exception 'That doesn''t look like an email address.' using errcode = '22023';
  end if;
  if v_email = (select lower(email) from public.app_user where id = p_uid) then
    raise exception 'That''s your own email.' using errcode = '22023';
  end if;
  if p_permission is null or p_permission not in ('view', 'edit') then
    raise exception 'permission must be view or edit' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The end date must be in the future.' using errcode = '22023';
  end if;
  if (select count(*) from public.space_share where shared_by_user_id = p_uid and created_at > now() - interval '1 day')
     + (select count(*) from public.item_share where shared_by_user_id = p_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent 20 invitations today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  return v_email;
end;
$$;
revoke execute on function _share_checks(uuid, text, text, timestamptz) from public, anon, authenticated;

-- Share a space you own (and its sub-spaces). The answer is the same whether or not the email has
-- a Wilma account (Q2). Sharing again with the same email changes the permission and end date.
create function share_space(p_space_id uuid, p_email text, p_permission text default 'view',
                            p_expires_at timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_space public.space;
  v_email text;
  v_id    uuid;
  v_to    uuid;
begin
  select * into v_space from public.space where id = p_space_id and owner_user_id = v_uid;
  if not found then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
  if not public._space_shareable(p_space_id) then
    raise exception '%', case
      when exists (select 1 from public.space where id = p_space_id and built_in in ('memories', 'tasks'))
        then format('"%s" can''t be shared.', v_space.name)
      else 'Restricted spaces, and spaces inside them, can''t be shared.' end
      using errcode = 'P0001';
  end if;
  v_email := public._share_checks(v_uid, p_email, p_permission, p_expires_at);

  -- A share past its end date is over: sharing again sends a new invitation.
  update public.space_share set revoked_at = now(), ended_reason = 'expired'
  where space_id = p_space_id and shared_with_email = v_email and revoked_at is null and expires_at <= now();
  update public.space_share set permission = p_permission, expires_at = p_expires_at
  where space_id = p_space_id and shared_with_email = v_email and revoked_at is null
  returning id into v_id;
  if v_id is null then
    if (select count(*) from public.space_share where space_id = p_space_id and revoked_at is null
          and (expires_at is null or expires_at > now())) >= 20 then
      raise exception 'This space is already shared with 20 people.' using errcode = 'P0001';
    end if;
    v_to := (select id from public.app_user where lower(email) = v_email order by created_at limit 1);
    -- Someone who blocked you never sees it, now or after unblocking; you still read "invited" (Q2).
    insert into public.space_share (space_id, shared_by_user_id, shared_with_email, shared_with_user_id, permission, expires_at, status)
    values (p_space_id, v_uid, v_email, v_to, p_permission, p_expires_at,
            case when exists (select 1 from public.share_block b where b.user_id = v_to and b.blocked_user_id = v_uid)
                 then 'declined' else 'invited' end)
    returning id into v_id;
  end if;
  return jsonb_build_object('share_id', v_id, 'sent', true);
end;
$$;

-- Share one note you own, the same way.
create function share_item(p_item_id uuid, p_email text, p_permission text default 'view',
                           p_expires_at timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_item  public.item;
  v_email text;
  v_id    uuid;
  v_to    uuid;
begin
  select i.* into v_item from public.item i join public.space s on s.id = i.space_id
  where i.id = p_item_id and s.owner_user_id = v_uid and i.deleted_at is null;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if v_item.item_type = 'routine' or not public._space_shareable(v_item.space_id) then
    raise exception 'Notes in restricted spaces, Memories, Tasks and routines can''t be shared.' using errcode = 'P0001';
  end if;
  v_email := public._share_checks(v_uid, p_email, p_permission, p_expires_at);

  -- A share past its end date is over: sharing again sends a new invitation.
  update public.item_share set revoked_at = now(), ended_reason = 'expired'
  where item_id = p_item_id and shared_with_email = v_email and revoked_at is null and expires_at <= now();
  update public.item_share set permission = p_permission, expires_at = p_expires_at
  where item_id = p_item_id and shared_with_email = v_email and revoked_at is null
  returning id into v_id;
  if v_id is null then
    if (select count(*) from public.item_share where item_id = p_item_id and revoked_at is null
          and (expires_at is null or expires_at > now())) >= 20 then
      raise exception 'This note is already shared with 20 people.' using errcode = 'P0001';
    end if;
    v_to := (select id from public.app_user where lower(email) = v_email order by created_at limit 1);
    -- Someone who blocked you never sees it, now or after unblocking; you still read "invited" (Q2).
    insert into public.item_share (item_id, shared_by_user_id, shared_with_email, shared_with_user_id, permission, expires_at, status)
    values (p_item_id, v_uid, v_email, v_to, p_permission, p_expires_at,
            case when exists (select 1 from public.share_block b where b.user_id = v_to and b.blocked_user_id = v_uid)
                 then 'declined' else 'invited' end)
    returning id into v_id;
  end if;
  return jsonb_build_object('share_id', v_id, 'sent', true);
end;
$$;

-- Who a space or note of yours is shared with (both null: everything you share). Until accepted a
-- share reads "invited" (Q2: declined, blocked and unknown emails look the same).
create function my_shares(p_space_id uuid default null, p_item_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'share_id', sh.id, 'kind', 'space', 'space_id', sh.space_id, 'name', s.name,
      'email', sh.shared_with_email,
      'person', case when sh.status = 'accepted' then public._person(sh.shared_with_user_id) end,
      'permission', sh.permission,
      'status', case when sh.status = 'accepted' then 'accepted'
                     when sh.created_at <= now() - interval '30 days' then 'invitation_lapsed' else 'invited' end,
      'expires_at', sh.expires_at, 'created_at', sh.created_at) as x
    from public.space_share sh join public.space s on s.id = sh.space_id
    where sh.shared_by_user_id = auth.uid() and sh.revoked_at is null
      and (sh.expires_at is null or sh.expires_at > now())
      and (p_item_id is null) and (p_space_id is null or sh.space_id = p_space_id)
    union all
    select jsonb_build_object(
      'share_id', sh.id, 'kind', 'note', 'item_id', sh.item_id, 'name', i.title,
      'email', sh.shared_with_email,
      'person', case when sh.status = 'accepted' then public._person(sh.shared_with_user_id) end,
      'permission', sh.permission,
      'status', case when sh.status = 'accepted' then 'accepted'
                     when sh.created_at <= now() - interval '30 days' then 'invitation_lapsed' else 'invited' end,
      'expires_at', sh.expires_at, 'created_at', sh.created_at)
    from public.item_share sh join public.item i on i.id = sh.item_id and i.deleted_at is null
    where sh.shared_by_user_id = auth.uid() and sh.revoked_at is null
      and (sh.expires_at is null or sh.expires_at > now())
      and (p_space_id is null) and (p_item_id is null or sh.item_id = p_item_id)
  ) t;
$$;

-- Invitations to you and what you have accepted. A shared space comes with its sub-spaces.
create function shared_with_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_email text := (select lower(email) from public.app_user where id = v_uid);
begin
  return coalesce((
    select jsonb_agg(x order by x ->> 'status' desc, x ->> 'created_at' desc) from (
      select jsonb_build_object(
        'share_id', sh.id, 'kind', 'space', 'status', sh.status,
        'space', jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description),
        'spaces', case when sh.status = 'accepted' then coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent_id', c.parent_id) order by c.name)
            from public._shared_spaces(v_uid) ss join public.space c on c.id = ss.space_id
            where ss.share_id = sh.id and c.id <> s.id), '[]'::jsonb) end,
        'from', public._person(sh.shared_by_user_id),
        'permission', sh.permission, 'expires_at', sh.expires_at, 'created_at', sh.created_at) as x
      from public.space_share sh join public.space s on s.id = sh.space_id
      where (sh.shared_with_user_id = v_uid or (sh.shared_with_user_id is null and sh.shared_with_email = v_email))
        and (public._invitation_open(sh.status, sh.revoked_at, sh.expires_at, sh.created_at)
             or (sh.shared_with_user_id = v_uid and public._share_live(sh.status, sh.revoked_at, sh.expires_at)))
        and public._space_shareable(sh.space_id)
        and not exists (select 1 from public.share_block b where b.user_id = v_uid and b.blocked_user_id = sh.shared_by_user_id)
      union all
      select jsonb_build_object(
        'share_id', sh.id, 'kind', 'note', 'status', sh.status,
        'item', jsonb_build_object('id', i.id, 'title', i.title, 'item_type', i.item_type),
        'from', public._person(sh.shared_by_user_id),
        'permission', sh.permission, 'expires_at', sh.expires_at, 'created_at', sh.created_at)
      from public.item_share sh join public.item i on i.id = sh.item_id and i.deleted_at is null and i.item_type <> 'routine'
      where (sh.shared_with_user_id = v_uid or (sh.shared_with_user_id is null and sh.shared_with_email = v_email))
        and (public._invitation_open(sh.status, sh.revoked_at, sh.expires_at, sh.created_at)
             or (sh.shared_with_user_id = v_uid and public._share_live(sh.status, sh.revoked_at, sh.expires_at)))
        and public._space_shareable(i.space_id)
        and not exists (select 1 from public.share_block b where b.user_id = v_uid and b.blocked_user_id = sh.shared_by_user_id)
    ) t), '[]'::jsonb);
end;
$$;

-- Answer an invitation, or leave a share: p_action is accept, decline, leave or block. Block also
-- ends every share from that person to you and hides their invitations from now on (Q11).
create function respond_to_share(p_share_id uuid, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := public._vault_require_user();
  v_email  text := (select lower(email) from public.app_user where id = v_uid);
  v_kind   text;
  v_by     uuid;
  v_status text;
  v_open   boolean;
  v_live   boolean;
begin
  if p_action is null or p_action not in ('accept', 'decline', 'leave', 'block') then
    raise exception 'action must be accept, decline, leave or block' using errcode = '22023';
  end if;
  select 'space', sh.shared_by_user_id, sh.status,
         public._invitation_open(sh.status, sh.revoked_at, sh.expires_at, sh.created_at) and public._space_shareable(sh.space_id),
         sh.shared_with_user_id = v_uid and public._share_live(sh.status, sh.revoked_at, sh.expires_at)
    into v_kind, v_by, v_status, v_open, v_live
  from public.space_share sh
  where sh.id = p_share_id and (sh.shared_with_user_id = v_uid or (sh.shared_with_user_id is null and sh.shared_with_email = v_email))
  for update;
  if v_kind is null then
    select 'note', sh.shared_by_user_id, sh.status,
           public._invitation_open(sh.status, sh.revoked_at, sh.expires_at, sh.created_at)
             and exists (select 1 from public.item i where i.id = sh.item_id and i.deleted_at is null and i.item_type <> 'routine'
                         and public._space_shareable(i.space_id)),
           sh.shared_with_user_id = v_uid and public._share_live(sh.status, sh.revoked_at, sh.expires_at)
      into v_kind, v_by, v_status, v_open, v_live
    from public.item_share sh
    where sh.id = p_share_id and (sh.shared_with_user_id = v_uid or (sh.shared_with_user_id is null and sh.shared_with_email = v_email))
    for update;
  end if;
  if v_kind is null or exists (select 1 from public.share_block b where b.user_id = v_uid and b.blocked_user_id = v_by) then
    raise exception 'share not found' using errcode = 'P0002';
  end if;

  if p_action = 'accept' then
    if not v_open then raise exception 'This invitation has ended.' using errcode = 'P0001'; end if;
    if v_kind = 'space' then
      update public.space_share set status = 'accepted', shared_with_user_id = v_uid, responded_at = now() where id = p_share_id;
    else
      update public.item_share set status = 'accepted', shared_with_user_id = v_uid, responded_at = now() where id = p_share_id;
    end if;
  elsif p_action = 'decline' then
    if not v_open then raise exception 'This invitation has ended.' using errcode = 'P0001'; end if;
    if v_kind = 'space' then
      update public.space_share set status = 'declined', shared_with_user_id = v_uid, responded_at = now() where id = p_share_id;
    else
      update public.item_share set status = 'declined', shared_with_user_id = v_uid, responded_at = now() where id = p_share_id;
    end if;
  elsif p_action = 'leave' then
    if not v_live then raise exception 'share not found' using errcode = 'P0002'; end if;
    if v_kind = 'space' then
      update public.space_share set revoked_at = now(), ended_reason = 'left' where id = p_share_id;
    else
      update public.item_share set revoked_at = now(), ended_reason = 'left' where id = p_share_id;
    end if;
  else -- block
    insert into public.share_block (user_id, blocked_user_id) values (v_uid, v_by) on conflict do nothing;
    update public.space_share set revoked_at = now(), ended_reason = 'blocked'
    where shared_by_user_id = v_by and shared_with_user_id = v_uid and status = 'accepted' and revoked_at is null;
    update public.item_share set revoked_at = now(), ended_reason = 'blocked'
    where shared_by_user_id = v_by and shared_with_user_id = v_uid and status = 'accepted' and revoked_at is null;
    update public.space_share set status = 'declined', shared_with_user_id = v_uid, responded_at = now()
    where shared_by_user_id = v_by and status = 'invited' and revoked_at is null
      and (shared_with_user_id = v_uid or (shared_with_user_id is null and shared_with_email = v_email));
    update public.item_share set status = 'declined', shared_with_user_id = v_uid, responded_at = now()
    where shared_by_user_id = v_by and status = 'invited' and revoked_at is null
      and (shared_with_user_id = v_uid or (shared_with_user_id is null and shared_with_email = v_email));
  end if;
  return jsonb_build_object('share_id', p_share_id, 'done', p_action);
end;
$$;

-- The owner changes a share (permission, end date) or stops it.
create function change_share(p_share_id uuid, p_permission text default null, p_expires_at timestamptz default null,
                             p_clear_end_date boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_user();
begin
  if p_permission is not null and p_permission not in ('view', 'edit') then
    raise exception 'permission must be view or edit' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The end date must be in the future.' using errcode = '22023';
  end if;
  update public.space_share set permission = coalesce(p_permission, permission),
    expires_at = case when p_clear_end_date then null else coalesce(p_expires_at, expires_at) end
  where id = p_share_id and shared_by_user_id = v_uid and revoked_at is null;
  if not found then
    update public.item_share set permission = coalesce(p_permission, permission),
      expires_at = case when p_clear_end_date then null else coalesce(p_expires_at, expires_at) end
    where id = p_share_id and shared_by_user_id = v_uid and revoked_at is null;
    if not found then raise exception 'share not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('share_id', p_share_id, 'changed', true);
end;
$$;

create function stop_share(p_share_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_user();
begin
  update public.space_share set revoked_at = now(), ended_reason = 'stopped'
  where id = p_share_id and shared_by_user_id = v_uid and revoked_at is null;
  if not found then
    update public.item_share set revoked_at = now(), ended_reason = 'stopped'
    where id = p_share_id and shared_by_user_id = v_uid and revoked_at is null;
    if not found then raise exception 'share not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('share_id', p_share_id, 'stopped', true);
end;
$$;

-- People you blocked, and unblocking one.
create function my_blocks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.blocked_user_id, 'person', public._person(b.blocked_user_id),
                                               'created_at', b.created_at) order by b.created_at), '[]'::jsonb)
  from public.share_block b where b.user_id = auth.uid();
$$;

create function unblock_sharer(p_user_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.share_block where user_id = public._vault_require_user() and blocked_user_id = p_user_id;
  return jsonb_build_object('user_id', p_user_id, 'unblocked', found);
end;
$$;

-- Report a share to Wilma's administrators (Q11): only the share and a short reason are kept.
create function report_share(p_share_id uuid, p_reason text default '') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_email text := (select lower(email) from public.app_user where id = v_uid);
  v_kind  text;
  v_by    uuid;
begin
  select 'space', sh.shared_by_user_id into v_kind, v_by from public.space_share sh
  where sh.id = p_share_id and (sh.shared_with_user_id = v_uid or (sh.shared_with_user_id is null and sh.shared_with_email = v_email));
  if v_kind is null then
    select 'note', sh.shared_by_user_id into v_kind, v_by from public.item_share sh
    where sh.id = p_share_id and (sh.shared_with_user_id = v_uid or (sh.shared_with_user_id is null and sh.shared_with_email = v_email));
  end if;
  if v_kind is null then raise exception 'share not found' using errcode = 'P0002'; end if;
  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'Please keep the reason under 500 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.share_report where reporter_user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent 20 reports today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.share_report (reporter_user_id, reported_user_id, share_kind, share_id, reason)
  values (v_uid, v_by, v_kind, p_share_id, btrim(coalesce(p_reason, '')));
  return jsonb_build_object('share_id', p_share_id, 'reported', true);
end;
$$;

-- For Wilma's administrators: the reports, newest first.
create function admin_share_reports(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'share_kind', r.share_kind,
             'share_id', r.share_id, 'reason', r.reason, 'reporter', public._person(r.reporter_user_id),
             'reported', public._person(r.reported_user_id)) order by r.created_at desc)
    from (select * from public.share_report order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) r),
    '[]'::jsonb);
end;
$$;

-- =========================================================
-- Ending shares that may no longer be (rule 3, Q9)
-- =========================================================

-- A space restricted, or moved under a restricted space, Memories or Tasks: every share of it, of
-- the spaces below it and of notes in them ends.
create function space_share_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public._space_shareable(new.id) then
    return null;
  end if;
  with recursive below (id) as (
    select new.id
    union all
    select s.id from public.space s join below b on s.parent_id = b.id
  ) cycle id set looped using path
  , ended_spaces as (
    update public.space_share sh set revoked_at = now(), ended_reason = 'restricted'
    where sh.revoked_at is null and sh.space_id in (select id from below)
    returning 1
  )
  update public.item_share sh set revoked_at = now(), ended_reason = 'restricted'
  where sh.revoked_at is null
    and sh.item_id in (select i.id from public.item i where i.space_id in (select id from below));
  return null;
end;
$$;
create trigger space_share_guard
  after update of is_restricted, parent_id on space
  for each row
  when (new.is_restricted is distinct from old.is_restricted or new.parent_id is distinct from old.parent_id)
  execute function space_share_guard();

-- A shared note moved into a space that can't be shared: its shares end.
create function item_share_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public._space_shareable(new.space_id) then
    update public.item_share set revoked_at = now(), ended_reason = 'restricted'
    where item_id = new.id and revoked_at is null;
  end if;
  return null;
end;
$$;
create trigger item_share_guard
  after update of space_id on item
  for each row
  when (new.space_id is distinct from old.space_id)
  execute function item_share_guard();

revoke execute on function space_share_guard(), item_share_guard() from public, anon, authenticated;
revoke execute on function item_before_insert() from public, anon, authenticated;

-- A Home note written by someone else in a shared space never changes the owner's homes (D36).
create or replace function item_home_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and auth.uid() is distinct from (select owner_user_id from public.space where id = new.space_id) then
    return null;
  end if;
  perform public._home_from_note(new);
  return null;
end;
$$;

-- =========================================================
-- Notes: the owner as before, plus whoever a share allows (Q4, Q5, Q7)
-- =========================================================

-- Save a note into your own space, or into a space shared with you to edit. A note added to a
-- shared space belongs to the space's owner; created_by records who added it. Tags are the
-- owner's own: someone else's save sets none.
create or replace function save_item(
  p_space_id  uuid,
  p_item_type text,
  p_title     text,
  p_body      text default '',
  p_summary   text default null,
  p_metadata  jsonb default '{}'::jsonb,
  p_tags      text[] default '{}',
  p_chunks    jsonb default '[]'::jsonb,
  p_source    text default 'typed'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_owner boolean;
  v_id    uuid;
begin
  v_owner := v_uid is not null and exists (select 1 from public.space where id = p_space_id and owner_user_id = v_uid);
  if not v_owner and not exists (select 1 from public._shared_spaces(v_uid) ss where ss.space_id = p_space_id and ss.permission = 'edit') then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
  if not v_owner and lower(btrim(p_item_type)) = 'routine' then
    raise exception 'Routines can''t be added to a shared space.' using errcode = 'P0001';
  end if;
  insert into public.item (space_id, item_type, title, body_markdown, summary, metadata, source, created_by)
  values (p_space_id, lower(btrim(p_item_type)), p_title, coalesce(p_body, ''), p_summary,
          coalesce(p_metadata, '{}'::jsonb), coalesce(p_source, 'typed'), v_uid)
  returning id into v_id;
  if v_owner then
    perform public._set_item_tags(v_id, p_tags);
  end if;
  perform public._replace_item_chunks(v_id, p_chunks);
  return v_id;
end;
$$;

-- Change a note: yours (as before), or one a share lets you edit. Someone else's edit can't move the
-- note to another space and doesn't change its tags (they are the owner's).
create or replace function update_item(
  p_item_id     uuid,
  p_title       text default null,
  p_body        text default null,
  p_summary     text default null,
  p_metadata    jsonb default null,
  p_item_type   text default null,
  p_space_id    uuid default null,
  p_tags        text[] default null,
  p_change_note text default null,
  p_chunks      jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_access text := public._item_access(auth.uid(), p_item_id);
  v_space  uuid;
begin
  if v_access is null or v_access = 'view'
     or exists (select 1 from public.item where id = p_item_id and deleted_at is not null) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  select space_id into v_space from public.item where id = p_item_id;
  if p_space_id is not null and p_space_id is distinct from v_space then
    if v_access <> 'owner' then
      raise exception 'Only the owner can move this note.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.space where id = p_space_id and owner_user_id = v_uid) then
      raise exception 'space not found' using errcode = 'P0002';
    end if;
  end if;
  if v_access <> 'owner' and lower(btrim(p_item_type)) = 'routine' then
    raise exception 'Routines can''t be added to a shared space.' using errcode = 'P0001';
  end if;
  if p_chunks is null and (p_title is not null or p_body is not null or p_summary is not null) then
    raise exception 'text changed but no chunks were supplied' using errcode = '22023';
  end if;
  perform set_config('app.change_note', coalesce(p_change_note, ''), true);
  update public.item set
    title         = coalesce(p_title, title),
    body_markdown = coalesce(p_body, body_markdown),
    summary       = coalesce(p_summary, summary),
    metadata      = coalesce(p_metadata, metadata),
    item_type     = coalesce(lower(btrim(p_item_type)), item_type),
    space_id      = case when v_access = 'owner' then coalesce(p_space_id, space_id) else space_id end
  where id = p_item_id;
  if p_tags is not null and v_access = 'owner' then
    perform public._set_item_tags(p_item_id, p_tags);
  end if;
  if p_chunks is not null then
    perform public._replace_item_chunks(p_item_id, p_chunks);
  end if;
  perform set_config('app.change_note', '', true);
end;
$$;

-- Move a note to the recycle bin: yours (as before, routines with their tasks), or one a share lets
-- you edit, into its owner's bin (Q4). Restoring and purging stay the owner's.
create or replace function delete_item(p_item_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := public._vault_require_user();
  v_at     timestamptz := now();
  v_title  text;
  v_type   text;
  v_tasks  int := 0;
begin
  if public._item_access(v_uid, p_item_id) = 'edit' then
    update public.item i set deleted_at = v_at, updated_by = v_uid
    where i.id = p_item_id and i.deleted_at is null and i.item_type <> 'routine'
    returning i.title into v_title;
    if not found then
      raise exception 'item not found (or already in the recycle bin)' using errcode = 'P0002';
    end if;
    return jsonb_build_object('item_id', p_item_id, 'title', v_title, 'in_recycle_bin', true);
  end if;

  update public.item i set deleted_at = v_at, updated_by = v_uid
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

-- The recycle bin says who moved a note there when it wasn't you.
create or replace function list_deleted_items(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'deleted_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', i.id, 'title', i.title, 'item_type', i.item_type,
      'space_id', i.space_id, 'deleted_at', i.deleted_at,
      'deleted_by', case when i.updated_by is distinct from sp.owner_user_id then public._person(i.updated_by) end,
      'attachments', (select count(*) from public.attachment a where a.item_id = i.id)) as x
    from public.item i
    join public.space sp on sp.id = i.space_id and sp.owner_user_id = public._vault_require_user()
    where i.deleted_at is not null
      and i.space_id in (select public.searchable_space_ids())
    order by i.deleted_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) t;
$$;

-- One note: yours (as before), or one shared with you. "access" is owner, edit or view; "shared"
-- says who shared it with you; "added_by" / "changed_by" name someone other than the owner.
create or replace function get_item(p_item_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_access    text := public._item_access(auth.uid(), p_item_id);
  v_owner     uuid;
  v_via_space uuid;  -- the space share that reaches this note, if any (else a note share)
begin
  if v_access is null then return null; end if;
  select s.owner_user_id into v_owner from public.item i join public.space s on s.id = i.space_id where i.id = p_item_id;
  if v_access <> 'owner' then
    select ss.share_id into v_via_space
    from public.item i join public._shared_spaces(auth.uid()) ss on ss.space_id = i.space_id where i.id = p_item_id;
  end if;
  return (
    select jsonb_build_object(
      'id', i.id,
      'title', i.title,
      'item_type', i.item_type,
      'summary', i.summary,
      'body_markdown', i.body_markdown,
      'metadata', i.metadata,
      'source', i.source,
      'created_at', i.created_at,
      'updated_at', i.updated_at,
      'access', v_access,
      'space', case when v_access = 'owner' or v_via_space is not null
                    then jsonb_build_object('id', s.id, 'name', s.name, 'is_restricted', s.is_restricted) end,
      'shared', case when v_access <> 'owner'
                     then jsonb_build_object('from', public._person(v_owner), 'permission', v_access,
                                             'via', case when v_via_space is not null then 'space' else 'note' end) end,
      'added_by', case when i.created_by is distinct from v_owner then public._person(i.created_by) end,
      'changed_by', case when i.updated_by is distinct from v_owner then public._person(i.updated_by) end,
      'tags', coalesce((
        select jsonb_agg(t.name order by t.name)
        from public.item_tag it join public.tag t on t.id = it.tag_id where it.item_id = i.id), '[]'::jsonb),
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'filename', a.original_filename, 'mime_type', a.mime_type,
          'size_bytes', a.size_bytes, 'caption', a.caption, 'description', a.extracted_description,
          'extracted_text', left(a.extracted_text, 4000),
          'extracted_text_truncated', coalesce(length(a.extracted_text) > 4000, false),
          'created_at', a.created_at) order by a.created_at)
        from public.attachment a where a.item_id = i.id), '[]'::jsonb),
      -- Links are the owner's way of organising notes: only the owner sees them.
      'links', case when v_access <> 'owner' then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'direction', l.direction, 'relation', l.relation,
          'item_id', o.id, 'title', o.title, 'item_type', o.item_type) order by o.title)
        from (
          select 'outgoing' as direction, relation, to_item_id as other_id
          from public.item_link where from_item_id = i.id
          union all
          select 'incoming', relation, from_item_id
          from public.item_link where to_item_id = i.id
        ) l
        join public.item o on o.id = l.other_id and o.deleted_at is null
        where o.space_id in (select public.searchable_space_ids())), '[]'::jsonb) end,
      'revision_count', (select count(*) from public.item_revision r where r.item_id = i.id)
    )
    from public.item i join public.space s on s.id = i.space_id
    where i.id = p_item_id and i.deleted_at is null);
end;
$$;

-- One file's details (and its storage key, for the signed link): yours, or on a note shared with you.
create or replace function get_attachment(p_attachment_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'filename', a.original_filename, 'mime_type', a.mime_type,
    'size_bytes', a.size_bytes, 'caption', a.caption, 'description', a.extracted_description,
    'storage_key', a.storage_key, 'created_at', a.created_at,
    'item', jsonb_build_object('id', i.id, 'title', i.title))
  from public.attachment a
  join public.item i on i.id = a.item_id and i.deleted_at is null
  where a.id = p_attachment_id and public._item_access(auth.uid(), a.item_id) is not null;
$$;

-- Search: your own non-restricted spaces as before, plus what is shared with you (Q7), each result
-- saying whose it is ("access", "shared_from"). Restricted spaces stay out entirely (rule 3): your
-- own through searchable_space_ids(), and shared ones can never be restricted (_shared_spaces).
drop function search_items(text, text, text[], uuid, text, int, double precision);

create function search_items(
  p_query           text default null,
  p_query_embedding text default null,
  p_tags            text[] default null,
  p_space_id        uuid default null,
  p_item_type       text default null,
  p_limit           int default 10,
  p_max_distance    double precision default null
) returns table (
  item_id     uuid,
  title       text,
  item_type   text,
  space_id    uuid,
  snippet     text,
  tags        text[],
  score       double precision,
  updated_at  timestamptz,
  place       jsonb,
  access      text,
  shared_from jsonb
)
-- Runs as its owner, so names resolve only in pg_catalog and extensions (the vector type and its
-- <=> operator); every table and function of ours is named with public.
language sql stable security definer set search_path = extensions, pg_temp as $$
  with recursive
  scope as (
    select id from public.space where id = p_space_id
    union all
    select s.id from public.space s join scope sc on s.parent_id = sc.id
  ),
  tag_names as (
    select distinct lower(btrim(t)) as name
    from unnest(coalesce(p_tags, '{}')) t
    where btrim(t) <> ''
  ),
  shared_spaces as (
    select ss.space_id, ss.permission, ss.shared_by from public._shared_spaces(auth.uid()) ss
  ),
  shared_notes as (
    select sh.item_id, case when bool_or(sh.permission = 'edit') then 'edit' else 'view' end as permission,
           sh.shared_by_user_id as shared_by
    from public.item_share sh
    join public.item i on i.id = sh.item_id
    join public.space s on s.id = i.space_id and s.owner_user_id = sh.shared_by_user_id
    where auth.uid() is not null and sh.shared_with_user_id = auth.uid()
      and public._share_live(sh.status, sh.revoked_at, sh.expires_at)
      and i.item_type <> 'routine'
      and public._space_shareable(i.space_id)
      and not exists (select 1 from public.share_block b where b.user_id = auth.uid() and b.blocked_user_id = sh.shared_by_user_id)
    group by sh.item_id, sh.shared_by_user_id
  ),
  reachable as (
    select i.id, 'owner'::text as access, null::uuid as shared_by
    from public.item i where i.space_id in (select public.searchable_space_ids())
    union all
    select i.id, ss.permission, ss.shared_by
    from public.item i join shared_spaces ss on ss.space_id = i.space_id
    where i.item_type <> 'routine'
    union all
    select sn.item_id, sn.permission, sn.shared_by from shared_notes sn
  ),
  best as (
    select distinct on (id) id, access, shared_by from reachable
    order by id, case access when 'owner' then 0 when 'edit' then 1 else 2 end
  ),
  candidates as (
    select i.*, b.access, b.shared_by from public.item i join best b on b.id = i.id
    where i.deleted_at is null
      and (p_space_id is null or i.space_id in (select id from scope))
      and (p_item_type is null or i.item_type = lower(btrim(p_item_type)))
      and not exists (
        select 1 from tag_names tn
        where not exists (
          select 1 from public.item_tag it join public.tag t on t.id = it.tag_id
          where it.item_id = i.id and t.name = tn.name))
  ),
  q as (
    select case when p_query_embedding is null then null
                else p_query_embedding::extensions.vector(384) end as emb,
           case when nullif(btrim(p_query), '') is null then null
                else websearch_to_tsquery('english', p_query) end as tsq
  ),
  chunk_hits as (
    select c.item_id, c.content, c.embedding <=> q.emb as dist
    from public.item_chunk c join candidates ca on ca.id = c.item_id, q
    where q.emb is not null and c.embedding is not null
      -- Optional cutoff: leave out chunks whose meaning is not close enough.
      and (p_max_distance is null or (c.embedding <=> q.emb) <= p_max_distance)
  ),
  semantic as (
    select item_id,
           min(dist) as dist,
           (array_agg(content order by dist))[1] as best_chunk,
           row_number() over (order by min(dist)) as rnk
    from chunk_hits
    group by item_id
    order by min(dist)
    limit 50
  ),
  -- Attachment text per item: file names (with . _ - read as spaces), captions,
  -- Claude's descriptions and Visio text.
  attachment_text as (
    select a.item_id,
           string_agg(concat_ws(' ', a.original_filename,
                                regexp_replace(a.original_filename, '[._-]+', ' ', 'g'),
                                a.caption, a.extracted_description, a.extracted_text), ' ') as txt
    from public.attachment a join candidates ca on ca.id = a.item_id
    group by a.item_id
  ),
  keyword_docs as (
    select ca.id as item_id,
           to_tsvector('english', ca.title || ' ' || ca.body_markdown || ' ' || coalesce(att.txt, ''))
           -- Places: every text value in the metadata (address, kind, cuisine, dishes, visits).
           || case when ca.item_type = 'place'
                   then jsonb_to_tsvector('english', ca.metadata, '["string"]')
                   else ''::tsvector end as tsv
    from candidates ca left join attachment_text att on att.item_id = ca.id
  ),
  keyword as (
    select d.item_id,
           row_number() over (order by ts_rank_cd(d.tsv, q.tsq) desc) as rnk
    from keyword_docs d, q
    where q.tsq is not null and d.tsv @@ q.tsq
    order by rnk
    limit 50
  ),
  fused as (
    select coalesce(s.item_id, k.item_id) as item_id,
           coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as score,
           s.best_chunk
    from semantic s full outer join keyword k on k.item_id = s.item_id
  ),
  ranked as (
    -- With a query: fused ranking. Without one: most recently updated first.
    select f.item_id, f.score::double precision as score, f.best_chunk
    from fused f
    where p_query is not null or p_query_embedding is not null
    union all
    select ca.id, 0::double precision, null
    from candidates ca
    where p_query is null and p_query_embedding is null
  )
  select ca.id, ca.title, ca.item_type, ca.space_id,
         left(coalesce(r.best_chunk, ca.summary, ca.body_markdown), 300) as snippet,
         coalesce((select array_agg(t.name order by t.name)
                   from public.item_tag it join public.tag t on t.id = it.tag_id
                   where it.item_id = ca.id), '{}') as tags,
         r.score,
         ca.updated_at,
         -- Places: their fields; null for every other item.
         case when ca.item_type = 'place' then ca.metadata end as place,
         ca.access,
         case when ca.access <> 'owner' then public._person(ca.shared_by) end as shared_from
  from ranked r join candidates ca on ca.id = r.item_id
  order by r.score desc, ca.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- =========================================================
-- Grants (Supabase grants new functions to anon by default)
-- =========================================================

revoke execute on function
  share_space(uuid, text, text, timestamptz), share_item(uuid, text, text, timestamptz),
  my_shares(uuid, uuid), shared_with_me(), respond_to_share(uuid, text),
  change_share(uuid, text, timestamptz, boolean), stop_share(uuid), my_blocks(), unblock_sharer(uuid),
  report_share(uuid, text), admin_share_reports(int),
  save_item(uuid, text, text, text, text, jsonb, text[], jsonb, text),
  update_item(uuid, text, text, text, jsonb, text, uuid, text[], text, jsonb),
  delete_item(uuid), list_deleted_items(int), get_item(uuid), get_attachment(uuid),
  search_items(text, text, text[], uuid, text, int, double precision)
  from public, anon;
grant execute on function
  share_space(uuid, text, text, timestamptz), share_item(uuid, text, text, timestamptz),
  my_shares(uuid, uuid), shared_with_me(), respond_to_share(uuid, text),
  change_share(uuid, text, timestamptz, boolean), stop_share(uuid), my_blocks(), unblock_sharer(uuid),
  report_share(uuid, text), admin_share_reports(int),
  save_item(uuid, text, text, text, text, jsonb, text[], jsonb, text),
  update_item(uuid, text, text, text, jsonb, text, uuid, text[], text, jsonb),
  delete_item(uuid), list_deleted_items(int), get_item(uuid), get_attachment(uuid),
  search_items(text, text, text[], uuid, text, int, double precision)
  to authenticated;
