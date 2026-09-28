-- Phase 1, milestone 2: the vault (encryption option B, zero-knowledge).
-- Plan: docs/phase1-m2-vault-plan.md. CLAUDE.md rules 1-6.
--
-- The database only ever holds ciphertext:
--   * app_user keeps the owner's X25519 public key and the private key wrapped
--     twice (by the unlock passphrase via Argon2id, and by the recovery key).
--   * secret.payload_enc is a libsodium sealed box to that public key.
-- Encryption and decryption happen in the owner's browser (docs/vault/).
--
-- Plaintext never passes through chat, so the MCP server only creates
-- short-lived links:
--   * secret_entry_request: "type the value on this page" (15 min, single use)
--   * secret_reveal_token:  "show the value on this page"   (10 min, single use)
-- Only the SHA-256 of a link token is stored.
--
-- Access rules:
--   * authenticated users cannot read or write payload_enc or the wrapped keys
--     directly; only the security-definer functions below touch them.
--   * functions used by the vault pages refuse tokens issued to OAuth clients
--     (the Claude connector): those tokens carry a client_id claim. So a leaked
--     connector token cannot fetch ciphertext or replace keys.
--   * find_secrets never sees restricted spaces or anything below them (rule 3).
--   * every create / reveal / update / delete writes secret_access_log.
--   * nothing here connects secret to item, item_chunk or item_share (rules 2, 4).

-- =========================================================
-- Tables
-- =========================================================

alter table app_user
  add column vault_salt                   bytea,  -- Argon2id salt for the passphrase key
  add column kdf_params                   jsonb,  -- {"alg":"argon2id13","ops":3,"mem":67108864}
  add column recovery_wrapped_private_key bytea,  -- private key wrapped by the recovery key
  add column vault_key_version            int;    -- version of the key pair; secrets record it

-- Audit rows must outlive the secret they describe (a delete is logged too),
-- so the log keeps the secret id and a name snapshot without a foreign key.
alter table secret_access_log drop constraint secret_access_log_secret_id_fkey;
alter table secret_access_log add column secret_name text;
create index secret_access_log_user_idx on secret_access_log (user_id, occurred_at desc);
create index secret_access_log_secret_idx on secret_access_log (secret_id);

