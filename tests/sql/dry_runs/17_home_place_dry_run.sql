-- DRY RUN of 20261013120000_home_place.sql with SQL test 17 (tests/sql/dry_run.sh). Paste ALL of it
-- into the Supabase SQL editor and run it. It ends with the error "DRY RUN RESULTS (rolled back): [...]"
-- on purpose: nothing is kept. Every item in that list must say "ok": true. Then apply the migration.
begin;
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
  if jsonb_typeof(p_item.metadata->'lat') <> 'number' or jsonb_typeof(p_item.metadata->'lng') <> 'number' then
    return;
  end if;
  v_lat := (p_item.metadata->>'lat')::double precision;
  v_lng := (p_item.metadata->>'lng')::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
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
-- Test: homes to plan from (20261013120000_home_place.sql, docs/my-places-plan.md step 1).
-- Each person sees and changes only their own homes (rule 5); anon gets nothing; the first home is
-- the default, there is only ever one, set_default_home moves it (only to your own home), deleting
-- it passes it on; at most 10; names checked; today's Home notes are moved and go to the Recycle
-- bin; an older app's Home note keeps the default in step; a note in a restricted space never.

-- ---------- A saves two homes ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into home_place (label, address, lat, lng) values ('  Home ', '12 Oak St, Oviedo', 28.67, -81.21);
insert into home_place (label, lat, lng) values ('Mom''s', 28.55, -81.38);

select pg_temp.check('the first home is the default, the second is not',
  (select bool_and(is_default = (label = 'Home')) and count(*) = 2 from home_place));
select pg_temp.check('names are trimmed and the owner is the signed-in person',
  (select label = 'Home' and user_id = auth.uid() from home_place where is_default));
