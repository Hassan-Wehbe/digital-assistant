begin;
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
-- Shared setup, pasted at the top of every test file (after `begin;`).
-- Creates two throwaway users inside the test transaction. Everything is
-- rolled back at the end of the file, so nothing persists in the project.

create temp table _results (n serial, test text, passed boolean, detail text);
grant insert, select on _results to authenticated, anon;
grant usage on sequence _results_n_seq to authenticated, anon;

create function pg_temp.check(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into _results (test, passed, detail) values (p_test, coalesce(p_ok, false), p_detail);
$$;

-- A 384-dim unit vector with a 1 at position k (as pgvector text).
create function pg_temp.vec(k int) returns text language sql immutable as $$
  select '[' || string_agg(case when g = k then '1' else '0' end, ',' order by g) || ']'
  from generate_series(1, 384) g;
$$;

create function pg_temp.chunks(p_content text, k int) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('content', p_content, 'embedding', pg_temp.vec(k)));
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'test-user-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'test-user-b@example.invalid', 'authenticated', 'authenticated');
-- Test: the built-in Places space (20261028120000_places_builtin_space.sql, docs/places-space-plan.md
-- step 1, D45). Every account has one; it can't be renamed, deleted, moved or restricted; an
-- existing top-level "Places" is adopted, a restricted one is left alone; every live place moves
-- into Places, except from a restricted space (rule 3), Home notes, deleted ones and those already
-- under Places; text and revisions are untouched; a share of a moved place is kept; only the
-- account's own places move; users can't run the move.

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.refused(text) to authenticated, anon;
create temp table _ids (k text primary key, id uuid);
grant select, insert on _ids to authenticated;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select id from _ids where k = p $$;

