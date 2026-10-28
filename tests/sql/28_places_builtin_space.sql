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
