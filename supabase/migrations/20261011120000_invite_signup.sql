-- Invite-only sign-up, stage 1 (docs/signup-plan.md step 1, design D29; owner, 2026-10-07 Q1-Q9).
--
--   * signup_setting: one row. signup_mode 'invite' (stage 1) or 'open' (stage 2, Q8): going open
--     needs no app build. terms_version is the version of the privacy policy and testing terms a
--     new account must accept.
--   * invite_code: codes the owner hands out. Only a SHA-256 hash of each code is stored, never
--     the code (create_invite_code() shows it once). Each has a number of uses, an end date and
--     the plan the account starts on ('pro' for a Pro tester code, Q9). invite_use: who used which.
--   * hook_before_user_created(event): Supabase Auth's "Before User Created" hook (switched on by
--     the owner under Authentication > Hooks). It refuses a sign-up, before any account exists,
--     unless it carries a valid invite code (in 'invite' mode) and confirms 18+ and the current
--     terms. Its message goes back to the app as the sign-up error.
--   * handle_new_auth_user (the sign-up trigger) now also counts the code's use (locked, so two
--     sign-ups at once cannot both take a code's last use), starts the account on the code's plan,
--     records the terms acceptance, and removes the code from the account's metadata.
--
-- Users can neither read nor write any of these tables (RLS on, no policies, no grants). The one
-- thing open to anon is signup_mode(): the app asks it before anyone has signed in, to show or
-- hide the invite-code field. It returns 'invite' or 'open' and nothing else.
--
-- An account made without a code (the owner's "Add user" in the dashboard, the SQL tests) is
-- still made by the trigger as before; whether the dashboard path passes the hook is up to
-- Supabase, and a code made for that person always works.

-- =========================================================
-- Tables and columns
-- =========================================================

create table signup_setting (
  id             boolean primary key default true check (id),  -- exactly one row
  signup_mode    text not null default 'invite' check (signup_mode in ('invite', 'open')),
  terms_version  text not null default '2026-10-09',
  updated_at     timestamptz not null default now()
);
insert into signup_setting default values;

create table invite_code (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null unique,
  note         text,
  max_uses     int not null default 1 check (max_uses between 1 and 1000),
  uses         int not null default 0 check (uses >= 0),
  expires_at   timestamptz not null,
  grants_plan  text not null default 'free' check (grants_plan in ('free', 'pro')),
  created_at   timestamptz not null default now()
);

create table invite_use (
  invite_code_id  uuid not null references invite_code (id) on delete cascade,
  user_id         uuid not null references app_user (id) on delete cascade,
  used_at         timestamptz not null default now(),
  primary key (invite_code_id, user_id)
);

alter table signup_setting enable row level security;
alter table invite_code enable row level security;
alter table invite_use enable row level security;

alter table app_user
  add column terms_version text,
  add column terms_accepted_at timestamptz,
  add column age_confirmed boolean not null default false;

-- =========================================================
-- Functions
-- =========================================================

-- The stored form of a code: letters and digits only, upper case, SHA-256 in hex. So
-- "wilma-7k3q-p9xd" and "WILMA 7K3Q P9XD" are the same code.
create function invite_code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex');
$$;

-- What is wrong with a code, or null when it can be used now.
create function invite_code_problem(c public.invite_code) returns text
language sql stable set search_path = '' as $$
  select case
    when c.id is null then 'This invite code is not valid. Check it and try again.'
    when c.expires_at <= now() then 'This invite code has expired. Ask for a new one.'
    when c.uses >= c.max_uses then 'This invite code has been used up. Ask for a new one.'
  end;
$$;

-- Supabase Auth's Before User Created hook. {} lets the sign-up go ahead; {"error": ...} refuses
-- it and no account is made.
create function hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_setting public.signup_setting;
  v_code public.invite_code;
  v_problem text;
begin
  select * into v_setting from public.signup_setting;
  if nullif(btrim(v_meta ->> 'invite_code'), '') is null then
    if coalesce(v_setting.signup_mode, 'invite') = 'invite' then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', 'An invite code is needed to create an account.'));
    end if;
  else
    select * into v_code from public.invite_code
    where code_hash = public.invite_code_hash(v_meta ->> 'invite_code');
    v_problem := public.invite_code_problem(v_code);
    if v_problem is not null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', v_problem));
    end if;
  end if;
  if v_meta -> 'age_confirmed' is distinct from 'true'::jsonb
     or v_meta ->> 'terms_version' is distinct from v_setting.terms_version then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Please confirm you are 18 or older and accept the privacy policy and testing terms.'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- The sign-up trigger (last changed in 20261010120000_default_tasks_space.sql; the app_user insert
-- and the Tasks space are as there).
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code public.invite_code;
  v_problem text;
  v_terms text := (select s.terms_version from public.signup_setting s);
  v_accepted boolean;
