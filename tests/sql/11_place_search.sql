-- Test: search reads a place's fields (migration place_search, docs/places-plan.md).
-- Keyword search finds a place by its address, cuisine or a visit note; other item types keep
-- their old behaviour (metadata not searched); restricted spaces stay out (rule 3); results
-- carry a place's fields and null for everything else. The keyword checks pass no query
-- embedding (meaning search with no cutoff would return every item).

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('Restaurants');
insert into space (name, is_restricted) values ('Private', true);

select save_item((select id from space where name = 'Restaurants'), 'place', 'Tawlet',
                 'Try the fattoush.', null,
                 '{"address":"Armenia St, Mar Mikhael, Beirut","kind":"restaurant","status":"been","rating":5,
                   "cuisine":["lebanese"],"dishes_liked":["kibbeh nayeh"],"occasions":["date_night"],
                   "visits":[{"on":"2026-09-20","with":"Sarah","note":"anniversary dinner"}]}',
                 '{}', pg_temp.chunks('Tawlet. Try the fattoush.', 1));
select save_item((select id from space where name = 'Private'), 'place', 'Hidden spot',
                 'Quiet.', null, '{"address":"Gemmayze, Beirut","cuisine":["lebanese"]}',
                 '{}', pg_temp.chunks('Hidden spot. Quiet.', 1));
select save_item((select id from space where name = 'Restaurants'), 'note', 'Shopping note',
                 'Buy bread.', null, '{"address":"Hamra, Beirut"}',
                 '{}', pg_temp.chunks('Shopping note. Buy bread.', 1));

select pg_temp.check('a place is found by a word of its address',
  (select count(*) = 1 and bool_and(title = 'Tawlet') from search_items('Mikhael')));
select pg_temp.check('a place is found by its cuisine and a liked dish',
  (select count(*) = 1 and bool_and(title = 'Tawlet') from search_items('lebanese kibbeh')));
select pg_temp.check('a place is found by a word of a visit note',
  (select count(*) = 1 and bool_and(title = 'Tawlet') from search_items('anniversary')));
select pg_temp.check('a place is still found by its title and body',
  (select count(*) = 1 and bool_and(title = 'Tawlet') from search_items('fattoush')));
select pg_temp.check('a restricted place is never found (rule 3)',
  (select count(*) = 0 from search_items('Gemmayze')));
select pg_temp.check('other item types: metadata is not searched (unchanged)',
  (select count(*) = 0 from search_items('Hamra')));
select pg_temp.check('results carry a place''s fields',
  (select place->>'status' = 'been' and (place->>'rating')::int = 5 and place->'occasions' ? 'date_night'
   from search_items('Mikhael')));
select pg_temp.check('other items carry no place fields',
  (select place is null from search_items('bread')));
select pg_temp.check('listing places by type works without a query, restricted left out',
  (select count(*) = 1 and bool_and(title = 'Tawlet') from search_items(null, null, null, null, 'place')));
select pg_temp.check('the weak-match cutoff still works',
  (select count(*) = 0 from search_items(null, pg_temp.vec(9), null, null, null, 10, 0.2)));

-- User B sees none of user A's places.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('another user never finds them (rule 5)',
  (select count(*) = 0 from search_items('Mikhael lebanese')));

reset role;

do $$
begin
  set local role anon;
  perform * from search_items('Mikhael');
  perform pg_temp.check('anon cannot call search_items', false, 'call succeeded');
exception when others then
  perform pg_temp.check('anon cannot call search_items', true, sqlerrm);
end $$;
