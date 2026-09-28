-- Test: restricted spaces, and anything nested under them, never show up in
-- search (CLAUDE.md rule 3). Every item below shares the same keyword, tag and
-- embedding, so only the restriction can keep an item out of the results.
-- M1 decision: get_item by id still works for restricted items.

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('Work');
insert into space (name, is_restricted) values ('Private', true);
insert into space (name, parent_id) values ('Inner', (select id from space where name = 'Private'));
insert into space (name, parent_id, is_restricted)
  values ('Locked child', (select id from space where name = 'Work'), true);

select save_item((select id from space where name = sp), 'note', 'Gartner sandbox ' || sp,
                 'Notes about the gartner sandbox.', null, '{}', array['gartner'],
                 pg_temp.chunks('Notes about the gartner sandbox.', 7))
from unnest(array['Work', 'Private', 'Inner', 'Locked child']) sp;

select pg_temp.check('keyword + semantic search returns only the Work item',
  (select count(*) = 1 and bool_and(title = 'Gartner sandbox Work')
   from search_items('gartner sandbox', pg_temp.vec(7))));
select pg_temp.check('semantic-only search returns only the Work item',
  (select count(*) = 1 and bool_and(title = 'Gartner sandbox Work')
   from search_items(null, pg_temp.vec(7))));
select pg_temp.check('keyword-only search returns only the Work item',
  (select count(*) = 1 and bool_and(title = 'Gartner sandbox Work')
   from search_items('gartner')));
select pg_temp.check('tag search returns only the Work item',
  (select count(*) = 1 and bool_and(title = 'Gartner sandbox Work')
   from search_items(null, null, array['gartner'])));
select pg_temp.check('listing with no filters returns only the Work item',
  (select count(*) = 1 from search_items()));
select pg_temp.check('scoping search to the restricted space returns nothing',
  (select count(*) = 0 from search_items('gartner', pg_temp.vec(7), null,
                                         (select id from space where name = 'Private'))));
select pg_temp.check('scoping search to a space under a restricted one returns nothing',
  (select count(*) = 0 from search_items('gartner', pg_temp.vec(7), null,
                                         (select id from space where name = 'Inner'))));
select pg_temp.check('scoping to Work excludes its restricted child',
  (select count(*) = 1 from search_items('gartner', null, null,
                                         (select id from space where name = 'Work'))));

select pg_temp.check('get_item by id still works in a restricted space (M1 decision)',
  (select get_item(id) ->> 'title' = 'Gartner sandbox Private'
   from item where title = 'Gartner sandbox Private'));

insert into item_link (from_item_id, to_item_id, relation)
select w.id, p.id, 'related'
from item w, item p
where w.title = 'Gartner sandbox Work' and p.title = 'Gartner sandbox Private';
select pg_temp.check('get_item links never reveal an item in a restricted space',
  (select jsonb_array_length(get_item(id) -> 'links') = 0
   from item where title = 'Gartner sandbox Work'));

reset role;
