-- Test: recycle bin and deleting spaces (migration recycle_bin; CLAUDE.md rules 3, 5, 8).
-- Rows the functions only read (an attachment, a secret) are inserted directly as the
-- test's superuser; everything checked runs as the signed-in user.

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', u), true);
$$;

-- ---------- user A's data ----------
select pg_temp.as_user('a');
set local role authenticated;
insert into space (name) values ('Recipes'), ('Empty'), ('Parent'), ('Vaulted');
insert into space (name, parent_id) values ('Child', (select id from space where name = 'Parent'));
insert into space (name, is_restricted) values ('Private', true);
select save_item((select id from space where name = sp), 'note', t, 'Red lentils and cumin.', null, '{}', '{}',
                 pg_temp.chunks('Red lentils and cumin.', 7))
from (values ('Recipes', 'Lentil soup'), ('Recipes', 'Old soup'), ('Private', 'Secret soup')) v(sp, t);
reset role;
insert into attachment (item_id, storage_key, original_filename, mime_type)
select i.id, '00000000-0000-4000-a000-00000000000a/11111111-1111-4111-8111-111111111111/soup.jpg', 'soup.jpg', 'image/jpeg'
from item i join space sp on sp.id = i.space_id
where i.title = 'Old soup' and sp.owner_user_id = '00000000-0000-4000-a000-00000000000a';
insert into secret (space_id, secret_type, name, payload_enc)
select id, 'wifi', 'Home Wi-Fi', '\x00'::bytea from space where name = 'Vaulted' and owner_user_id = '00000000-0000-4000-a000-00000000000a';

-- ---------- user B cannot touch A's notes or spaces ----------
-- The ids are looked up here, as the superuser (through RLS, B could not see A's rows at
-- all), so every lookup is limited to the test user's own rows.
create temp view _a_items as
  select i.* from item i join space sp on sp.id = i.space_id where sp.owner_user_id = '00000000-0000-4000-a000-00000000000a';
create temp table _ids as
  select (select id from _a_items where title = 'Lentil soup') as soup,
         (select id from _a_items where title = 'Old soup') as old,
         (select id from _a_items where title = 'Secret soup') as secret_soup,
         (select id from space where name = 'Empty' and owner_user_id = '00000000-0000-4000-a000-00000000000a') as empty,
         (select id from space where name = 'Recipes' and owner_user_id = '00000000-0000-4000-a000-00000000000a') as recipes;
grant select on _ids to authenticated, anon;

select pg_temp.as_user('b');
set local role authenticated;
do $$
begin
  perform delete_item((select soup from _ids));
  perform pg_temp.check('another user cannot bin a note', false, 'call succeeded');
exception when others then
  perform pg_temp.check('another user cannot bin a note', sqlstate = 'P0002', sqlerrm);
end $$;
do $$
begin
  perform delete_space((select empty from _ids));
  perform pg_temp.check('another user cannot delete a space', false, 'call succeeded');
exception when others then
  perform pg_temp.check('another user cannot delete a space', sqlstate = 'P0002', sqlerrm);
end $$;
select pg_temp.check('another user sees nothing in their bin', (select list_deleted_items() = '[]'::jsonb));

-- ---------- A: bin, list, restore ----------
select pg_temp.as_user('a');
select delete_item((select old from _ids));
select delete_item((select secret_soup from _ids));
select pg_temp.check('a binned note is gone from search',
  (select count(*) = 1 and bool_and(title = 'Lentil soup') from search_items('soup')));
select pg_temp.check('a binned note is gone from get_item', (select get_item((select old from _ids)) is null));
select pg_temp.check('the bin lists it with its file count',
  (select jsonb_array_length(b) = 1 and b -> 0 ->> 'title' = 'Old soup' and (b -> 0 ->> 'attachments')::int = 1
   from list_deleted_items() b));
select pg_temp.check('the bin never shows notes from restricted spaces',
  (select not (list_deleted_items()::text like '%Secret soup%')));
do $$
begin
  perform delete_item((select old from _ids));
  perform pg_temp.check('binning twice is refused', false, 'call succeeded');
exception when others then
  perform pg_temp.check('binning twice is refused', sqlstate = 'P0002', sqlerrm);
end $$;
select restore_item((select old from _ids));
select pg_temp.check('a restored note is back in search', (select count(*) = 2 from search_items('soup')));
select pg_temp.check('a restored note is back in get_item', (select get_item((select old from _ids)) ->> 'title' = 'Old soup'));
select pg_temp.check('restoring keeps the edit history empty (no revision for bin moves)',
  (select count(*) = 0 from item_revision where item_id = (select old from _ids)));

-- ---------- A: purge only from the bin ----------
do $$
begin
  perform purge_item((select old from _ids));
  perform pg_temp.check('a note not in the bin cannot be purged', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a note not in the bin cannot be purged', sqlstate = 'P0002', sqlerrm);
end $$;
select delete_item((select old from _ids));
select pg_temp.check('the files of a binned note are listed for removal',
  (select deleted_item_files((select old from _ids)) =
     array['00000000-0000-4000-a000-00000000000a/11111111-1111-4111-8111-111111111111/soup.jpg']));
select purge_item((select old from _ids));
reset role;
select pg_temp.check('purge removes the note, its attachment rows and search text',
  (select not exists (select 1 from item where id = (select old from _ids))
      and not exists (select 1 from attachment where item_id = (select old from _ids))
      and not exists (select 1 from item_chunk where item_id = (select old from _ids))));
select pg_temp.as_user('a');
set local role authenticated;

-- ---------- A: deleting spaces ----------
do $$
begin
  perform delete_space((select recipes from _ids));
  perform pg_temp.check('a space with notes is not deleted', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a space with notes is not deleted', sqlerrm like '%still holds 1 note.%', sqlerrm);
end $$;
select delete_item((select soup from _ids));
do $$
begin
  perform delete_space((select recipes from _ids));
  perform pg_temp.check('a space with notes in the bin is not deleted', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a space with notes in the bin is not deleted', sqlerrm like '%1 note in the recycle bin%', sqlerrm);
end $$;
do $$
begin
  perform delete_space((select id from space where name = 'Parent'));
  perform pg_temp.check('a space with a sub-space is not deleted', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a space with a sub-space is not deleted', sqlerrm like '%1 sub-space%', sqlerrm);
end $$;
do $$
begin
  perform delete_space((select id from space where name = 'Vaulted'));
  perform pg_temp.check('a space with a vault password is not deleted', false, 'call succeeded');
exception when others then
  perform pg_temp.check('a space with a vault password is not deleted', sqlerrm like '%1 vault password%', sqlerrm);
end $$;
select pg_temp.check('an empty space is deleted',
  (select (delete_space((select empty from _ids)) ->> 'deleted')::boolean));
select pg_temp.check('and it is gone', (select not exists (select 1 from space where name = 'Empty')));
select pg_temp.check('nothing else was deleted along the way',
  (select count(*) = 5 from space where built_in is null) and (select count(*) = 1 from secret));

reset role;
do $$
begin
  set local role anon;
  perform list_deleted_items();
  perform pg_temp.check('anon cannot use the recycle bin', false, 'call succeeded');
exception when others then
  perform pg_temp.check('anon cannot use the recycle bin', true, sqlerrm);
end $$;
reset role;
