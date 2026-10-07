-- Test: the distance unit (20261008120000_distance_unit.sql). Miles by default, each user reads
-- and changes only their own, only 'mi' or 'km', and anon cannot read it.

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('a new user''s distances are in miles',
  (select distance_unit = 'mi' from app_user where id = auth.uid()));

update app_user set distance_unit = 'km' where id = auth.uid();
select pg_temp.check('the owner can switch to km',
  (select distance_unit = 'km' from app_user where id = auth.uid()));

do $$
begin
  update app_user set distance_unit = 'yards' where id = auth.uid();
  perform pg_temp.check('another unit is refused', false, 'accepted');
exception when check_violation then
  perform pg_temp.check('another unit is refused', true, sqlerrm);
end $$;

do $$
begin
  update app_user set public_key = decode(repeat('99', 32), 'hex') where id = auth.uid();
  perform pg_temp.check('the new grant does not open other columns', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('the new grant does not open other columns', true, sqlerrm);
end $$;

-- ---------- user B ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('B still has miles',
  (select distance_unit = 'mi' from app_user where id = auth.uid()));
select pg_temp.check('B cannot read A''s unit',
  (select count(*) = 0 from app_user where id = '00000000-0000-4000-a000-00000000000a'));
do $$
declare n int;
begin
  update app_user set distance_unit = 'mi' where id = '00000000-0000-4000-a000-00000000000a';
  get diagnostics n = row_count;
  perform pg_temp.check('B cannot change A''s unit', n = 0, n::text || ' rows');
end $$;

reset role;
select pg_temp.check('A''s unit is unchanged by B',
  (select distance_unit = 'km' from app_user where id = '00000000-0000-4000-a000-00000000000a'));

-- ---------- anonymous caller ----------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  perform distance_unit from app_user;
  perform pg_temp.check('anon cannot read the unit', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read the unit', true, sqlerrm);
end $$;
reset role;
