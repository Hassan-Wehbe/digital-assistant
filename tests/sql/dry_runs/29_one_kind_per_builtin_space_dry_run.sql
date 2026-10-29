begin;
-- One kind per built-in space (docs/places-space-plan.md, step 2b; owner 2026-10-29: "if I am adding
-- a note to Places, I should be adding a place note; same for the built-in spaces", Q3 "turn them into
-- the space's note", and "the big description must remain the same").
--
--   * _one_kind_per_built_in(user): every live plain note (not a task, routine, place, recipe, drink
--     or memory) in one of the account's built-in spaces, or a sub-space of one, becomes that space's
--     kind once: Tasks a task (open), Places a place (kind "other", want to go), Recipes a recipe,
--     Cocktails a drink, Memories a memory. Only item_type and metadata change: the title and the text
--     stay exactly as they are, attachments and links too.
--   * History (rule 7): the note as it was goes to item_revision first, with a change note: by the
--     revision trigger when its fields change, else here (the trigger writes one only when the title,
--     text or fields change, and the type alone is not one of them).
--   * Not changed: a note of another kind (a recipe in Tasks; the old Home note in Memories, D36),
--     a note in the bin, a memory title too long to be one short fact (more than 200 characters, as
--     memory.ts), and, in Cocktails, any note of an account under 21 while the age check is on (D44:
--     a drink is not made from a note nobody checked).
--   * The search index is left as it is: the text did not change.
--   * Every existing account, now. Safe to run twice. From now on save_item / update_item keep it so.

create function _one_kind_per_built_in(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_adult boolean;
  v_row record;
  v_type text;
  v_meta jsonb;
  v_done int := 0;
begin
  v_adult := not public._age_check_on()
    or coalesce((select u.alcohol_from <= current_date from public.app_user u where u.id = p_user), false);
  for v_row in
    with recursive tree (id, kind) as (
      select s.id, s.built_in from public.space s
      where s.owner_user_id = p_user and s.built_in is not null
      union all
      select s.id, t.kind from public.space s join tree t on s.parent_id = t.id
      where s.built_in is null
    ) cycle id set looped using path
    select i.id, i.title, i.body_markdown, i.metadata, i.created_by, i.updated_by, t.kind
    from public.item i join tree t on t.id = i.space_id and not t.looped
    where i.deleted_at is null
      and lower(trim(i.item_type)) not in ('task', 'routine', 'place', 'recipe', 'cocktail', 'memory')
    order by i.created_at, i.id
  loop
    if v_row.kind = 'memories' and length(trim(v_row.title)) not between 3 and 200 then continue; end if;
    if v_row.kind = 'cocktails' and not v_adult then continue; end if;
    v_type := case v_row.kind
      when 'tasks' then 'task' when 'places' then 'place' when 'recipes' then 'recipe'
      when 'cocktails' then 'cocktail' when 'memories' then 'memory' end;
    if v_type is null then continue; end if;
    -- As the server's checks make an empty one (tasks.ts, places.ts, recipes.ts, memory.ts).
    v_meta := case v_type
      when 'task' then '{"status": "open", "priority": "normal"}'::jsonb
      when 'place' then '{"status": "want", "kind": "other"}'::jsonb
      else '{}'::jsonb end;

    perform set_config('app.change_note',
      'Kept as a ' || v_type || ': every note in a built-in space is of its kind (was a plain note).', true);
    if v_row.metadata is not distinct from v_meta then
      insert into public.item_revision (item_id, revision_number, title, body_markdown, metadata, change_note, edited_by)
      values (
        v_row.id,
        coalesce((select max(r.revision_number) from public.item_revision r where r.item_id = v_row.id), 0) + 1,
        v_row.title, v_row.body_markdown, v_row.metadata,
        current_setting('app.change_note', true),
        coalesce(v_row.updated_by, v_row.created_by));
    end if;
    -- Only the type and the fields: the title and the text stay.
    update public.item set item_type = v_type, metadata = v_meta where id = v_row.id;
    perform set_config('app.change_note', '', true);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke execute on function _one_kind_per_built_in(uuid) from public, anon, authenticated;

-- Every account, now.
select public._one_kind_per_built_in(u.id) from public.app_user u;
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
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