do $$
begin
  insert into home_place (label, lat, lng, is_default) values ('Lake house', 28.1, -81.5, true);
  perform pg_temp.check('the default cannot be set directly', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the default cannot be set directly', true, sqlerrm);
end $$;
do $$
begin
  update home_place set is_default = true where label = 'Mom''s';
  perform pg_temp.check('the default cannot be changed directly', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the default cannot be changed directly', true, sqlerrm);
end $$;
do $$
begin
  insert into home_place (label, lat, lng) values ('home', 1, 1);
  perform pg_temp.check('one home per name', false, 'insert succeeded');
exception when unique_violation then
  perform pg_temp.check('one home per name', true, sqlerrm);
end $$;
do $$
begin
  insert into home_place (label, lat, lng) values ('   ', 1, 1);
  perform pg_temp.check('a name is required', false, 'insert succeeded');
exception when check_violation then
  perform pg_temp.check('a name is required', true, sqlerrm);
end $$;
do $$
begin
  insert into home_place (label, lat, lng) values ('Moon base', 91, 0);
  perform pg_temp.check('a real point only', false, 'insert succeeded');
exception when check_violation then
  perform pg_temp.check('a real point only', true, sqlerrm);
end $$;

select pg_temp.check('set_default_home moves the default to Mom''s',
  (select set_default_home((select id from home_place where label = 'Mom''s'))->>'label' = 'Mom''s'));
select pg_temp.check('still exactly one default, now Mom''s',
  (select count(*) = 1 and bool_and(label = 'Mom''s') from home_place where is_default));
update home_place set address = '4 Elm Rd' where label = 'Mom''s';
select pg_temp.check('a home''s address can be changed',
  (select address = '4 Elm Rd' from home_place where label = 'Mom''s'));

-- ---------- B: sees nothing of A's, cannot touch it ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('B sees none of A''s homes (RLS)', (select count(*) = 0 from home_place));
update home_place set lat = 0 where true;
delete from home_place where true;
do $$
begin
  perform set_default_home((select id from home_place where false));
  perform pg_temp.check('B cannot move a default that is not theirs', false, 'call succeeded');
exception when others then
  perform pg_temp.check('B cannot move a default that is not theirs', sqlstate = 'P0002', sqlerrm);
end $$;
do $$
declare v_a uuid;
begin
  reset role;
  select id into v_a from home_place where label = 'Home' and user_id = '00000000-0000-4000-a000-00000000000a';
  set local role authenticated;
  perform set_default_home(v_a);
  perform pg_temp.check('B cannot make A''s home a default', false, 'call succeeded');
exception when others then
  perform pg_temp.check('B cannot make A''s home a default', sqlstate = 'P0002', sqlerrm);
end $$;
do $$
begin
  insert into home_place (user_id, label, lat, lng) values ('00000000-0000-4000-a000-00000000000a', 'Planted', 1, 1);
  perform pg_temp.check('B cannot save a home for A', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('B cannot save a home for A', true, sqlerrm);
end $$;
insert into home_place (label, lat, lng) values ('Home', 40.7, -74.0);
select pg_temp.check('B''s own first home is B''s default (one default each, not one in all)',
  (select count(*) = 1 and bool_and(is_default) from home_place));

reset role;
select pg_temp.check('A''s homes untouched by B''s update and delete',
  (select count(*) = 2 and bool_and(lat <> 0) from home_place where user_id = '00000000-0000-4000-a000-00000000000a'));

-- ---------- anon ----------
set local role anon;
do $$
begin
  perform count(*) from home_place;
  perform pg_temp.check('anon cannot read homes', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read homes', true, sqlerrm);
end $$;
do $$
begin
  perform set_default_home(gen_random_uuid());
  perform pg_temp.check('anon cannot call set_default_home', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call set_default_home', true, sqlerrm);
end $$;
reset role;

-- ---------- A: deleting the default passes it on; at most 10 ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

delete from home_place where label = 'Mom''s';
select pg_temp.check('deleting the default makes the oldest home left the default',
  (select count(*) = 1 and bool_and(label = 'Home') from home_place where is_default));
insert into home_place (label, lat, lng) select 'Home ' || g, 1, 1 from generate_series(2, 10) g;
do $$
begin
  insert into home_place (label, lat, lng) values ('Eleventh', 1, 1);
  perform pg_temp.check('at most 10 homes', false, 'insert succeeded');
exception when raise_exception then
  perform pg_temp.check('at most 10 homes', true, sqlerrm);
end $$;
delete from home_place where label like 'Home %';

-- ---------- An older app saves Home as a note: the default follows it ----------
insert into space (name) values ('Places');
insert into space (name, is_restricted) values ('Hidden', true);
select save_item((select id from space where name = 'Places'), 'place', 'Home', '', null,
                 '{"kind":"home","lat":28.70,"lng":-81.20,"address":"9 New Rd"}', '{}', pg_temp.chunks('Home', 1));
select pg_temp.check('an older app''s Home note updates the default home (same name)',
  (select count(*) = 1 and bool_and(lat = 28.70 and address = '9 New Rd') from home_place where is_default));
select save_item((select id from space where name = 'Hidden'), 'place', 'Secret cabin', '', null,
                 '{"kind":"home","lat":10,"lng":10}', '{}', pg_temp.chunks('Secret cabin', 2));
select pg_temp.check('a Home note in a restricted space is never copied (rule 3)',
  (select count(*) = 0 from home_place where label = 'Secret cabin'));
select pg_temp.check('the default is still the searchable Home',
  (select bool_and(label = 'Home' and lat = 28.70) from home_place where is_default));

-- ---------- The move of today's Home notes (the migration's two statements, as Wilma) ----------
reset role;
delete from home_place where user_id = '00000000-0000-4000-a000-00000000000b';
alter table item disable trigger item_home_note;
insert into space (owner_user_id, name) values ('00000000-0000-4000-a000-00000000000b', 'Places');
insert into item (space_id, item_type, title, metadata)
values ((select id from space where owner_user_id = '00000000-0000-4000-a000-00000000000b' and name = 'Places'),
        'place', 'Home', '{"kind":"home","lat":40.71,"lng":-74.01,"address":"1 Main St"}');
alter table item enable trigger item_home_note;

select public._home_from_note(i) from public.item i
where i.item_type = 'place' and i.metadata->>'kind' = 'home' and i.deleted_at is null;
update public.item i set deleted_at = now()
from public.space sp
where sp.id = i.space_id and not sp.is_restricted
  and i.item_type = 'place' and i.metadata->>'kind' = 'home' and i.deleted_at is null
  and exists (select 1 from public.home_place h where h.user_id = sp.owner_user_id);

select pg_temp.check('the move: B''s Home note became B''s default home',
  (select count(*) = 1 and bool_and(is_default and label = 'Home' and lat = 40.71 and address = '1 Main St')
   from home_place where user_id = '00000000-0000-4000-a000-00000000000b'));
select pg_temp.check('the move: the note went to the Recycle bin, with no new revision',
  (select deleted_at is not null from item where title = 'Home' and metadata->>'lat' = '40.71')
  and (select count(*) = 0 from item_revision r join item i on i.id = r.item_id where i.metadata->>'lat' = '40.71'));
select pg_temp.check('the move: a restricted space''s Home note stays where it is',
  (select deleted_at is null from item where title = 'Secret cabin'));
select public._home_from_note(i) from public.item i
where i.item_type = 'place' and i.metadata->>'kind' = 'home' and i.deleted_at is null;
select pg_temp.check('the move: running it again changes nothing',
  (select count(*) = 1 from home_place where user_id = '00000000-0000-4000-a000-00000000000b'));
do $$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end $$;