create table secret_entry_request (
  id           uuid primary key default gen_random_uuid(),
  token_hash   bytea not null unique,
  user_id      uuid not null references app_user (id) on delete cascade,
  space_id     uuid not null references space (id) on delete cascade,
  secret_id    uuid not null,     -- pre-allocated (new) or existing (re-entry); goes inside the ciphertext
  is_update    boolean not null default false,
  secret_type  text not null
               check (secret_type in ('login','api_key','wifi','recovery_codes','note')),
  name         text not null,
  url          text,
  expires_at   timestamptz not null default now() + interval '15 minutes',
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index secret_entry_request_user_idx on secret_entry_request (user_id);

create table secret_reveal_token (
  id          uuid primary key default gen_random_uuid(),
  token_hash  bytea not null unique,
  user_id     uuid not null references app_user (id) on delete cascade,
  secret_id   uuid not null references secret (id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index secret_reveal_token_user_idx on secret_reveal_token (user_id);
create index secret_reveal_token_secret_idx on secret_reveal_token (secret_id);

-- Tokens are reachable only through the functions below: RLS on, no policies.
alter table secret_entry_request enable row level security;
alter table secret_reveal_token  enable row level security;

-- =========================================================
-- Privileges
-- =========================================================

revoke all on secret_entry_request, secret_reveal_token from public, anon, authenticated;

-- app_user: own row readable except the wrapped keys; key columns change only
-- through setup_vault / rewrap_vault_passphrase.
revoke all on app_user from anon, authenticated;
grant select (id, email, display_name, public_key, vault_key_version, created_at)
  on app_user to authenticated;
grant update (display_name) on app_user to authenticated;

-- secret: metadata readable (RLS: own spaces only); payload_enc never.
-- All writes go through the functions below.
revoke all on secret from anon, authenticated;
grant select (id, space_id, secret_type, name, url, key_version, expires_at,
              created_at, updated_at, last_accessed_at)
  on secret to authenticated;

-- secret_access_log: read own rows; written only by the functions below.
revoke all on secret_access_log from anon, authenticated;
grant select on secret_access_log to authenticated;
drop policy secret_log_owner_read on secret_access_log;
drop policy secret_log_insert on secret_access_log;
create policy secret_log_owner_read on secret_access_log
  for select using (user_id = auth.uid());

-- =========================================================
-- Internal helpers
-- =========================================================

-- Refuse OAuth-client tokens (e.g. the Claude connector) and anonymous calls.
create or replace function _vault_require_browser_session() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'this action is only available on the vault page' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function _vault_require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- 256-bit random link token, URL-safe base64 without padding.
create or replace function _vault_new_token() returns text
language sql volatile security definer set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
$$;

create or replace function _vault_token_hash(p_token text) returns bytea
language sql immutable security definer set search_path = '' as $$
  select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256');
$$;

create or replace function _b64(p bytea) returns text
language sql immutable security definer set search_path = '' as $$
  select replace(encode(p, 'base64'), E'\n', '');
$$;

-- Decode base64 and check the length; raises a clear error instead of a cast failure.
create or replace function _unb64(p text, p_what text, p_min int, p_max int) returns bytea
language plpgsql immutable security definer set search_path = '' as $$
declare
  v bytea;
begin
  begin
    v := decode(p, 'base64');
  exception when others then
    raise exception '% is not valid base64', p_what using errcode = '22023';
  end;
  if v is null or length(v) < p_min or length(v) > p_max then
    raise exception '% has the wrong length', p_what using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function _vault_check_kdf_params(p jsonb) returns jsonb
language plpgsql immutable security definer set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) <> 'object'
     or p ->> 'alg' is distinct from 'argon2id13'
     or jsonb_typeof(p -> 'ops') is distinct from 'number'
     or jsonb_typeof(p -> 'mem') is distinct from 'number'
     or (p ->> 'ops')::numeric not between 2 and 20
     or (p ->> 'mem')::numeric not between 16777216 and 1073741824 then
    raise exception 'kdf_params must be {"alg":"argon2id13","ops":2..20,"mem":16MiB..1GiB}'
      using errcode = '22023';
  end if;
  return jsonb_build_object('alg', 'argon2id13',
                            'ops', (p ->> 'ops')::int, 'mem', (p ->> 'mem')::bigint);
end;
$$;

create or replace function _vault_log(p_secret_id uuid, p_user_id uuid, p_action text,
                                      p_channel text, p_name text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.secret_access_log (secret_id, user_id, action, channel, secret_name)
  values (p_secret_id, p_user_id, p_action, p_channel, p_name);
$$;

-- Drop the caller's expired or used link tokens (kept a day for troubleshooting).
create or replace function _vault_sweep(p_user_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.secret_entry_request
   where user_id = p_user_id and expires_at < now() - interval '1 day';
  delete from public.secret_reveal_token
   where user_id = p_user_id and expires_at < now() - interval '1 day';
$$;

revoke execute on function
  _vault_require_browser_session(), _vault_require_user(), _vault_new_token(),
  _vault_token_hash(text), _b64(bytea), _unb64(text, text, int, int),
  _vault_check_kdf_params(jsonb), _vault_log(uuid, uuid, text, text, text), _vault_sweep(uuid)
  from public, anon, authenticated;

-- =========================================================
-- Vault keys (vault pages)
-- =========================================================

-- Sizes (libsodium): public key 32 bytes; wrapped private key = 24-byte nonce
-- + secretbox(32-byte key) = 24 + 16 + 32 = 72 bytes; Argon2id salt 16 bytes.

-- Is the caller's vault set up? Metadata only; used by the MCP server.
create or replace function vault_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('set_up', u.public_key is not null,
                            'key_version', u.vault_key_version)
  from public.app_user u where u.id = auth.uid();
$$;

-- Everything the vault pages need to unlock. Wrapped keys are useless without
-- the passphrase or recovery key, but still only handed to browser sessions.
create or replace function get_vault_keys() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
  r public.app_user;
begin
  select * into r from public.app_user where id = v_uid;
  if r.public_key is null then
    return jsonb_build_object('set_up', false);
  end if;
  return jsonb_build_object(
    'set_up', true,
    'public_key', public._b64(r.public_key),
    'wrapped_private_key', public._b64(r.wrapped_private_key),
    'recovery_wrapped_private_key', public._b64(r.recovery_wrapped_private_key),
    'vault_salt', public._b64(r.vault_salt),
    'kdf_params', r.kdf_params,
    'key_version', r.vault_key_version);
end;
$$;

-- First-time setup. Refuses if a key pair already exists, so a stolen session
-- cannot swap in a public key whose private half someone else holds.
create or replace function setup_vault(
  p_public_key                   text,
  p_wrapped_private_key          text,
  p_recovery_wrapped_private_key text,
  p_vault_salt                   text,
  p_kdf_params                   jsonb
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
begin
  update public.app_user set
    public_key                   = public._unb64(p_public_key, 'public_key', 32, 32),
    wrapped_private_key          = public._unb64(p_wrapped_private_key, 'wrapped_private_key', 72, 72),
    recovery_wrapped_private_key = public._unb64(p_recovery_wrapped_private_key,
                                                 'recovery_wrapped_private_key', 72, 72),
    vault_salt                   = public._unb64(p_vault_salt, 'vault_salt', 16, 16),
    kdf_params                   = public._vault_check_kdf_params(p_kdf_params),
    vault_key_version            = 1
  where id = v_uid and public_key is null;
  if not found then
    raise exception 'the vault is already set up' using errcode = '55000';
  end if;
end;
$$;

-- New passphrase (after unlocking with the old one or the recovery key).
-- Re-wraps the same private key; the public key and all secrets stay as they are.
create or replace function rewrap_vault_passphrase(
  p_wrapped_private_key text,
  p_vault_salt          text,
  p_kdf_params          jsonb
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
begin
  update public.app_user set
    wrapped_private_key = public._unb64(p_wrapped_private_key, 'wrapped_private_key', 72, 72),
    vault_salt          = public._unb64(p_vault_salt, 'vault_salt', 16, 16),
    kdf_params          = public._vault_check_kdf_params(p_kdf_params)
  where id = v_uid and public_key is not null;
  if not found then
    raise exception 'the vault is not set up yet' using errcode = '55000';
  end if;
end;
$$;

-- =========================================================
-- Saving: entry links (MCP server creates, vault page completes)
-- =========================================================

create or replace function create_secret_entry(
  p_space_id    uuid,
  p_secret_type text,
  p_name        text,
  p_url         text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_token text := public._vault_new_token();
  r       public.secret_entry_request;
begin
  if not exists (select 1 from public.app_user where id = v_uid and public_key is not null) then
    raise exception 'the vault is not set up yet' using errcode = '55000';
  end if;
  if not exists (select 1 from public.space where id = p_space_id and owner_user_id = v_uid) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_name), '') is null or length(p_name) > 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  if length(p_url) > 2000 then
    raise exception 'url is too long' using errcode = '22023';
  end if;
  perform public._vault_sweep(v_uid);

  insert into public.secret_entry_request
    (token_hash, user_id, space_id, secret_id, secret_type, name, url)
  values (public._vault_token_hash(v_token), v_uid, p_space_id, gen_random_uuid(),
          lower(btrim(p_secret_type)), btrim(p_name), nullif(btrim(p_url), ''))
  returning * into r;

  return jsonb_build_object('token', v_token, 'secret_id', r.secret_id, 'expires_at', r.expires_at);
end;
$$;

-- Re-entry link for a new value of an existing secret.
create or replace function create_secret_reentry(p_secret_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_token text := public._vault_new_token();
  s       record;
  r       public.secret_entry_request;
begin
  select se.id, se.space_id, se.secret_type, se.name, se.url into s
  from public.secret se join public.space sp on sp.id = se.space_id
  where se.id = p_secret_id and sp.owner_user_id = v_uid;
  if not found then
    raise exception 'secret not found' using errcode = 'P0002';
  end if;
  perform public._vault_sweep(v_uid);

  insert into public.secret_entry_request
    (token_hash, user_id, space_id, secret_id, is_update, secret_type, name, url)
  values (public._vault_token_hash(v_token), v_uid, s.space_id, s.id, true,
          s.secret_type, s.name, s.url)
  returning * into r;

  return jsonb_build_object('token', v_token, 'secret_id', r.secret_id, 'expires_at', r.expires_at);
end;
$$;

-- The open entry request behind a link, for the entry page (does not use it up).
create or replace function get_secret_entry_request(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
  r     record;
begin
  select q.*, sp.name as space_name, u.public_key, u.vault_key_version into r
  from public.secret_entry_request q
  join public.space sp on sp.id = q.space_id
  join public.app_user u on u.id = q.user_id
  where q.token_hash = public._vault_token_hash(p_token) and q.user_id = v_uid;
  if not found or r.used_at is not null or r.expires_at <= now() then
    raise exception 'this link has expired or was already used; ask the assistant for a new one'
      using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'secret_id', r.secret_id, 'is_update', r.is_update, 'secret_type', r.secret_type,
    'name', r.name, 'url', r.url, 'space', r.space_name, 'expires_at', r.expires_at,
    'public_key', public._b64(r.public_key), 'key_version', r.vault_key_version);
end;
$$;

-- Store the browser-made ciphertext. The metadata comes from the request row,
-- not from the page. Sealed box overhead is 48 bytes; values are capped at 64 KiB.
create or replace function complete_secret_entry(p_token text, p_payload_enc text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := public._vault_require_browser_session();
  v_payload bytea := public._unb64(p_payload_enc, 'payload_enc', 49, 65536);
  r         public.secret_entry_request;
  v_version int;
begin
  select * into r from public.secret_entry_request
  where token_hash = public._vault_token_hash(p_token) and user_id = v_uid
  for update;
  if not found or r.used_at is not null or r.expires_at <= now() then
    raise exception 'this link has expired or was already used; ask the assistant for a new one'
      using errcode = 'P0002';
  end if;
  select vault_key_version into v_version from public.app_user where id = v_uid;

  if r.is_update then
    update public.secret s set payload_enc = v_payload, key_version = v_version, updated_at = now()
    where s.id = r.secret_id
      and exists (select 1 from public.space sp where sp.id = s.space_id and sp.owner_user_id = v_uid);
    if not found then
      raise exception 'secret not found (was it deleted?)' using errcode = 'P0002';
    end if;
  else
    insert into public.secret (id, space_id, secret_type, name, url, payload_enc, key_version)
    values (r.secret_id, r.space_id, r.secret_type, r.name, r.url, v_payload, v_version);
  end if;

  update public.secret_entry_request set used_at = now() where id = r.id;
  perform public._vault_log(r.secret_id, v_uid,
                            case when r.is_update then 'update' else 'create' end, 'web', r.name);
  return jsonb_build_object('secret_id', r.secret_id, 'name', r.name, 'updated', r.is_update);
end;
$$;

-- =========================================================
-- Revealing: reveal links (MCP server creates, vault page uses)
-- =========================================================

create or replace function create_reveal_token(p_secret_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := public._vault_require_user();
  v_token text := public._vault_new_token();
  r       public.secret_reveal_token;
begin
  if not exists (
    select 1 from public.secret se join public.space sp on sp.id = se.space_id
    where se.id = p_secret_id and sp.owner_user_id = v_uid) then
    raise exception 'secret not found' using errcode = 'P0002';
  end if;
  perform public._vault_sweep(v_uid);

  insert into public.secret_reveal_token (token_hash, user_id, secret_id)
  values (public._vault_token_hash(v_token), v_uid, p_secret_id)
  returning * into r;
  return jsonb_build_object('token', v_token, 'expires_at', r.expires_at);
end;
$$;

-- What a reveal link is for, without using it up (the page asks for the
-- passphrase first, so a typo does not burn the link).
create or replace function get_reveal_request(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
  r     record;
begin
  select se.id, se.name, se.url, se.secret_type, sp.name as space_name, t.used_at, t.expires_at
    into r
  from public.secret_reveal_token t
  join public.secret se on se.id = t.secret_id
  join public.space sp on sp.id = se.space_id
  where t.token_hash = public._vault_token_hash(p_token)
    and t.user_id = v_uid and sp.owner_user_id = v_uid;
  if not found or r.used_at is not null or r.expires_at <= now() then
    raise exception 'this link has expired or was already used; ask the assistant for a new one'
      using errcode = 'P0002';
  end if;
  return jsonb_build_object('secret_id', r.id, 'name', r.name, 'url', r.url,
                            'secret_type', r.secret_type, 'space', r.space_name,
                            'expires_at', r.expires_at);
end;
$$;

-- Use the link: returns the ciphertext once and logs the reveal.
create or replace function reveal_secret(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._vault_require_browser_session();
  t     public.secret_reveal_token;
  s     public.secret;
begin
  select * into t from public.secret_reveal_token
  where token_hash = public._vault_token_hash(p_token) and user_id = v_uid
  for update;
  if not found or t.used_at is not null or t.expires_at <= now() then
    raise exception 'this link has expired or was already used; ask the assistant for a new one'
      using errcode = 'P0002';
  end if;
  select se.* into s from public.secret se join public.space sp on sp.id = se.space_id
  where se.id = t.secret_id and sp.owner_user_id = v_uid;
  if not found then
    raise exception 'secret not found' using errcode = 'P0002';
  end if;

  update public.secret_reveal_token set used_at = now() where id = t.id;
  update public.secret set last_accessed_at = now() where id = s.id;
  perform public._vault_log(s.id, v_uid, 'reveal', 'web', s.name);
  return jsonb_build_object('secret_id', s.id, 'name', s.name, 'url', s.url,
                            'secret_type', s.secret_type, 'key_version', s.key_version,
                            'payload_enc', public._b64(s.payload_enc));
end;
$$;

-- =========================================================
-- Metadata tools (MCP server)
-- =========================================================

-- Match secrets by name / url words. Security invoker: RLS and column grants
-- apply, and restricted spaces (and everything under them) are never searched.
create or replace function find_secrets(
  p_query       text default null,
  p_secret_type text default null,
  p_space_id    uuid default null,
  p_limit       int default 20
) returns table (
  secret_id        uuid,
  name             text,
  url              text,
  secret_type      text,
  space_id         uuid,
  created_at       timestamptz,
  updated_at       timestamptz,
  last_accessed_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  with recursive scope as (
    select id from space where id = p_space_id
    union all
    select s.id from space s join scope sc on s.parent_id = sc.id
  ),
  words as (
    select lower(w) as w
    from regexp_split_to_table(coalesce(btrim(p_query), ''), '\s+') w
    where w <> ''
  )
  select se.id, se.name, se.url, se.secret_type, se.space_id,
         se.created_at, se.updated_at, se.last_accessed_at
  from secret se
  where se.space_id in (select searchable_space_ids())
    and (p_space_id is null or se.space_id in (select id from scope))
    and (p_secret_type is null or se.secret_type = lower(btrim(p_secret_type)))
    and not exists (
      select 1 from words
      where position(words.w in lower(se.name || ' ' || coalesce(se.url, ''))) = 0)
  order by (lower(se.name) = lower(btrim(coalesce(p_query, '')))) desc, se.updated_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Rename / change the url. Null = unchanged; an empty url clears it.
create or replace function update_secret_meta(
  p_secret_id uuid,
  p_name      text default null,
  p_url       text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_name text;
begin
  if p_name is not null and (btrim(p_name) = '' or length(p_name) > 200) then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  if length(p_url) > 2000 then
    raise exception 'url is too long' using errcode = '22023';
  end if;
  update public.secret s set
    name       = coalesce(btrim(p_name), s.name),
    url        = case when p_url is null then s.url else nullif(btrim(p_url), '') end,
    updated_at = now()
  where s.id = p_secret_id
    and exists (select 1 from public.space sp where sp.id = s.space_id and sp.owner_user_id = v_uid)
  returning s.name into v_name;
  if not found then
    raise exception 'secret not found' using errcode = 'P0002';
  end if;
  perform public._vault_log(p_secret_id, v_uid, 'update', 'mcp', v_name);
end;
$$;

-- Hard delete (secrets have no history); the log row stays.
create or replace function delete_secret(p_secret_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := public._vault_require_user();
  v_name text;
begin
  delete from public.secret s
  where s.id = p_secret_id
    and exists (select 1 from public.space sp where sp.id = s.space_id and sp.owner_user_id = v_uid)
  returning s.name into v_name;
  if not found then
    raise exception 'secret not found' using errcode = 'P0002';
  end if;
  delete from public.secret_entry_request where secret_id = p_secret_id and user_id = v_uid;
  perform public._vault_log(p_secret_id, v_uid, 'delete', 'mcp', v_name);
  return jsonb_build_object('secret_id', p_secret_id, 'name', v_name, 'deleted', true);
end;
$$;

revoke execute on function
  vault_status(), get_vault_keys(),
  setup_vault(text, text, text, text, jsonb), rewrap_vault_passphrase(text, text, jsonb),
  create_secret_entry(uuid, text, text, text), create_secret_reentry(uuid),
  get_secret_entry_request(text), complete_secret_entry(text, text),
  create_reveal_token(uuid), get_reveal_request(text), reveal_secret(text),
  find_secrets(text, text, uuid, int), update_secret_meta(uuid, text, text), delete_secret(uuid)
  from public, anon;
grant execute on function
  vault_status(), get_vault_keys(),
  setup_vault(text, text, text, text, jsonb), rewrap_vault_passphrase(text, text, jsonb),
  create_secret_entry(uuid, text, text, text), create_secret_reentry(uuid),
  get_secret_entry_request(text), complete_secret_entry(text, text),
  create_reveal_token(uuid), get_reveal_request(text), reveal_secret(text),
  find_secrets(text, text, uuid, int), update_secret_meta(uuid, text, text), delete_secret(uuid)
  to authenticated;
