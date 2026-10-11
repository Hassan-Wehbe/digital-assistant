-- Homes to plan from (docs/my-places-plan.md step 1, design D36; owner 2026-10-10: "agree with
-- the recommendations"). Homes leave notes and spaces for their own table.
--
--   * home_place: a person's homes (at most 10), each a name, an optional address and a point;
--     exactly one is the default (the first one saved; set_default_home moves it; deleting the
--     default passes it to the oldest one left). Never searched, embedded or shared: it is not a
--     note, so restricted spaces and sharing never touch it (rules 3 and 4).
--   * RLS: each person reads and writes only their own rows (rule 5). anon gets nothing.
--     authenticated may insert and change the name, address and point; the default only moves
--     through set_default_home, so a stray update can never leave two defaults or none.
--   * Today's Home notes (place notes of kind "home" in a searchable space, with a point) are
--     copied in as each person's default, then go to the Recycle bin (Q2; soft delete, rule 8,
--     no revision: the note itself does not change).
--   * Older apps keep working (versionCode 19 and before save Home as a note): saving or changing
--     such a note copies its point into the table as the default (_home_from_note). Remove this
--     trigger once versionCode 20 is the oldest app allowed.
--
-- Credential-looking text in a name or address is refused by the app and the chat before it gets
-- here (rule 9); a home's address is not a secret.

-- =========================================================
-- The table
-- =========================================================

create table home_place (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  label       text not null constraint home_place_label_check check (char_length(btrim(label)) between 1 and 60),
  address     text constraint home_place_address_check check (address is null or char_length(address) <= 300),
  lat         double precision not null constraint home_place_lat_check check (lat between -90 and 90),
  lng         double precision not null constraint home_place_lng_check check (lng between -180 and 180),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index home_place_one_default on home_place (user_id) where is_default;
create unique index home_place_label_once on home_place (user_id, lower(btrim(label)));
create index home_place_user_idx on home_place (user_id);

alter table home_place enable row level security;
create policy home_place_own on home_place for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =========================================================
-- Rules kept by the database
-- =========================================================

-- Before a row is written: the name trimmed, at most 10 homes, the first one the default, the
-- owner never changed. security definer only so it can read the person's other rows the same way
-- whoever writes (it changes nothing but the row being written).
create function home_place_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.label := btrim(new.label);
  new.address := nullif(btrim(coalesce(new.address, '')), '');
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A home cannot be given to someone else.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
  end if;
  if (select count(*) from public.home_place h where h.user_id = new.user_id) >= 10 then
    raise exception 'You can save at most 10 homes. Delete one first.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.home_place h where h.user_id = new.user_id and h.is_default) then
    new.is_default := true;
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger home_place_before
  before insert or update on home_place
  for each row execute function home_place_before();

-- After a delete: when the default went, the oldest home left becomes the default.
create function home_place_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_default and not exists (select 1 from public.home_place h where h.user_id = old.user_id and h.is_default) then
    update public.home_place h set is_default = true
    where h.id = (select h2.id from public.home_place h2 where h2.user_id = old.user_id order by h2.created_at, h2.id limit 1);
  end if;
  return old;
end;
$$;

create trigger home_place_after_delete
  after delete on home_place
  for each row execute function home_place_after_delete();

-- =========================================================
-- Moving the default
-- =========================================================

create function set_default_home(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_label text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select h.label into v_label from public.home_place h where h.id = p_id and h.user_id = v_uid;
  if not found then
    raise exception 'home not found' using errcode = 'P0002';
  end if;
  update public.home_place h set is_default = false where h.user_id = v_uid and h.is_default and h.id <> p_id;
  update public.home_place h set is_default = true where h.id = p_id and not h.is_default;
  return jsonb_build_object('id', p_id, 'label', v_label, 'is_default', true);
end;
$$;

-- =========================================================
-- Home notes (today's, and those older apps still save)
-- =========================================================

-- A place note of kind "home" with a point, in a searchable space, becomes (or updates) its
-- owner's default home: the home with the same name if there is one, else the default; a new
-- default when there is none. Notes in a restricted space are never copied (rule 3: the planner
-- never read them either). Never fails the note's own save: a home that cannot be copied (the
-- limit of 10) is skipped.
create function _home_from_note(p_item public.item) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner   uuid;
  v_label   text := coalesce(nullif(left(btrim(p_item.title), 60), ''), 'Home');
  v_address text := nullif(left(btrim(coalesce(p_item.metadata->>'address', '')), 300), '');
  v_lat     double precision;
  v_lng     double precision;
  v_target  uuid;
begin
  if p_item.item_type <> 'place' or p_item.metadata->>'kind' is distinct from 'home' or p_item.deleted_at is not null then
    return;
  end if;
  -- A note without a point (an address only) is not copied: the planner cannot start from it.
  -- "is distinct from", not "<>": a missing lat gives null, which "<>" would let through.
  if jsonb_typeof(p_item.metadata->'lat') is distinct from 'number' or jsonb_typeof(p_item.metadata->'lng') is distinct from 'number' then
    return;
  end if;
  v_lat := (p_item.metadata->>'lat')::double precision;
  v_lng := (p_item.metadata->>'lng')::double precision;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    return;
  end if;
  select sp.owner_user_id into v_owner from public.space sp where sp.id = p_item.space_id and not sp.is_restricted;
  if v_owner is null then
    return;
  end if;

  select h.id into v_target from public.home_place h
  where h.user_id = v_owner and lower(h.label) = lower(v_label);
  if v_target is null then
    select h.id into v_target from public.home_place h where h.user_id = v_owner and h.is_default;
  end if;

  if v_target is null then
    begin
      insert into public.home_place (user_id, label, address, lat, lng) values (v_owner, v_label, v_address, v_lat, v_lng);
    exception when raise_exception or check_violation or unique_violation then
      return;
    end;
    return;
  end if;
  update public.home_place h set label = v_label, address = v_address, lat = v_lat, lng = v_lng where h.id = v_target;
  update public.home_place h set is_default = false where h.user_id = v_owner and h.is_default and h.id <> v_target;
  update public.home_place h set is_default = true where h.id = v_target and not h.is_default;
end;
$$;

create function item_home_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public._home_from_note(new);
  return null;
end;
$$;

-- Older apps (versionCode 19 and before) save Home as a note: keep the table in step with it.
create trigger item_home_note
  after insert or update of title, metadata, space_id, deleted_at on item
  for each row
  when (new.item_type = 'place' and new.metadata->>'kind' = 'home' and new.deleted_at is null)
  execute function item_home_note();

-- Today's Home notes: copied in, then to the Recycle bin (Q2).
select public._home_from_note(i) from public.item i
where i.item_type = 'place' and i.metadata->>'kind' = 'home' and i.deleted_at is null;

update public.item i set deleted_at = now()
from public.space sp
where sp.id = i.space_id and not sp.is_restricted
  and i.item_type = 'place' and i.metadata->>'kind' = 'home' and i.deleted_at is null
  and exists (select 1 from public.home_place h where h.user_id = sp.owner_user_id);

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on home_place from public, anon, authenticated;
grant select, delete on home_place to authenticated;            -- RLS: own rows only
grant insert (label, address, lat, lng) on home_place to authenticated;
grant update (label, address, lat, lng) on home_place to authenticated;

revoke execute on function set_default_home(uuid) from public, anon;
grant execute on function set_default_home(uuid) to authenticated;
revoke execute on function home_place_before(), home_place_after_delete(), _home_from_note(public.item), item_home_note()
  from public, anon, authenticated;
