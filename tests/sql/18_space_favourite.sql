-- Test: favourite spaces for Home (20261018120000_space_favourite.sql, docs/home-cleanup-plan.md
-- step 1). Each person sees and changes only their own list (rule 5); anon gets nothing; the list is
-- saved whole, in order, at most 6, each space once; restricted spaces, spaces under them and Tasks
-- are refused (rule 3) and, if restricted later, no longer shown; the table cannot be written
-- directly; deleting a space removes it from the list.

-- A's space by name, whoever is signed in (security definer, so B's tests can name A's spaces).
create function pg_temp.sid(p_name text) returns uuid language sql stable security definer as $$
  select id from public.space where name = p_name and owner_user_id = '00000000-0000-4000-a000-00000000000a';
$$;
grant execute on function pg_temp.sid(text) to authenticated;

-- ---------- A makes some spaces ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into space (name) values ('Recipes'), ('Work'), ('House');
insert into space (name, is_restricted) values ('Private', true);
insert into space (name, parent_id) values ('Inner', (select id from space where name = 'Private'));
insert into space (name, parent_id, is_restricted)
  values ('Locked child', (select id from space where name = 'Work'), true);
insert into space (name, parent_id) values ('Gartner', (select id from space where name = 'Work'));
insert into space (name) select 'Extra ' || g from generate_series(1, 4) g;

select pg_temp.check('a new account has no favourites', (select my_favourite_spaces() = '{}'));

select pg_temp.check('saving Work, Recipes returns them in that order',
  (select set_favourite_spaces(array[pg_temp.sid('Work'), pg_temp.sid('Recipes')])
          = array[pg_temp.sid('Work'), pg_temp.sid('Recipes')]));
select pg_temp.check('my_favourite_spaces reads them back in order',
  (select my_favourite_spaces() = array[pg_temp.sid('Work'), pg_temp.sid('Recipes')]));
select pg_temp.check('the rows belong to A, positions 1 and 2',
  (select count(*) = 2 and bool_and(user_id = auth.uid()) and min(position) = 1 and max(position) = 2
   from space_favourite));
select pg_temp.check('a space nested under a plain space can be a favourite',
  (select set_favourite_spaces(array[pg_temp.sid('Gartner'), pg_temp.sid('Recipes'), pg_temp.sid('Work')])
          = array[pg_temp.sid('Gartner'), pg_temp.sid('Recipes'), pg_temp.sid('Work')]));
select pg_temp.check('saving again replaces the whole list (reordered, one removed)',
  (select set_favourite_spaces(array[pg_temp.sid('Recipes'), pg_temp.sid('Work')])
          = array[pg_temp.sid('Recipes'), pg_temp.sid('Work')]));
select pg_temp.check('the removed one''s row is gone', (select count(*) = 2 from space_favourite));
select pg_temp.check('six spaces are allowed',
  (select cardinality(set_favourite_spaces(array[pg_temp.sid('Recipes'), pg_temp.sid('Work'), pg_temp.sid('House'),
                                                  pg_temp.sid('Extra 1'), pg_temp.sid('Extra 2'), pg_temp.sid('Extra 3')])) = 6));
select set_favourite_spaces(array[pg_temp.sid('Recipes'), pg_temp.sid('Work')]);

-- ---------- Refused, and nothing changes ----------
create function pg_temp.refused(p_test text, p_ids uuid[], p_message text) returns void
language plpgsql as $$
begin
  perform public.set_favourite_spaces(p_ids);
  perform pg_temp.check(p_test, false, 'saved');
exception when others then
  perform pg_temp.check(p_test,
    sqlerrm like p_message and public.my_favourite_spaces() = array[pg_temp.sid('Recipes'), pg_temp.sid('Work')],
    sqlerrm);
end;
$$;

select pg_temp.refused('a restricted space is refused',
  array[pg_temp.sid('Private')], 'That space cannot be a favourite.');
select pg_temp.refused('a space under a restricted one is refused',
  array[pg_temp.sid('Inner')], 'That space cannot be a favourite.');
select pg_temp.refused('a restricted space inside a plain one is refused',
  array[pg_temp.sid('Locked child')], 'That space cannot be a favourite.');
select pg_temp.refused('one restricted space refuses the whole list',
  array[pg_temp.sid('House'), pg_temp.sid('Private')], 'That space cannot be a favourite.');
