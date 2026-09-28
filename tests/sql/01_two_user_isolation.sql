-- Test: two users never see or change each other's data (CLAUDE.md rule 5).
-- Runs as the `authenticated` role with a user id in the JWT claims, exactly
-- like a request from the MCP server, so Row Level Security is exercised.

-- ---------- user A creates data ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('A kitchen');
create temp table _a as
select (select id from space where name = 'A kitchen') as space_id,
       save_item((select id from space where name = 'A kitchen'), 'recipe', 'Alpha lasagna',
                 'Layer pasta, ragu and bechamel.', null, '{}', array['weeknight'],
                 pg_temp.chunks('Alpha lasagna: layer pasta, ragu and bechamel.', 1)) as item_id;

-- ---------- user B ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('B kitchen');
select save_item((select id from space where name = 'B kitchen'), 'recipe', 'Beta curry',
                 'Onion, spices, coconut milk.', null, '{}', array['weeknight'],
                 pg_temp.chunks('Beta curry: onion, spices, coconut milk.', 1));

select pg_temp.check('B sees only own spaces',
  (select count(*) = 1 and bool_and(name = 'B kitchen') from space));
select pg_temp.check('B sees only own items',
  (select count(*) = 1 and bool_and(title = 'Beta curry') from item));
select pg_temp.check('B sees only own tags',
  (select count(*) = 1 from tag));
select pg_temp.check('B cannot read A chunks',
  (select count(*) = 0 from item_chunk where item_id = (select item_id from _a)));
select pg_temp.check('B cannot read A app_user row',
  (select count(*) = 1 from app_user));
select pg_temp.check('get_item on A item returns nothing for B',
  (select get_item((select item_id from _a)) is null));
select pg_temp.check('search by text never returns A item',
  (select count(*) = 0 from search_items('Alpha lasagna', pg_temp.vec(1))
   where item_id = (select item_id from _a)));
select pg_temp.check('search by shared tag name returns only B item',
  (select count(*) = 1 and bool_and(title = 'Beta curry')
   from search_items(null, null, array['weeknight'])));

do $$
begin
  perform update_item((select item_id from _a), p_title => 'hacked', p_chunks => '[]');
  perform pg_temp.check('update_item on A item is refused', false, 'update succeeded');
exception when others then
  perform pg_temp.check('update_item on A item is refused', sqlerrm = 'item not found', sqlerrm);
end $$;

do $$
declare n int;
begin
  update item set title = 'hacked' where id = (select item_id from _a);
  get diagnostics n = row_count;
  perform pg_temp.check('direct UPDATE of A item touches 0 rows', n = 0, n::text);
  delete from item where id = (select item_id from _a);
  get diagnostics n = row_count;
  perform pg_temp.check('direct DELETE of A item touches 0 rows', n = 0, n::text);
end $$;

do $$
begin
  perform save_item((select space_id from _a), 'note', 'planted', '', null, '{}', '{}', '[]');
  perform pg_temp.check('save_item into A space is refused', false, 'insert succeeded');
exception when others then
  perform pg_temp.check('save_item into A space is refused', true, sqlerrm);
end $$;

do $$
begin
  insert into item (space_id, item_type, title) values ((select space_id from _a), 'note', 'planted');
  perform pg_temp.check('direct INSERT into A space is refused', false, 'insert succeeded');
exception when others then
  perform pg_temp.check('direct INSERT into A space is refused', true, sqlerrm);
end $$;

do $$
begin
  insert into space (name, parent_id) values ('squatter', (select space_id from _a));
  perform pg_temp.check('nesting a space under A space is refused', false, 'insert succeeded');
exception when others then
  perform pg_temp.check('nesting a space under A space is refused', true, sqlerrm);
end $$;

do $$
begin
  insert into item_link (from_item_id, to_item_id, relation)
  values ((select id from item where title = 'Beta curry'), (select item_id from _a), 'related');
  perform pg_temp.check('linking to A item is refused', false, 'insert succeeded');
exception when others then
  perform pg_temp.check('linking to A item is refused', true, sqlerrm);
end $$;

-- ---------- anonymous caller ----------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  perform count(*) from item;
  perform pg_temp.check('anon cannot read item table', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read item table', true, sqlerrm);
end $$;
do $$
begin
  perform * from search_items('lasagna');
  perform pg_temp.check('anon cannot call search_items', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call search_items', true, sqlerrm);
end $$;
reset role;
