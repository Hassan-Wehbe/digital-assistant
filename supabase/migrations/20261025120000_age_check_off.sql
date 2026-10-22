-- Ages switched off (owner, 2026-10-22; docs/age-plan.md "Switched off"; design D44 changed): Wilma
-- stays 18 and over, sign-up goes back to the 18+ box, and everyone gets cocktails, as before the
-- age plan. The age code is kept, switched off by one setting, so it can come back later:
--
--   * signup_setting.age_check (false): off. While off,
--       - is_21() is true for everyone (the edge functions' drinks rules then let cocktails through);
--       - my_age_status() says asked and 21 or over, so the app never asks and shows cocktails (the
--         versionCode 25 app too, with no update);
--       - _sync_drinks_space() names every drinks space Cocktails (all are renamed back now).
--   * The sign-up hook is unchanged: the 18+ box (newer builds again) and the month and year of
--     birth (versionCode 25) both still check 18 and over. alcohol_from is still worked out from
--     the month and year when given, and is simply not used while the check is off.
--
-- Switching it back on is `update signup_setting set age_check = true;` (then the next listing
-- renames the drinks spaces). Nothing new is granted; the helper is callable by no one.

alter table signup_setting add column age_check boolean not null default false;
comment on column signup_setting.age_check is
  'D44: the age check for drinks (cocktails from 21, mocktails before). Off: everyone is treated as 21+.';

create function _age_check_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.age_check from public.signup_setting s), false);
$$;

-- As 20261023120000_age_check.sql, but asked and 21 or over for everyone while the check is off.
create or replace function my_age_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public._age_check_on()
    then jsonb_build_object('asked', true, 'is_21', true)
    else jsonb_build_object(
      'asked', u.alcohol_from is not null,
      'is_21', coalesce(u.alcohol_from <= current_date, false),
      'alcohol_from', case when u.alcohol_from > current_date then to_char(u.alcohol_from, 'YYYY-MM-DD') end)
    end
  from public.app_user u where u.id = auth.uid();
$$;

-- As 20261023120000_age_check.sql; true for everyone while the check is off.
create or replace function is_21() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public._age_check_on()
    or coalesce((select u.alcohol_from <= current_date from public.app_user u where u.id = auth.uid()), false);
$$;

-- As 20261024120000_drinks_space_name.sql; Cocktails for everyone while the check is off.
create or replace function _sync_drinks_space(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_space public.space;
begin
  select case when not public._age_check_on() or u.alcohol_from <= current_date then 'Cocktails' else 'Mocktails' end
  into v_name
  from public.app_user u where u.id = p_user;
  if v_name is null then return null; end if;
  select * into v_space from public.space where owner_user_id = p_user and built_in = 'cocktails';
  if v_space.id is null or v_space.name = v_name then return v_space.name; end if;
  if exists (
    select 1 from public.space s
    where s.owner_user_id = p_user and s.id <> v_space.id
      and s.parent_id is not distinct from v_space.parent_id and lower(s.name) = lower(v_name)
  ) then
    return v_space.name;
  end if;
  update public.space set name = v_name where id = v_space.id;
  return v_name;
end;
$$;

revoke execute on function _age_check_on() from public, anon, authenticated;
revoke execute on function _sync_drinks_space(uuid) from public, anon, authenticated;
revoke execute on function my_age_status(), is_21() from public, anon;
grant execute on function my_age_status(), is_21() to authenticated;

-- Every account's drinks space back to Cocktails.
select _sync_drinks_space(u.id) from app_user u;
