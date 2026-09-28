-- Digital Assistant: phase 1 schema for Supabase (Postgres 15+).
-- Readable overview; see docs/design.md for reasoning. It started as the initial
-- migration (supabase/migrations/20260928120000_initial_schema.sql). Later changes
-- live in newer migration files, which are the source of truth: exact current
-- policies, functions and indexes are there, not necessarily here.

-- Supabase keeps extensions in the `extensions` schema (on the default search_path).
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;  -- gen_random_uuid()

-- =========================================================
-- People and access
-- =========================================================

create table app_user (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null unique,
  display_name         text,
  public_key           bytea,            -- X25519 vault public key (secrets are sealed to it)
  wrapped_private_key  bytea,            -- encrypted with the user's unlock key; never plaintext
  -- Added by 20260928170000_vault.sql (zero-knowledge vault, docs/phase1-m2-vault-plan.md):
  --   vault_salt bytea, kdf_params jsonb (Argon2id settings),
  --   recovery_wrapped_private_key bytea, vault_key_version int
  -- Added by 20260929100000_assistant_name.sql: assistant_name text not null
  --   default 'Wilma' (what the owner calls the assistant; design.md D17)
  created_at           timestamptz not null default now()
);

-- =========================================================
-- Organization
-- =========================================================

create table space (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references app_user (id) on delete cascade,
  parent_id      uuid references space (id) on delete cascade,
  name           text not null,
  description    text,
  is_restricted  boolean not null default false,
  created_at     timestamptz not null default now(),
  unique nulls not distinct (owner_user_id, parent_id, name)
);
create index space_owner_idx on space (owner_user_id);

create table emergency_access (
  id               uuid primary key default gen_random_uuid(),
  grantor_user_id  uuid not null references app_user (id) on delete cascade,
  grantee_user_id  uuid not null references app_user (id) on delete cascade,
  space_id         uuid references space (id) on delete cascade,  -- null = all spaces
  wrapped_key      bytea,          -- grantor's data key wrapped with grantee's public key
  wait_days        int not null default 7 check (wait_days between 0 and 90),
  status           text not null default 'invited'
                   check (status in ('invited','accepted','requested','granted','denied','revoked')),
  requested_at     timestamptz,
  granted_at       timestamptz,
  created_at       timestamptz not null default now(),
  check (grantor_user_id <> grantee_user_id)
);

create table tag (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references app_user (id) on delete cascade,
  name           text not null,
  unique (owner_user_id, name)
);

-- =========================================================
-- Knowledge and RAG
-- =========================================================

