-- Test: the optional weak-match cutoff in search_items (migration search_cutoff).
-- Unit vectors: pg_temp.vec(k) vs vec(k) has distance 0, vs vec(j) distance 1.

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('Recipes');
insert into space (name, is_restricted) values ('Private', true);
select save_item((select id from space where name = 'Recipes'), 'recipe', 'Lentil soup',
                 'Red lentils, onion, cumin.', null, '{}', '{}',
                 pg_temp.chunks('Red lentils, onion, cumin.', 7));
select save_item((select id from space where name = 'Private'), 'note', 'Private soup',
                 'Red lentils, onion, cumin.', null, '{}', '{}',
                 pg_temp.chunks('Red lentils, onion, cumin.', 7));

select pg_temp.check('without a cutoff, an unrelated meaning still returns the nearest item (old behaviour)',
  (select count(*) = 1 from search_items(null, pg_temp.vec(8))));
select pg_temp.check('with the cutoff, an unrelated meaning returns nothing',
  (select count(*) = 0 from search_items(null, pg_temp.vec(8), null, null, null, 10, 0.2)));
select pg_temp.check('with the cutoff, a close meaning is still found',
  (select count(*) = 1 and bool_and(title = 'Lentil soup')
   from search_items(null, pg_temp.vec(7), null, null, null, 10, 0.2)));
select pg_temp.check('with the cutoff, a keyword match stays even when the meaning is far',
  (select count(*) = 1 and bool_and(title = 'Lentil soup')
   from search_items('lentil', pg_temp.vec(8), null, null, null, 10, 0.2)));
select pg_temp.check('with the cutoff, restricted spaces are still never searched',
  (select count(*) = 1 and bool_and(title = 'Lentil soup')
   from search_items('soup', pg_temp.vec(7), null, null, null, 10, 0.2)));
select pg_temp.check('calls without the new argument keep working',
  (select count(*) = 1 from search_items('lentil')));

reset role;

do $$
begin
  set local role anon;
  perform * from search_items('lentil', null, null, null, null, 10, 0.2);
  perform pg_temp.check('anon cannot call search_items', false, 'call succeeded');
exception when others then
  perform pg_temp.check('anon cannot call search_items', true, sqlerrm);
end $$;
reset role;