select pg_temp.refused('the built-in Tasks space is refused',
  array[(select id from space where built_in = 'tasks')], 'That space cannot be a favourite.');
select pg_temp.refused('a space that does not exist is refused',
  array[gen_random_uuid()], 'That space cannot be a favourite.');
select pg_temp.refused('seven spaces are refused',
  array[pg_temp.sid('Recipes'), pg_temp.sid('Work'), pg_temp.sid('House'), pg_temp.sid('Extra 1'),
        pg_temp.sid('Extra 2'), pg_temp.sid('Extra 3'), pg_temp.sid('Extra 4')], 'You can have at most 6%');
select pg_temp.refused('the same space twice is refused',
  array[pg_temp.sid('House'), pg_temp.sid('House')], 'A space can be a favourite only once.');
select pg_temp.refused('an empty entry is refused',
  array[pg_temp.sid('House'), null], 'A favourite needs a space.');

do $$
begin
  insert into space_favourite (space_id, position) values (pg_temp.sid('Private'), 3);
  perform pg_temp.check('the table cannot be written directly (insert)', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the table cannot be written directly (insert)', true, sqlerrm);
end $$;
do $$
begin
  update space_favourite set space_id = pg_temp.sid('Private') where position = 1;
  perform pg_temp.check('the table cannot be written directly (update)', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the table cannot be written directly (update)', true, sqlerrm);
end $$;
do $$
begin
  delete from space_favourite;
  perform pg_temp.check('the table cannot be written directly (delete)', false, 'delete succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the table cannot be written directly (delete)', true, sqlerrm);
end $$;

-- ---------- B: own list only ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
insert into space (name) values ('B recipes');

select pg_temp.check('B sees none of A''s favourite rows', (select count(*) = 0 from space_favourite));
select pg_temp.check('B''s list is empty', (select my_favourite_spaces() = '{}'));
do $$
begin
  perform set_favourite_spaces(array[pg_temp.sid('Recipes')]);
  perform pg_temp.check('B cannot favourite A''s space', false, 'saved');
exception when others then
  perform pg_temp.check('B cannot favourite A''s space', sqlerrm = 'That space cannot be a favourite.', sqlerrm);
end $$;
select pg_temp.check('B can favourite their own space',
  (select set_favourite_spaces(array[(select id from space where name = 'B recipes')])
          = array[(select id from space where name = 'B recipes')]));
select pg_temp.check('B can clear their list (empty)',
  (select set_favourite_spaces('{}') = '{}'));
select pg_temp.check('null clears too', (select set_favourite_spaces(null) = '{}'));

-- ---------- anon: nothing ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform 1 from public.space_favourite;
  perform pg_temp.check('anon cannot read the table', false, 'read succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read the table', true, sqlerrm);
end $$;
do $$
begin
  perform public.my_favourite_spaces();
  perform pg_temp.check('anon cannot call my_favourite_spaces', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call my_favourite_spaces', true, sqlerrm);
end $$;
do $$
begin
  perform public.set_favourite_spaces('{}');
  perform pg_temp.check('anon cannot call set_favourite_spaces', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call set_favourite_spaces', true, sqlerrm);
end $$;

-- ---------- Back to A ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('B saving and clearing their list left A''s alone',
  (select my_favourite_spaces() = array[pg_temp.sid('Recipes'), pg_temp.sid('Work')]));

-- ---------- Later changes to A's spaces ----------
reset role;
update space set is_restricted = true where id = pg_temp.sid('Recipes');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.check('a favourite made restricted later is no longer shown',
  (select my_favourite_spaces() = array[pg_temp.sid('Work')]));

reset role;
update space set is_restricted = false where id = pg_temp.sid('Recipes');
update space set parent_id = pg_temp.sid('Private') where id = pg_temp.sid('Recipes');
set local role authenticated;
select pg_temp.check('a favourite moved under a restricted space is no longer shown',
  (select my_favourite_spaces() = array[pg_temp.sid('Work')]));

reset role;
create temp table _work as select pg_temp.sid('Work') as id;
grant select on _work to authenticated;
delete from space where id = (select id from _work);
set local role authenticated;
select pg_temp.check('deleting a space removes it from the list',
  (select count(*) = 0 from space_favourite where space_id = (select id from _work)));
select pg_temp.check('only the hidden Recipes row is left',
  (select count(*) = 1 and bool_and(space_id = pg_temp.sid('Recipes')) from space_favourite)
  and (select my_favourite_spaces() = '{}'));