create table item (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references space (id) on delete cascade,
  item_type      text not null,                 -- design, recipe, note, ...
  title          text not null,
  body_markdown  text not null default '',
  summary        text,
  metadata       jsonb not null default '{}'::jsonb,
  source         text not null default 'typed' check (source in ('typed','voice','import')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index item_space_idx on item (space_id) where deleted_at is null;
create index item_fts_idx on item
  using gin (to_tsvector('english', title || ' ' || body_markdown));

create table item_revision (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references item (id) on delete cascade,
  revision_number  int not null,
  title            text not null,
  body_markdown    text not null,
  metadata         jsonb not null,
  change_note      text,
  created_at       timestamptz not null default now(),
  unique (item_id, revision_number)
);

create table attachment (
  id                     uuid primary key default gen_random_uuid(),
  item_id                uuid not null references item (id) on delete cascade,
  storage_key            text not null,       -- Supabase Storage object path
  original_filename      text not null,
  mime_type              text not null,
  extracted_description  text,                -- picture description written by Claude in the chat
  created_at             timestamptz not null default now()
  -- Added by 20260930090000_attachments.sql (docs/phase2-attachments-plan.md):
  --   size_bytes bigint (from Storage), caption text (owner, upload page),
  --   extracted_text text (.vsdx text read on the upload page).
  -- Written only by the attachment functions; storage_key is
  -- <user id>/<attachment id>/<file name> in the private bucket `attachments`.
);

create table item_chunk (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references item (id) on delete cascade,
  attachment_id  uuid references attachment (id) on delete cascade,
  chunk_index    int not null,
  content        text not null,
  embedding      vector(384),   -- gte-small; change before loading data if model changes
  unique nulls not distinct (item_id, attachment_id, chunk_index)
);
create index item_chunk_embedding_idx on item_chunk
  using hnsw (embedding vector_cosine_ops);

create table item_tag (
  item_id  uuid not null references item (id) on delete cascade,
  tag_id   uuid not null references tag (id) on delete cascade,
  primary key (item_id, tag_id)
);

create table item_link (
  from_item_id  uuid not null references item (id) on delete cascade,
  to_item_id    uuid not null references item (id) on delete cascade,
  relation      text not null check (relation in ('supersedes','related')),
  primary key (from_item_id, to_item_id, relation),
  check (from_item_id <> to_item_id)
);

-- Items only. There is intentionally no path from here to secret.
create table item_share (
  id                   uuid primary key default gen_random_uuid(),
  item_id              uuid not null references item (id) on delete cascade,
  shared_by_user_id    uuid not null references app_user (id) on delete cascade,
  shared_with_user_id  uuid not null references app_user (id) on delete cascade,
  permission           text not null default 'view' check (permission in ('view','edit')),
  expires_at           timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz not null default now(),
  check (shared_by_user_id <> shared_with_user_id)
);

-- =========================================================
-- Vault (never embedded, never returned to the model)
-- =========================================================

create table secret (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references space (id) on delete cascade,
  secret_type       text not null
                    check (secret_type in ('login','api_key','wifi','recovery_codes','note')),
  name              text not null,     -- plaintext, searchable
  url               text,              -- plaintext, searchable
  payload_enc       bytea not null,    -- encrypted JSON; shape depends on secret_type
  key_version       int not null default 1,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_accessed_at  timestamptz
);
create index secret_space_idx on secret (space_id);

-- 20260928170000_vault.sql: secret_id has no foreign key (the log outlives a
-- deleted secret) and a secret_name snapshot column is added; users can only
-- read their own rows, the vault functions write them.
create table secret_access_log (
  id           uuid primary key default gen_random_uuid(),
  secret_id    uuid not null references secret (id) on delete cascade,
  user_id      uuid not null references app_user (id) on delete cascade,
  action       text not null check (action in ('create','reveal','update','delete')),
  channel      text not null,   -- web, claude, telegram, ...
  occurred_at  timestamptz not null default now()
);

-- =========================================================
-- Row Level Security: every table on, owner-scoped.
-- The MCP server should act as the signed-in user (user JWT), not service role.
-- =========================================================

create or replace function owns_space(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from space where id = s and owner_user_id = auth.uid());
$$;

create or replace function owns_item(i uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from item it join space sp on sp.id = it.space_id
    where it.id = i and sp.owner_user_id = auth.uid());
$$;

alter table app_user          enable row level security;
alter table space             enable row level security;
alter table emergency_access  enable row level security;
alter table tag               enable row level security;
alter table item              enable row level security;
alter table item_revision     enable row level security;
alter table attachment        enable row level security;
alter table item_chunk        enable row level security;
alter table item_tag          enable row level security;
alter table item_link         enable row level security;
alter table item_share        enable row level security;
alter table secret            enable row level security;
alter table secret_access_log enable row level security;

create policy app_user_self on app_user
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy space_owner on space
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy tag_owner on tag
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy item_owner on item
  for all using (owns_space(space_id)) with check (owns_space(space_id));

-- Recipients of an active share can read the shared item.
create policy item_shared_read on item
  for select using (exists (
    select 1 from item_share sh
    where sh.item_id = item.id
      and sh.shared_with_user_id = auth.uid()
      and sh.revoked_at is null
      and (sh.expires_at is null or sh.expires_at > now())));

create policy item_revision_owner on item_revision
  for all using (owns_item(item_id)) with check (owns_item(item_id));
create policy attachment_owner on attachment
  for all using (owns_item(item_id)) with check (owns_item(item_id));
create policy item_chunk_owner on item_chunk
  for all using (owns_item(item_id)) with check (owns_item(item_id));
create policy item_tag_owner on item_tag
  for all using (owns_item(item_id)) with check (owns_item(item_id));
create policy item_link_owner on item_link
  for all using (owns_item(from_item_id) and owns_item(to_item_id))
  with check (owns_item(from_item_id) and owns_item(to_item_id));

create policy item_share_owner on item_share
  for all using (shared_by_user_id = auth.uid() and owns_item(item_id))
  with check (shared_by_user_id = auth.uid() and owns_item(item_id));
create policy item_share_recipient on item_share
  for select using (shared_with_user_id = auth.uid());

create policy emergency_grantor on emergency_access
  for all using (grantor_user_id = auth.uid()) with check (grantor_user_id = auth.uid());
create policy emergency_grantee_read on emergency_access
  for select using (grantee_user_id = auth.uid());
-- Grantee status transitions (accept, request) go through a security-definer
-- function in a later migration, not a broad update policy.

create policy secret_owner on secret
  for all using (owns_space(space_id)) with check (owns_space(space_id));

create policy secret_log_owner_read on secret_access_log
  for select using (exists (
    select 1 from secret s where s.id = secret_id and owns_space(s.space_id)));
create policy secret_log_insert on secret_access_log
  for insert with check (user_id = auth.uid());

-- =========================================================
-- Vault links (20260928170000_vault.sql). Single-use, short-lived, stored as
-- SHA-256 hashes; reachable only through the vault functions (RLS on, no policies).
-- =========================================================
-- secret_entry_request: token_hash, user_id, space_id, secret_id (pre-allocated),
--   is_update, secret_type, name, url, expires_at (15 min), used_at
-- secret_reveal_token:  token_hash, user_id, secret_id -> secret, expires_at (10 min), used_at

-- =========================================================
-- Upload links (20260930090000_attachments.sql). Same pattern as the vault links.
-- =========================================================
-- attachment_upload_request: token_hash, user_id, item_id -> item, description (Claude's),
--   upload_ids uuid[] (30 attachment ids reserved for the link), expires_at (15 min), used_at,
--   files_attached
-- Storage bucket `attachments`: private, 20 MB per file, image/png, image/jpeg,
--   application/vnd.ms-visio.drawing (.vsdx), application/vnd.visio (.vsd). Policies on
--   storage.objects: read/delete own folder; upload only to an id reserved by an open upload
--   link, and only from a browser session (not the connector's token).