begin
  -- The invite code, locked until the sign-up commits. The hook has already checked it; this
  -- check again stops two sign-ups at once from both taking a code's last use.
  if nullif(btrim(v_meta ->> 'invite_code'), '') is not null then
    select * into v_code from public.invite_code
    where code_hash = public.invite_code_hash(v_meta ->> 'invite_code')
    for update;
    v_problem := public.invite_code_problem(v_code);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
  v_accepted := v_meta -> 'age_confirmed' = 'true'::jsonb and v_meta ->> 'terms_version' = v_terms;

  insert into public.app_user (id, email, display_name, plan, terms_version, terms_accepted_at, age_confirmed)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name',
          coalesce(v_code.grants_plan, 'free'),
          case when v_accepted then v_terms end,
          case when v_accepted then now() end,
          coalesce(v_accepted, false))
  on conflict (id) do nothing;

  if v_code.id is not null then
    update public.invite_code set uses = uses + 1 where id = v_code.id;
    insert into public.invite_use (invite_code_id, user_id) values (v_code.id, new.id)
    on conflict do nothing;
    -- The code has done its job; it is not kept with the account.
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'invite_code' where id = new.id;
  end if;

  -- The Tasks space, owned by the new account (the ✅ Tasks tile's tasks go here by default).
  insert into public.space (owner_user_id, parent_id, name, description, is_restricted)
  select new.id, null, 'Tasks', 'Things to do, with due dates', false
  where exists (select 1 from public.app_user u where u.id = new.id)
    and not exists (
      select 1 from public.space s
      where s.owner_user_id = new.id and s.parent_id is null and lower(s.name) = 'tasks'
    );
  return new;
end;
$$;

-- For the owner in the SQL editor: makes a code and returns it. This is the only time the code is
-- shown; only its hash is kept. Example: select create_invite_code('for Sarah', 1, 14, 'pro');
create function create_invite_code(p_note text, p_max_uses int default 1, p_days int default 14,
                                   p_plan text default 'free') returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  -- No 0/O, 1/I/L: easy to read out and type. 8 random characters, about 10^12 codes, from
  -- gen_random_uuid()'s strong random bytes (bytes 6 and 8 carry the UUID version, so skipped).
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_body text := '';
  v_code text;
  i int;
begin
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'days must be 1 to 365' using errcode = '22023';
  end if;
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_body := v_body || substr(v_alphabet, 1 + get_byte(v_bytes, i) % length(v_alphabet), 1);
  end loop;
  v_code := 'WILMA-' || substr(v_body, 1, 4) || '-' || substr(v_body, 5, 4);
  insert into public.invite_code (code_hash, note, max_uses, expires_at, grants_plan)
  values (public.invite_code_hash(v_code), p_note, p_max_uses, now() + make_interval(days => p_days), p_plan);
  return v_code;
end;
$$;

-- Before sign-in: is sign-up invite-only or open? (The app's Create account screen.)
create function signup_mode() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.signup_mode from public.signup_setting s), 'invite');
$$;

-- =========================================================
-- Privileges
-- =========================================================

revoke all on signup_setting, invite_code, invite_use from public, anon, authenticated;

-- A person reads their own terms acceptance (RLS policy app_user_self); no update grant.
grant select (terms_version, terms_accepted_at, age_confirmed) on app_user to authenticated;

revoke execute on function invite_code_hash(text), invite_code_problem(public.invite_code),
  hook_before_user_created(jsonb), handle_new_auth_user(),
  create_invite_code(text, int, int, text), signup_mode()
  from public, anon, authenticated;
grant execute on function hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function signup_mode() to anon, authenticated;
