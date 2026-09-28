-- Small follow-ups after milestone 2 (docs/handoff.md, "Open follow-ups").
--
-- 1. Vault links: an expired or already-used link was refused with SQLSTATE
--    P0002, which the API turns into HTTP 500. The four functions the vault
--    pages call now raise PT410 (the API answers 410 Gone) for a dead link and
--    PT404 (404) for a secret that no longer exists. Messages are unchanged;
--    the MCP server never calls these functions.
-- 2. RLS policies call auth.uid() through (select auth.uid()), so Postgres
--    evaluates it once per query instead of once per row (advisor 0003).
--    Same conditions as before.
-- 3. Indexes on foreign keys that had none (advisor 0001).
--
-- create or replace keeps each function's existing grants; they are restated
-- below anyway (project rule: revoke anon, grant only authenticated).

-- =========================================================
-- 1. Vault link errors: 410 / 404 instead of 500
-- =========================================================

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
      using errcode = 'PT410';
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
      using errcode = 'PT410';
  end if;
  select vault_key_version into v_version from public.app_user where id = v_uid;

  if r.is_update then
    update public.secret s set payload_enc = v_payload, key_version = v_version, updated_at = now()
    where s.id = r.secret_id
      and exists (select 1 from public.space sp where sp.id = s.space_id and sp.owner_user_id = v_uid);
    if not found then
      raise exception 'secret not found (was it deleted?)' using errcode = 'PT404';
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
      using errcode = 'PT410';
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
      using errcode = 'PT410';
  end if;
  select se.* into s from public.secret se join public.space sp on sp.id = se.space_id
  where se.id = t.secret_id and sp.owner_user_id = v_uid;
  if not found then
    raise exception 'secret not found' using errcode = 'PT404';
  end if;

  update public.secret_reveal_token set used_at = now() where id = t.id;
  update public.secret set last_accessed_at = now() where id = s.id;
  perform public._vault_log(s.id, v_uid, 'reveal', 'web', s.name);
  return jsonb_build_object('secret_id', s.id, 'name', s.name, 'url', s.url,
                            'secret_type', s.secret_type, 'key_version', s.key_version,
                            'payload_enc', public._b64(s.payload_enc));
end;
$$;

revoke execute on function
  get_secret_entry_request(text), complete_secret_entry(text, text),
  get_reveal_request(text), reveal_secret(text)
  from public, anon;
grant execute on function
  get_secret_entry_request(text), complete_secret_entry(text, text),
  get_reveal_request(text), reveal_secret(text)
  to authenticated;

-- =========================================================
-- 2. RLS: evaluate auth.uid() once per query
-- =========================================================

alter policy app_user_self on app_user
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy space_owner on space
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and (parent_id is null or owns_space(parent_id)));
alter policy tag_owner on tag
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
alter policy item_shared_read on item
  using (exists (
    select 1 from item_share sh
    where sh.item_id = item.id
      and sh.shared_with_user_id = (select auth.uid())
      and sh.revoked_at is null
      and (sh.expires_at is null or sh.expires_at > now())));
alter policy item_share_owner on item_share
  using (shared_by_user_id = (select auth.uid()) and owns_item(item_id))
  with check (shared_by_user_id = (select auth.uid()) and owns_item(item_id));
alter policy item_share_recipient on item_share
  using (shared_with_user_id = (select auth.uid()));
alter policy emergency_grantor on emergency_access
  using (grantor_user_id = (select auth.uid())) with check (grantor_user_id = (select auth.uid()));
alter policy emergency_grantee_read on emergency_access
  using (grantee_user_id = (select auth.uid()));
alter policy secret_log_owner_read on secret_access_log
  using (user_id = (select auth.uid()));

-- =========================================================
-- 3. Indexes on unindexed foreign keys
-- =========================================================

create index if not exists space_parent_id_idx               on space (parent_id);
create index if not exists item_link_to_item_id_idx          on item_link (to_item_id);
create index if not exists item_tag_tag_id_idx               on item_tag (tag_id);
create index if not exists attachment_item_id_idx            on attachment (item_id);
create index if not exists item_chunk_attachment_id_idx      on item_chunk (attachment_id);
create index if not exists item_share_item_id_idx            on item_share (item_id);
create index if not exists item_share_shared_by_user_id_idx  on item_share (shared_by_user_id);
create index if not exists item_share_shared_with_user_id_idx on item_share (shared_with_user_id);
create index if not exists emergency_access_grantor_idx      on emergency_access (grantor_user_id);
create index if not exists emergency_access_grantee_idx      on emergency_access (grantee_user_id);
create index if not exists emergency_access_space_id_idx     on emergency_access (space_id);
create index if not exists secret_entry_request_space_id_idx on secret_entry_request (space_id);
