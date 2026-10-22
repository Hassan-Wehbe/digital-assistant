-- Test: the built-in Recipes and Cocktails spaces (20261021120000_recipes_builtin_spaces.sql,
-- docs/recipes-plan.md step 1, Q1 and Q2). Every account has one of each, marked built-in, made at
-- sign-up or by the migration; the user's own top-level, not restricted space of that name is
-- marked rather than duplicated; a restricted one is left alone with nothing made beside it (rule
-- 3); nobody can delete, rename, move or restrict them; recipes and cocktails inside are ordinary
-- notes (revisions, recycle bin); each user sees only their own; the helper is not callable.

-- ---- Made for every new account ----
select pg_temp.check('a new account gets a built-in Recipes space',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'recipes'
     and name = 'Recipes' and description = 'Meals to cook: full recipes or links' and parent_id is null and not is_restricted));
-- Named Cocktails while the age check is off (20261025120000_age_check_off.sql; Mocktails until the
-- age is given when it is on, test 24).
select pg_temp.check('and a built-in Cocktails space',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in = 'cocktails'
     and name = 'Cocktails' and description = 'Drinks to make: full recipes or links' and parent_id is null and not is_restricted));
select pg_temp.check('with Tasks and Memories still there: four built-in spaces per account',
  (select count(*) = 4 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a' and built_in is not null)
  and (select count(*) = 4 from space where owner_user_id = '00000000-0000-4000-a000-00000000000b' and built_in is not null));

-- ---- The migration's backfill, for accounts made before it (run as the owner) ----
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000c', 'test-user-c@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000d', 'test-user-d@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000e', 'test-user-e@example.invalid', 'authenticated', 'authenticated');
-- As before the migration: no Recipes or Cocktails spaces of Wilma's.
update space set built_in = null
where owner_user_id in ('00000000-0000-4000-a000-00000000000c', '00000000-0000-4000-a000-00000000000d',
                        '00000000-0000-4000-a000-00000000000e')
  and built_in in ('recipes', 'cocktails');
delete from space
where owner_user_id in ('00000000-0000-4000-a000-00000000000c', '00000000-0000-4000-a000-00000000000d',
                        '00000000-0000-4000-a000-00000000000e')
  and name in ('Recipes', 'Cocktails');
-- C: their own top-level "recipes" (with a note in it), and two cocktail spaces, "COCKTAILS" made
-- before "Cocktails".
insert into space (owner_user_id, parent_id, name, description, is_restricted, created_at) values
  ('00000000-0000-4000-a000-00000000000c', null, 'recipes', 'mine', false, now() - interval '2 days'),
  ('00000000-0000-4000-a000-00000000000c', null, 'COCKTAILS', 'older', false, now() - interval '2 days'),
  ('00000000-0000-4000-a000-00000000000c', null, 'Cocktails', 'newer', false, now() - interval '1 day');
insert into item (space_id, item_type, title)
values ((select id from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'recipes'),
        'recipe', 'Lentil soup');
-- D: a restricted "Recipes" and a restricted "cocktails".
insert into space (owner_user_id, parent_id, name, is_restricted) values
  ('00000000-0000-4000-a000-00000000000d', null, 'Recipes', true),
  ('00000000-0000-4000-a000-00000000000d', null, 'cocktails', true);
-- E: "Recipes" only inside another space.
insert into space (owner_user_id, parent_id, name) values ('00000000-0000-4000-a000-00000000000e', null, 'Kitchen');
insert into space (owner_user_id, parent_id, name)
values ('00000000-0000-4000-a000-00000000000e',
        (select id from space where owner_user_id = '00000000-0000-4000-a000-00000000000e' and name = 'Kitchen'), 'Recipes');

select _ensure_built_in_spaces(u.id) from app_user u;
select _ensure_built_in_spaces(u.id) from app_user u;  -- twice: nothing more

select pg_temp.check('the user''s own top-level "recipes" is marked, not duplicated, its name and notes kept',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'recipes')
  and (select built_in = 'recipes' and name = 'recipes' and description = 'mine' from space
       where owner_user_id = '00000000-0000-4000-a000-00000000000c' and lower(name) = 'recipes')
  and (select count(*) = 1 from item i join space s on s.id = i.space_id
       where s.built_in = 'recipes' and s.owner_user_id = '00000000-0000-4000-a000-00000000000c' and i.title = 'Lentil soup'));
