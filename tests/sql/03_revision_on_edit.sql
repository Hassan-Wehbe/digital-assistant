-- Test: editing an item writes the previous version to item_revision first,
-- and only the current version is chunked (CLAUDE.md rule 7).

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('Designs');
create temp table _i as
select save_item((select id from space where name = 'Designs'), 'design', 'Routing v1',
                 'Route Teams calls to the falcon queue.', null, '{"v": 1}', array['teams'],
                 pg_temp.chunks('Routing v1: route Teams calls to the falcon queue.', 3)) as id;

select update_item((select id from _i),
                   p_title => 'Routing v2', p_body => 'Route Teams calls to the heron queue.',
                   p_metadata => '{"v": 2}', p_change_note => 'moved to the heron queue',
                   p_chunks => pg_temp.chunks('Routing v2: route Teams calls to the heron queue.', 4));

select pg_temp.check('first edit writes revision 1',
  (select count(*) = 1 from item_revision where item_id = (select id from _i)));
select pg_temp.check('revision 1 holds the previous title, body and metadata',
  (select title = 'Routing v1' and body_markdown = 'Route Teams calls to the falcon queue.'
          and metadata = '{"v": 1}' and revision_number = 1
   from item_revision where item_id = (select id from _i)));
select pg_temp.check('revision keeps the change note',
  (select change_note = 'moved to the heron queue' from item_revision where item_id = (select id from _i)));
select pg_temp.check('item now holds the new version',
  (select title = 'Routing v2' and body_markdown = 'Route Teams calls to the heron queue.'
   from item where id = (select id from _i)));
select pg_temp.check('only the current version is chunked',
  (select count(*) = 1 and bool_and(content like '%heron%')
   from item_chunk where item_id = (select id from _i)));
select pg_temp.check('search finds the new text, not the old',
  (select count(*) filter (where s.item_id = (select id from _i)) = 0
   from search_items('falcon') s)
  and (select count(*) = 1 from search_items('heron')));

select update_item((select id from _i), p_body => 'Route Teams calls to the osprey queue.',
                   p_chunks => pg_temp.chunks('Routing v2: route Teams calls to the osprey queue.', 5));
select pg_temp.check('second edit writes revision 2 with the v2 body',
  (select body_markdown = 'Route Teams calls to the heron queue.'
   from item_revision where item_id = (select id from _i) and revision_number = 2));
select pg_temp.check('change note does not leak into the next revision',
  (select change_note is null
   from item_revision where item_id = (select id from _i) and revision_number = 2));

select update_item((select id from _i), p_tags => array['teams', 'routing']);
select pg_temp.check('tag-only edit writes no revision',
  (select count(*) = 2 from item_revision where item_id = (select id from _i)));
select pg_temp.check('tag-only edit updates the tags',
  (select get_item(id) -> 'tags' = '["routing", "teams"]'::jsonb from _i));
select pg_temp.check('get_item reports the revision count',
  (select (get_item(id) ->> 'revision_count')::int = 2 from _i));

do $$
begin
  perform update_item((select id from _i), p_body => 'no chunks');
  perform pg_temp.check('text edit without new chunks is refused', false, 'update succeeded');
exception when others then
  perform pg_temp.check('text edit without new chunks is refused', true, sqlerrm);
end $$;

do $$
declare n int;
begin
  update item_revision set body_markdown = 'rewritten' where item_id = (select id from _i);
  get diagnostics n = row_count;
  perform pg_temp.check('revisions cannot be rewritten', false, n::text || ' rows updated');
exception when insufficient_privilege then
  perform pg_temp.check('revisions cannot be rewritten', true, sqlerrm);
end $$;

reset role;
