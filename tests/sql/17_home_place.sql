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
