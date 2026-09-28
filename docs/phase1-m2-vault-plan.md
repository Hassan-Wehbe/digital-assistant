# Phase 1, milestone 2: the vault (plan)

Status: planned 2026-09-28, owner decisions recorded below. Build in a new session.
Read first: `CLAUDE.md` (rules 1–4, 6), `docs/design.md` §5, `docs/phase1-m1-plan.md`.

## Decisions (owner, 2026-09-28)

1. **Encryption: option B (zero-knowledge).** Secrets are encrypted and decrypted
   only in the owner's browser. The database, the MCP server, Claude and the
   operator never hold plaintext or a usable key.
2. **Separate unlock passphrase**, distinct from the Supabase login password
   (Supabase sees the login password at sign-in, so it cannot be the vault key).
3. **Recovery key:** setup shows a random recovery key once (print it or keep it in
   a password manager). It can unlock the vault and set a new passphrase.
   Forgetting both passphrase and recovery key means the secrets are lost.
4. **Restricted-space session unlock: later milestone.** Not in M2.

## The key idea: plaintext never passes through chat

A password typed into the chat has already reached the model, so the vault
cannot take secrets through tool arguments either. Both directions go through a
**vault page** (static, GitHub Pages, next to the consent page):

- **Save:** "Store the Gartner sandbox login in Work." → Claude calls
  `save_secret` with metadata only (name, url, type, space) → the server returns a
  short-lived **entry link** → the owner opens it, types username/password on the
  page, the browser encrypts and uploads the ciphertext.
- **Reveal:** "Give me the Gartner sandbox login." → `get_secret` returns metadata
  plus a short-lived **reveal link** → the owner opens it, enters the unlock
  passphrase, the browser decrypts and shows the value (copy button, auto-hide).

If the owner pastes a secret into the chat anyway, Claude must not store it and
should say it has been exposed and ought to be rotated.

## Cryptography (libsodium in the browser)

Library: `libsodium-wrappers-sumo` (needed for Argon2id), pinned version, loaded
with Subresource Integrity. No home-grown crypto.

| Piece | Where it lives | How |
|---|---|---|
| Key pair (X25519) | public key: `app_user.public_key` (plaintext) | generated in browser at setup |
| Private key, passphrase-wrapped | `app_user.wrapped_private_key` | `secretbox` with KEK = Argon2id(passphrase, `vault_salt`, `kdf_params`) |
| Private key, recovery-wrapped | `app_user.recovery_wrapped_private_key` (new) | `secretbox` with key derived from the 256-bit recovery key |
| Secret payload | `secret.payload_enc` | `crypto_box_seal` to the owner's public key |

Why sealed boxes to the public key: **saving needs no passphrase** (the entry page
only needs the public key), while **revealing does**. The plaintext is JSON
`{"v":1,"secret_id":…,"type":…,…fields}`; the page checks `secret_id` on decrypt so
a ciphertext cannot be swapped onto another row. `key_version` tracks the key pair.
Argon2id parameters are stored per user (start: ops 3, mem 64 MB, fine on phones)
so they can be raised later. Passphrase change re-wraps the private key only.
Emergency access (later milestone) = private key sealed to the grantee's public key
(`emergency_access.wrapped_key`); space scoping there is enforced by RLS, not by
cryptography (noted trade-off).

## Database (new migration, `…_vault.sql`)

- `app_user`: add `vault_salt bytea`, `kdf_params jsonb`,
  `recovery_wrapped_private_key bytea`, `vault_key_version int`.
- `secret_entry_request`: `token_hash`, `user_id`, `space_id`, `secret_id`
  (pre-allocated, so the id can go inside the ciphertext), `secret_type`, `name`,
  `url`, `expires_at` (15 min), `used_at`; also used for "update" (re-entry).
- `secret_reveal_token`: `token_hash`, `user_id`, `secret_id`, `expires_at` (10 min), `used_at`.
- Column privileges: `authenticated` cannot `select payload_enc`; only
  `reveal_secret(token)` (security definer, checks owner + token, marks it used,
  writes `secret_access_log` 'reveal') returns it. `complete_secret_entry(token,
  payload_enc)` writes it (log 'create' / 'update'). Delete logs 'delete'.
- `find`-style functions return `name`, `url`, `secret_type`, space, dates only,
  and exclude restricted spaces (rule 3). Revoke `anon` on everything new.
- No path from `secret` to `item`, `item_chunk` or `item_share` (rules 2, 4).

## MCP tools

| Tool | Returns |
|---|---|
| `save_secret(space, name, secret_type, url?)` | entry link (15 min) + metadata |
| `find_secret(query?, secret_type?, space?)` | metadata list (name/url/type/space), restricted spaces excluded |
| `get_secret(secret_id or name)` | metadata + reveal link (10 min, single use) |
| `update_secret(secret_id, name?, url?, new_value?: bool)` | metadata change; `new_value` returns a re-entry link |
| `delete_secret(secret_id)` | confirmation (hard delete + access log row) |

Tool descriptions tell the model never to request or accept secret values.

## Vault pages (`docs/vault/`, GitHub Pages)

- `setup`: first-time key generation, passphrase, recovery key display + confirm.
- `enter?t=…`: type the secret (fields per `secret_type`), encrypt, upload.
- `reveal?t=…`: passphrase → decrypt → show / copy; clipboard cleared and value
  hidden after 30 s; nothing stored in localStorage.
- `recover`: recovery key → set a new passphrase.
- Hardening: strict Content-Security-Policy meta tag, SRI on every script, no
  third-party scripts beyond pinned supabase-js and libsodium, plaintext only in
  memory. Recommend branch protection on `main`, since whoever can change these
  pages could capture a passphrase.

## Tests (CLAUDE.md requirements + vault specifics)

- SQL (`tests/sql/`): two-user isolation for secrets and tokens; `payload_enc` not
  selectable by `authenticated`; tokens expire and are single use; every
  create/reveal/update/delete writes `secret_access_log`; `find` excludes restricted
  spaces; no secret text in `item_chunk`.
- Deno: crypto round-trips with libsodium (setup → seal → unwrap → open; wrong
  passphrase fails; recovery key path; swapped-ciphertext detection).
- Tool output: MCP responses never contain `payload_enc`, ciphertext or test
  plaintext (scan every response in the e2e run).
- `tests/e2e/e2e.py`: full save → enter → find → reveal flow with a throwaway user.

## Build order (each step reviewable)

1. Migration + SQL tests, apply (ask owner first).
2. Crypto module (shared by pages) + Deno crypto tests.
3. Vault pages (setup, enter, reveal, recover) + browser check.
4. MCP tools + deploy (ask owner first) + e2e.
5. Owner tutorial: set up the vault, save and reveal the first password.
