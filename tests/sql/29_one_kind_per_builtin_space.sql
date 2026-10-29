-- Test: one kind per built-in space (20261029120000_one_kind_per_builtin_space.sql, docs/places-space-plan.md
-- step 2b). Plain notes already in Tasks, Places, Recipes (and its sub-spaces), Cocktails and Memories
-- become that kind once, title and text unchanged, one revision each with a change note; notes of
-- another kind, notes in the bin, a too-long memory and an under-21 account's drinks are left alone;
-- only the account's own; twice changes nothing; users can't run it.

create temp table _ids (k text primary key, id uuid);
create function pg_temp.id(p text) returns uuid language sql stable as $$ select id from _ids where k = p $$;
create function pg_temp.sp(p_user uuid, p_kind text) returns uuid language sql stable as $$
  select id from space where owner_user_id = p_user and built_in = p_kind $$;
create function pg_temp.item(p_key text, p_space uuid, p_type text, p_title text, p_body text, p_meta jsonb default '{}')
returns void language sql as $$
  insert into item (space_id, item_type, title, body_markdown, metadata) values (p_space, p_type, p_title, p_body, p_meta);
  insert into _ids select p_key, id from item where space_id = p_space and title = p_title;
$$;

-- ---------- A's notes ----------
insert into space (owner_user_id, name, parent_id)
  values ('00000000-0000-4000-a000-00000000000a', 'Desserts', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'recipes'));
insert into space (owner_user_id, name) values ('00000000-0000-4000-a000-00000000000a', 'Work');
insert into _ids select 'desserts', id from space where name = 'Desserts';
insert into _ids select 'work', id from space where name = 'Work' and owner_user_id = '00000000-0000-4000-a000-00000000000a';

select pg_temp.item('cake', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'recipes'), 'note', 'Lemon cake',
  E'Shared from TikTok, not readable: https://www.tiktok.com/@chef/video/123\n\nThe whole long description as shared, kept word for word.');
select pg_temp.item('tiramisu', pg_temp.id('desserts'), 'how-to', 'Tiramisu', 'Layer it.');
select pg_temp.item('plumber', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'tasks'), 'note', 'Call the plumber', 'Before Friday', '{"x": 1}');
select pg_temp.item('routine', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'tasks'), 'routine', 'Mornings', '', '{"repeat": "daily"}');
select pg_temp.item('stray', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'tasks'), 'recipe', 'Soup in Tasks', '');
select pg_temp.item('fact', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'memories'), 'note', 'Lexi swims on Tuesdays', 'Said in September');
select pg_temp.item('long', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'memories'), 'note', repeat('a long title ', 20), '');
select pg_temp.item('home', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'memories'), 'place', 'Home', '', '{"kind": "home"}');
select pg_temp.item('library', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'places'), 'note', 'The library on Main St', 'Open till 8');
select pg_temp.item('drink', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'cocktails'), 'note', 'Lime cooler', 'lime, soda');
select pg_temp.item('binned', pg_temp.sp('00000000-0000-4000-a000-00000000000a', 'recipes'), 'note', 'Old idea', '');
update item set deleted_at = now() where id = pg_temp.id('binned');
select pg_temp.item('worknote', pg_temp.id('work'), 'note', 'Meeting notes', 'x');
-- B's own plain notes: A's run never touches them.
select pg_temp.item('b_recipe', pg_temp.sp('00000000-0000-4000-a000-00000000000b', 'recipes'), 'note', 'B''s bread', 'flour');
select pg_temp.item('b_drink', pg_temp.sp('00000000-0000-4000-a000-00000000000b', 'cocktails'), 'note', 'B''s punch', 'rum?');

create temp table _before as select id, title, body_markdown, metadata from item;

select pg_temp.check('users can''t run it',
  not has_function_privilege('authenticated', '_one_kind_per_built_in(uuid)', 'execute')
  and not has_function_privilege('anon', '_one_kind_per_built_in(uuid)', 'execute'));

