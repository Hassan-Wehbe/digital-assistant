# Phase 1, milestone 2: the vault (plan)

Status: built and deployed 2026-09-28 (migration `vault`, Edge Function `mcp` v3).
Owner setup and first password: `docs/phase1-m2-setup.md`. Differences from this plan: "As built" at the end.
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

## As built (differences from the plan, and why)

- **Libraries are vendored, not loaded from a CDN.** libsodium 0.8.4 (sumo, ES module
  build) and supabase-js 2.117.2 are copied into `docs/vault/vendor/` (versions and npm
  hashes in its README) and served by GitHub Pages with the pages. So the CSP is
  `script-src 'self' 'wasm-unsafe-eval'` with no third-party host at all; every script and
  module still carries an SRI hash (`node scripts/vault-sri.mjs` rewrites them,
  `tests/deno/vault_pages_test.ts` checks them).
- **Link tokens travel in the URL fragment** (`enter#t=…`, `reveal#t=…`), which browsers
  never send to a server (not to GitHub Pages, not in a Referer).
- **Vault-page functions refuse OAuth-client tokens.** `get_vault_keys`, `setup_vault`,
  `rewrap_vault_passphrase`, `get_secret_entry_request`, `complete_secret_entry`,
  `get_reveal_request` and `reveal_secret` raise if the JWT has a `client_id` claim (the
  Claude connector's token has one; the owner's own sign-in on the page does not). A
  leaked connector token cannot fetch ciphertext or replace keys.
- **Keys cannot be swapped.** `setup_vault` works once; afterwards only the
  passphrase-wrapped private key can be replaced (`rewrap_vault_passphrase`). Unlocking
  checks that the unwrapped private key matches the stored public key.
- **Reveal unlocks first.** The reveal page checks the passphrase before it uses the
  single-use link (`get_reveal_request` peeks without using it), so a typo costs nothing.
- **Plaintext format:** `{"v":1,"secret_id","type","fields":{…}}`, padded to 256-byte
  blocks before sealing so the ciphertext length does not reveal the password length.
- **Recovery key:** 32 random bytes + 2-byte checksum, base32, 11 groups of 5 characters;
  typos are detected. The recovery wrapping key is `crypto_kdf_derive_from_key(id 1,
  "DAvault1")`. Passphrases are Unicode-normalized (NFKC), at least 12 characters.
- **Access log outlives the secret:** `secret_access_log.secret_id` has no foreign key and
  keeps a `secret_name` snapshot, so a delete is logged too. Users can read their log but
  not write it; only the vault functions do. Channels: `web` (vault page), `mcp` (tools).
- **`payload_enc` and the wrapped keys are not selectable** by `authenticated` (column
  grants); all vault writes go through functions.
- **Restricted spaces:** `find_secret` and `get_secret` by name never see them;
  `get_secret` by id works, as `get_item` does in M1. Saving into them works.
- **Page files:** `docs/vault/` = `setup`, `enter`, `reveal`, `recover`, `index`, shared
  `app.js`, `crypto.js`, `vault.css`. `recover` also changes a known passphrase.
- **Tests:** `tests/sql/04_vault.sql` (64 checks), `tests/deno/vault_crypto_test.ts`,
  `vault_pages_test.ts`, `vault_tools_test.ts`; the end-to-end test is
  `tests/e2e/vault_e2e.ts` (Deno, so it can use the pages' `crypto.js`) instead of
  extending `e2e.py`; `tests/browser/vault_flow.mjs` drives the real pages in Chromium.
