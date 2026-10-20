begin;
-- Recipes and cocktails, step 1 (docs/recipes-plan.md, D43; owner's answers 2026-10-20, Q1 and
-- Q2): two more built-in spaces on every account, Recipes and Cocktails.
--
--   * space.built_in also allows 'recipes' and 'cocktails' (still at most one of each per account,
--     space_built_in_once). space_built_in_guard is unchanged: like Tasks and Memories, they cannot
--     be deleted, renamed, moved or restricted, and nobody but sign-up and a migration marks one.
--   * _ensure_built_in_spaces marks or makes all four, as before: the user's own oldest top-level,
--     not restricted space of that name (any case) is marked rather than duplicated; a restricted
--     one is left alone and never marked, and no second space of that name is made beside it
--     (rule 3: a space the user locked stays locked). Sign-up (handle_new_auth_user) already calls
--     it, so new accounts get them with no change there.
--   * Every existing account gets them now. Safe to run twice.
--
-- Recipes and cocktails are ordinary items in them (item_type 'recipe' and 'cocktail'; no schema
-- change, item_type is free text); search, revisions, the recycle bin and RLS apply as they are.
-- Nothing new is granted: the helper stays revoked from public, anon and authenticated.

alter table space drop constraint space_built_in_check;
alter table space add constraint space_built_in_check
  check (built_in in ('tasks', 'memories', 'recipes', 'cocktails'));

-- Marks or makes the account's built-in spaces. Runs as its owner (sign-up and migrations only).
create or replace function _ensure_built_in_spaces(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_name text;
  v_desc text;
  v_id uuid;
begin
  foreach v_kind in array array['tasks', 'memories', 'recipes', 'cocktails'] loop
    if exists (select 1 from public.space where owner_user_id = p_user and built_in = v_kind) then
      continue;
    end if;
    v_name := case v_kind
      when 'tasks' then 'Tasks' when 'memories' then 'Memories'
      when 'recipes' then 'Recipes' else 'Cocktails' end;
    v_desc := case v_kind
      when 'tasks' then 'Things to do, with due dates'
      when 'memories' then 'What Wilma remembered about you'
      when 'recipes' then 'Meals to cook: full recipes or links'
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
end;
$$;
revoke execute on function _ensure_built_in_spaces(uuid) from public, anon, authenticated;

-- Accounts made before this migration.
select _ensure_built_in_spaces(u.id) from app_user u;
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
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