-- (Run in its own statement: a check in the same statement would read the notes as they were.)
create temp table _a_run as select _one_kind_per_built_in('00000000-0000-4000-a000-00000000000a') as n;
select pg_temp.check('A''s run: six plain notes (cake, tiramisu, plumber, fact, library, drink)', (select n = 6 from _a_run));

select pg_temp.check('each became its space''s kind',
  (select item_type from item where id = pg_temp.id('cake')) = 'recipe'
  and (select item_type from item where id = pg_temp.id('tiramisu')) = 'recipe'
  and (select item_type from item where id = pg_temp.id('plumber')) = 'task'
  and (select item_type from item where id = pg_temp.id('fact')) = 'memory'
  and (select item_type from item where id = pg_temp.id('library')) = 'place'
  and (select item_type from item where id = pg_temp.id('drink')) = 'cocktail');
select pg_temp.check('the fields are what the server makes for an empty one',
  (select metadata from item where id = pg_temp.id('plumber')) = '{"status": "open", "priority": "normal"}'
  and (select metadata from item where id = pg_temp.id('library')) = '{"status": "want", "kind": "other"}'
  and (select metadata from item where id = pg_temp.id('cake')) = '{}'
  and (select metadata from item where id = pg_temp.id('fact')) = '{}');
select pg_temp.check('title and text exactly as they were (the long shared description kept)',
  (select bool_and(i.title = b.title and i.body_markdown = b.body_markdown) from item i join _before b using (id)
   where i.id in (pg_temp.id('cake'), pg_temp.id('tiramisu'), pg_temp.id('plumber'), pg_temp.id('fact'), pg_temp.id('library'), pg_temp.id('drink'))));
select pg_temp.check('rule 7: exactly one revision each, the old version with a change note',
  (select count(*) = 6 and bool_and(r.change_note like 'Kept as a %' and r.title = b.title and r.body_markdown = b.body_markdown and r.metadata = b.metadata)
   from item_revision r join _before b on b.id = r.item_id
   where r.item_id in (pg_temp.id('cake'), pg_temp.id('tiramisu'), pg_temp.id('plumber'), pg_temp.id('fact'), pg_temp.id('library'), pg_temp.id('drink'))));
select pg_temp.check('left alone: a routine, a recipe in Tasks, the Home note, a too-long memory, a binned note, a note in Work',
  (select item_type from item where id = pg_temp.id('routine')) = 'routine'
  and (select item_type from item where id = pg_temp.id('stray')) = 'recipe'
  and (select item_type from item where id = pg_temp.id('home')) = 'place'
  and (select item_type from item where id = pg_temp.id('long')) = 'note'
  and (select item_type from item where id = pg_temp.id('binned')) = 'note'
  and (select item_type from item where id = pg_temp.id('worknote')) = 'note'
  and not exists (select 1 from item_revision where item_id in (pg_temp.id('routine'), pg_temp.id('stray'), pg_temp.id('home'), pg_temp.id('long'), pg_temp.id('binned'), pg_temp.id('worknote'))));
select pg_temp.check('nothing of B''s changed', (select bool_and(item_type = 'note') from item where id in (pg_temp.id('b_recipe'), pg_temp.id('b_drink'))));
select pg_temp.check('running it again changes nothing', _one_kind_per_built_in('00000000-0000-4000-a000-00000000000a') = 0);

-- ---------- Under 21 with the age check on (D44): no drink is made from an unchecked note ----------
update signup_setting set age_check = true;
update app_user set alcohol_from = current_date + 365 where id = '00000000-0000-4000-a000-00000000000b';
create temp table _b_run as select public._age_check_on() as on_, _one_kind_per_built_in('00000000-0000-4000-a000-00000000000b') as n;
select pg_temp.check('B (under 21): the recipe note only, not the drink',
  (select on_ and n = 1 from _b_run)
  and (select item_type from item where id = pg_temp.id('b_recipe')) = 'recipe'
  and (select item_type from item where id = pg_temp.id('b_drink')) = 'note');