select pg_temp.check('of two cocktail spaces, the oldest is marked and the other stays the user''s',
  (select built_in = 'cocktails' from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'COCKTAILS')
  and (select built_in is null from space where owner_user_id = '00000000-0000-4000-a000-00000000000c' and name = 'Cocktails'));
select pg_temp.check('a restricted "Recipes" is left alone: still restricted, never marked',
  (select is_restricted and built_in is null from space
   where owner_user_id = '00000000-0000-4000-a000-00000000000d' and name = 'Recipes')
  and not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in = 'recipes'));
select pg_temp.check('a restricted "cocktails" is left alone, and no "Cocktails" is made beside it',
  (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and lower(name) = 'cocktails')
  and not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in = 'cocktails'));
select pg_temp.check('the restricted account still gets Tasks and Memories',
  (select count(*) = 2 from space where owner_user_id = '00000000-0000-4000-a000-00000000000d' and built_in in ('tasks', 'memories')));
select pg_temp.check('a "Recipes" inside another space is not adopted; a top-level one is made',
  (select built_in is null from space where owner_user_id = '00000000-0000-4000-a000-00000000000e' and name = 'Recipes' and parent_id is not null)
  and (select count(*) = 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000e' and built_in = 'recipes'
       and name = 'Recipes' and parent_id is null));
select pg_temp.check('run twice, still one of each per account',
  (select bool_and(n = 1) from (select count(*) n from space where built_in is not null group by owner_user_id, built_in) x));
do $$
begin
  update space set built_in = 'desserts' where owner_user_id = '00000000-0000-4000-a000-00000000000e' and name = 'Kitchen';
  perform pg_temp.check('no other kind of built-in space exists', false, 'marked');
exception when check_violation then
  perform pg_temp.check('no other kind of built-in space exists', true, sqlerrm);
end $$;

-- ---- Nobody else may run the helper ----
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
do $$
begin
  perform _ensure_built_in_spaces('00000000-0000-4000-a000-00000000000a');
  perform pg_temp.check('a user cannot run _ensure_built_in_spaces', false, 'ran');
exception when insufficient_privilege then
  perform pg_temp.check('a user cannot run _ensure_built_in_spaces', true, sqlerrm);
end $$;
reset role;
set local role anon;
do $$
begin
  perform _ensure_built_in_spaces('00000000-0000-4000-a000-00000000000a');
  perform pg_temp.check('anon cannot run it either', false, 'ran');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot run it either', true, sqlerrm);
end $$;
reset role;

-- ---- As user A ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('A sees only their own Recipes and Cocktails',
  (select count(*) = 2 and bool_and(owner_user_id = '00000000-0000-4000-a000-00000000000a')
   from space where built_in in ('recipes', 'cocktails')));

create temp table _ids as
select (select id from space where built_in = 'recipes') recipes,
       (select id from space where built_in = 'cocktails') cocktails;
insert into space (owner_user_id, parent_id, name) values ('00000000-0000-4000-a000-00000000000a', null, 'Kitchen');

do $$
begin
  perform delete_space((select recipes from _ids));
  perform pg_temp.check('Recipes cannot be deleted', false, 'deleted');
exception when others then
  perform pg_temp.check('Recipes cannot be deleted', sqlerrm = '"Recipes" is a built-in space, so it can''t be deleted.', sqlerrm);
end $$;
do $$
begin
  delete from space where id = (select cocktails from _ids);
  perform pg_temp.check('Cocktails cannot be deleted', false, 'deleted');