select pg_temp.check('every account has one Places space, with a description',
  (select count(*) = 1 and bool_and(name = 'Places' and description like 'Spots you go to%' and parent_id is null and not is_restricted)
   from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'places')
  and (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000b' and built_in = 'places'));

-- ---------- A's places, scattered ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
insert into _ids select 'places', id from space where built_in = 'places';
insert into space (name) values ('Restaurants'), ('Work'), ('Private');
insert into _ids select 'restaurants', id from space where name = 'Restaurants';
insert into _ids select 'work', id from space where name = 'Work';
insert into _ids select 'private', id from space where name = 'Private';
update space set is_restricted = true where id = pg_temp.id('private');
insert into space (name, parent_id) values ('Lunch', pg_temp.id('work')), ('Kids', pg_temp.id('places'));
insert into _ids select 'lunch', id from space where name = 'Lunch';
insert into _ids select 'kids', id from space where name = 'Kids';
insert into _ids values
  ('tawlet',  save_item(pg_temp.id('restaurants'), 'place', 'Tawlet', 'Try the fattoush', null, '{"kind":"restaurant"}', '{}', '[]')),
  ('deli',    save_item(pg_temp.id('lunch'), 'place', 'Corner deli', '', null, '{"kind":"cafe"}', '{}', '[]')),
  ('hidden',  save_item(pg_temp.id('private'), 'place', 'Hidden bar', '', null, '{"kind":"bar"}', '{}', '[]')),
  ('pool',    save_item(pg_temp.id('kids'), 'place', 'Kids pool', '', null, '{"kind":"other"}', '{}', '[]')),
  ('gone',    save_item(pg_temp.id('restaurants'), 'place', 'Closed bistro', '', null, '{"kind":"restaurant"}', '{}', '[]')),
  ('note',    save_item(pg_temp.id('restaurants'), 'note', 'Restaurant ideas', '', null, '{}', '{}', '[]'));
select delete_item(pg_temp.id('gone'));
insert into _ids select 'share', (share_item(pg_temp.id('tawlet'), 'test-user-b@example.invalid', 'view') ->> 'share_id')::uuid;
reset role;
-- An old Home note (D36), left where it is: a home is never a place in Places.
insert into item (space_id, item_type, title, metadata) values (pg_temp.id('restaurants'), 'place', 'Home', '{"kind":"home"}');
insert into _ids select 'home', id from item where title = 'Home' and space_id = pg_temp.id('restaurants');
-- B's own place, which A's move never touches.
insert into space (owner_user_id, name) values ('00000000-0000-4000-a000-00000000000b', 'Food');
insert into item (space_id, item_type, title) select id, 'place', 'B''s cafe' from space where name = 'Food';

select pg_temp.check('the move is not for users',
  not has_function_privilege('authenticated', '_move_places_into_places(uuid)', 'execute')
  and not has_function_privilege('authenticated', '_ensure_built_in_spaces(uuid)', 'execute'));

select pg_temp.check('A''s move: the two scattered live places (2)',
  _move_places_into_places('00000000-0000-4000-a000-00000000000a') = 2);
select pg_temp.check('a top-level and a nested space''s places are now in Places',
  (select bool_and(space_id = pg_temp.id('places')) from item where id in (pg_temp.id('tawlet'), pg_temp.id('deli'))));
select pg_temp.check('rule 3: a place in a restricted space stays there',
  (select space_id = pg_temp.id('private') from item where id = pg_temp.id('hidden')));
select pg_temp.check('a place already in a sub-space of Places stays there',
  (select space_id = pg_temp.id('kids') from item where id = pg_temp.id('pool')));
select pg_temp.check('a Home note, a place in the bin and an ordinary note stay where they are',
  (select bool_and(space_id = pg_temp.id('restaurants')) from item where id in (pg_temp.id('home'), pg_temp.id('gone'), pg_temp.id('note'))));
select pg_temp.check('nothing of B''s moved',
  (select bool_and(s.name = 'Food') from item i join space s on s.id = i.space_id where i.title = 'B''s cafe'));
select pg_temp.check('text unchanged and no revision written (only the space changed)',
  (select title = 'Tawlet' and body_markdown = 'Try the fattoush' from item where id = pg_temp.id('tawlet'))
  and not exists (select 1 from item_revision where item_id in (pg_temp.id('tawlet'), pg_temp.id('deli'))));
select pg_temp.check('a share of a moved place is kept (D32)',
  (select revoked_at is null from item_share where id = pg_temp.id('share')));
select pg_temp.check('running it again moves nothing', _move_places_into_places('00000000-0000-4000-a000-00000000000a') = 0);

-- ---------- Guard: a built-in space ----------
select pg_temp.as_user('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
select pg_temp.check('Places can''t be renamed, restricted, moved or deleted',
  pg_temp.refused($q$update space set name = 'Spots' where built_in = 'places'$q$) like '%built-in space%'
  and pg_temp.refused($q$update space set is_restricted = true where built_in = 'places'$q$) like '%built-in space%'
  and pg_temp.refused($q$update space set parent_id = (select id from space where name = 'Work') where built_in = 'places'$q$) like '%built-in space%'
  and pg_temp.refused($q$delete from space where built_in = 'places'$q$) like '%built-in space%');
select pg_temp.check('nobody marks a space Places by hand',
  pg_temp.refused($q$update space set built_in = 'places' where name = 'Work'$q$) like '%Only Wilma%');
update space set description = 'Where we go' where built_in = 'places';
select pg_temp.check('its description can change', (select description = 'Where we go' from space where built_in = 'places'));
reset role;

-- ---------- Adopting an existing "Places"; never a restricted one ----------
-- C made a "places" space before this change (lower case): it becomes the built-in one, nothing beside it.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000c', 'test-user-c@example.invalid', 'authenticated', 'authenticated');
-- (Sign-up made one already: unmark it and remove it, as if C had signed up before the change.)
update space set built_in = null where owner_user_id = '00000000-0000-4000-a000-00000000000c' and built_in = 'places';
delete from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'Places';
insert into space (owner_user_id, name) values ('00000000-0000-4000-a000-00000000000c', 'places');
insert into item (space_id, item_type, title)
  select id, 'note', 'The library on Main St' from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'places';
select _ensure_built_in_spaces('00000000-0000-4000-a000-00000000000c');
select pg_temp.check('an existing top-level "places" is adopted with its notes, no second one made',
  (select count(*) = 1 and bool_and(name = 'places') from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'places')
  and (select built_in = 'places' from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'places')
  and exists (select 1 from item i join space s on s.id = i.space_id where s.built_in = 'places' and i.title = 'The library on Main St'));
-- D locked their "Places": it stays locked and unmarked, and none is made beside it (rule 3).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000d', 'test-user-d@example.invalid', 'authenticated', 'authenticated');
update space set built_in = null where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in = 'places';
update space set is_restricted = true where owner_user_id = '00000000-0000-4000-a000-00000000000d' and name = 'Places';
select _ensure_built_in_spaces('00000000-0000-4000-a000-00000000000d');
select pg_temp.check('a restricted "Places" is left alone and none is made beside it',
  not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in = 'places')
  and (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and lower(name) = 'places'));
select pg_temp.check('... and with no Places space, nothing moves', _move_places_into_places('00000000-0000-4000-a000-00000000000d') = 0);
select pg_temp.check('still one built-in space of each kind per account',
  (select bool_and(n = 1) from (select count(*) n from space where built_in is not null group by owner_user_id, built_in) x));
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
