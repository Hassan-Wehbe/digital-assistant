-- Favourite spaces for Home (docs/home-cleanup-plan.md step 1, design D38; owner 2026-10-18: "home
-- spaces should be my favourites, there should be a way to do this").
--
--   * space_favourite: up to 6 of a person's spaces, in the order Home shows them. Kept on the
--     server so the choice survives a new phone. It is a preference, not content: nothing here is
--     searched, embedded or shared.
--   * Restricted spaces never become favourites (rule 3: Home never hints at them), nor does a
--     space nested anywhere under a restricted one, nor the built-in Tasks space (the Tasks tile is
--     the way to tasks). Both are checked when the list is saved and again when it is read, so a
--     favourite later restricted or moved under a restricted space simply stops being shown (and
--     the next save leaves it out).
--   * RLS: each person reads only their own rows (rule 5). anon gets nothing. authenticated may
--     only read; the list changes only through set_favourite_spaces, which replaces it whole, so a
--     stray write can never favourite someone else's space or a restricted one.
--   * Deleting a space or the account removes its favourite rows (cascade).

-- =========================================================
-- The table
-- =========================================================

create table space_favourite (
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  space_id    uuid not null references space (id) on delete cascade,
  position    smallint not null constraint space_favourite_position_check check (position between 1 and 6),
  created_at  timestamptz not null default now(),
  primary key (user_id, space_id),
  constraint space_favourite_position_once unique (user_id, position)
);
create index space_favourite_space_idx on space_favourite (space_id);

alter table space_favourite enable row level security;
create policy space_favourite_own on space_favourite for select
  using (user_id = auth.uid());

-- =========================================================
-- Reading and saving the list
-- =========================================================

-- The person's favourites in Home's order, only those that may still be shown: their own, not
-- restricted, not under a restricted space, not Tasks.
create function my_favourite_spaces() returns uuid[]
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(f.space_id order by f.position), '{}')
  from public.space_favourite f
  join public.space s on s.id = f.space_id
  where f.user_id = auth.uid()
    and s.built_in is distinct from 'tasks'
    and f.space_id in (select public.searchable_space_ids());
$$;

-- Replaces the whole list with p_ids, in that order (null or empty clears it). Refuses more than 6,
-- the same space twice, and any space that is not the person's own, searchable and not Tasks,
-- without changing anything. security definer only because authenticated has no write grants on
-- the table; it writes nothing but the signed-in person's own rows.
create function set_favourite_spaces(p_ids uuid[]) returns uuid[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[] := coalesce(p_ids, '{}');
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if array_position(v_ids, null) is not null then
    raise exception 'A favourite needs a space.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 6 then
    raise exception 'You can have at most 6 favourite spaces. Remove one first.' using errcode = 'P0001';
  end if;
  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'A space can be a favourite only once.' using errcode = '22023';
  end if;
  -- One message for every refused space, so it never says whether a space exists, is someone
  -- else's or is restricted.
  if exists (
    select 1 from unnest(v_ids) x
    where x not in (select public.searchable_space_ids())
       or exists (select 1 from public.space s where s.id = x and (s.owner_user_id <> v_user or s.built_in = 'tasks'))
  ) then
    raise exception 'That space cannot be a favourite.' using errcode = 'P0001';
  end if;

  delete from public.space_favourite where user_id = v_user;
  insert into public.space_favourite (user_id, space_id, position)
  select v_user, x, n from unnest(v_ids) with ordinality as t (x, n);

  return public.my_favourite_spaces();
end;
$$;

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on space_favourite from public, anon, authenticated;
grant select on space_favourite to authenticated;               -- RLS: own rows only

revoke execute on function my_favourite_spaces() from public, anon;
grant execute on function my_favourite_spaces() to authenticated;
revoke execute on function set_favourite_spaces(uuid[]) from public, anon;
grant execute on function set_favourite_spaces(uuid[]) to authenticated;