exception when others then
  perform pg_temp.check('Cocktails cannot be deleted', sqlerrm like '%built-in space%', sqlerrm);
end $$;
do $$
begin
  update space set name = 'Cocktail recipes' where id = (select cocktails from _ids);
  perform pg_temp.check('it cannot be renamed', false, 'renamed');
exception when others then
  perform pg_temp.check('it cannot be renamed', sqlerrm like '%can''t be renamed%', sqlerrm);
end $$;
do $$
begin
  update space set parent_id = (select id from space where name = 'Kitchen') where id = (select recipes from _ids);
  perform pg_temp.check('it cannot be moved', false, 'moved');
exception when others then
  perform pg_temp.check('it cannot be moved', sqlerrm like '%can''t be moved%', sqlerrm);
end $$;
do $$
begin
  update space set is_restricted = true where id = (select recipes from _ids);
  perform pg_temp.check('it cannot be restricted', false, 'restricted');
exception when others then
  perform pg_temp.check('it cannot be restricted', sqlerrm like '%can''t be restricted%', sqlerrm);
end $$;
do $$
begin
  update space set built_in = 'cocktails' where name = 'Kitchen';
  perform pg_temp.check('a person cannot mark their own space Cocktails', false, 'marked');
exception when others then
  perform pg_temp.check('a person cannot mark their own space Cocktails', sqlerrm like '%Only Wilma%', sqlerrm);
end $$;
do $$
begin
  insert into space (owner_user_id, parent_id, name, built_in) values ('00000000-0000-4000-a000-00000000000a', null, 'Food', 'recipes');
  perform pg_temp.check('a person cannot make a built-in Recipes space', false, 'made');
exception when others then
  perform pg_temp.check('a person cannot make a built-in Recipes space', sqlerrm like '%Only Wilma%', sqlerrm);
end $$;

update space set description = 'Weeknight dinners' where id = (select recipes from _ids);
select pg_temp.check('its description can change',
  (select description = 'Weeknight dinners' from space where id = (select recipes from _ids)));

-- ---- Recipes and cocktails inside are ordinary notes ----
select pg_temp.check('a recipe saves into Recipes',
  (select save_item(p_space_id => (select recipes from _ids), p_item_type => 'recipe',
     p_title => 'Creamy garlic pasta', p_metadata => '{"source_url":"https://www.tiktok.com/@cook/video/1"}'::jsonb) is not null));
select pg_temp.check('a cocktail saves into Cocktails',
  (select save_item(p_space_id => (select cocktails from _ids), p_item_type => 'cocktail',
     p_title => 'Negroni') is not null));
update item set title = 'Garlic pasta' where item_type = 'recipe';
select pg_temp.check('a changed recipe keeps the old version in item_revision',
  (select count(*) = 1 from item_revision r join item i on i.id = r.item_id
   where i.item_type = 'recipe' and r.title = 'Creamy garlic pasta'));
select pg_temp.check('a recipe goes to the recycle bin like any note',
  (select (delete_item((select id from item where item_type = 'recipe')) ->> 'in_recycle_bin')::boolean));

-- ---- As user B ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
select pg_temp.check('B sees none of A''s Recipes or Cocktails, nor their notes',
  not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a')
  and not exists (select 1 from item where title in ('Garlic pasta', 'Negroni')));
do $$
begin
  perform save_item(p_space_id => (select recipes from _ids), p_item_type => 'recipe', p_title => 'Planted');
  perform pg_temp.check('B cannot save into A''s Recipes', false, 'saved');
exception when others then
  perform pg_temp.check('B cannot save into A''s Recipes', true, sqlerrm);
end $$;
reset role;

-- ---- Deleting the account still removes everything ----
delete from auth.users where id = '00000000-0000-4000-a000-00000000000a';
select pg_temp.check('deleting an account removes its Recipes and Cocktails too',
  not exists (select 1 from space where owner_user_id = '00000000-0000-4000-a000-00000000000a'));
