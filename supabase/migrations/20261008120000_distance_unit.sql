-- Distances in miles or kilometres (docs/places-plan.md step 8, Q14): one account setting, read by
-- the server, so Wilma's replies, the place cards and "nearby" (10 miles, about 16 km; Q12) agree.
-- Miles by default; the app's Settings screen changes it.
--
-- app_user already has RLS (policy app_user_self: each user sees and changes only their own row)
-- and anon has no access to it (vault migration). Only this column becomes readable and writable.

alter table app_user
  add column distance_unit text not null default 'mi'
  constraint app_user_distance_unit_check check (distance_unit in ('mi', 'km'));

grant select (distance_unit) on app_user to authenticated;
grant update (distance_unit) on app_user to authenticated;
