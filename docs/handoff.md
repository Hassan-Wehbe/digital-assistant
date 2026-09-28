# Handoff: state of the project and how to keep building

Last updated 2026-09-30: attachments step 1 built (not yet applied or deployed); before that
PRs #1-#6 (phase 1, cleanup, assistant name "Wilma", attachments plan).
Read this, then `CLAUDE.md` and `docs/design.md`, before changing anything.

## Current task: attachments, step 1 (built, waiting for the owner)

Built on branch `claude/zen-faraday-m5kjwc` as `docs/phase2-attachments-plan.md` describes
(see its "As built" section). Owner's decisions (2026-09-28): pictures `.jpg` / `.jpeg` / `.png`
and Visio (`.vsdx` text read on the upload page, `.vsd` stored only); **no AI keys** (Claude
writes picture descriptions in the chat); every upload starts in the chat with a space and
context; upload from phone or PC through a one-time link.

Remaining steps, each only with the owner's go-ahead:

1. Apply migration `20260930090000_attachments.sql` (dry-run checked: `tests/sql/06_attachments.sql`,
   44 checks, run inside a rolled-back transaction).
2. Deploy `mcp` (server 0.4.0, 17 tools): the new files are `lib/attachments.ts` and
   `tools/attach_file.ts`, `get_attachment_link.ts`, `describe_attachment.ts`, `delete_attachment.ts`.
3. Merge the PR, so GitHub Pages publishes `docs/files/upload.html` (the links point there).
4. Run `tests/browser/attachments_flow.mjs` with a throwaway user; then the owner tries
   "Wilma, attach this photo to …" in a new chat.

## What exists and is live

| Piece | Where | State |
|---|---|---|
| Database | Supabase project `digital-assistant`, ref `motvckmpusxiuelpwqxy` | migrations `initial_schema`, `knowledge_path`, `vault`, `cleanup_followups`, `assistant_name` applied |
| MCP server | Edge Function `mcp` (`supabase/functions/mcp/`), `https://motvckmpusxiuelpwqxy.supabase.co/functions/v1/mcp` | version 4 (server 0.3.0), 13 tools |
| Sign-in page | `docs/oauth/consent.html` → `https://hassan-wehbe.github.io/digital-assistant/oauth/consent` | used by the Claude connector (OAuth 2.1 via Supabase Auth) |
| Vault pages | `docs/vault/` → `https://hassan-wehbe.github.io/digital-assistant/vault/` | setup, enter, reveal, recover |
| Upload page | `docs/files/upload.html` → `https://hassan-wehbe.github.io/digital-assistant/files/upload` | built, live after merge |
| Claude connector | "Digital Assistant" custom connector in the owner's Claude account | connected and in use (spaces Logins, Recipes exist) |

GitHub Pages publishes the **`/docs` folder of `main`** (not the repo root: with root, every
URL gains `/docs/` and both the connector sign-in and vault links 404).

Tools: `list_spaces`, `create_space`, `save_item`, `update_item`, `get_item`, `search_items`,
`link_items` (knowledge, M1); `save_secret`, `find_secret`, `get_secret`, `update_secret`,
`delete_secret` (vault, M2); `set_assistant_name` (invocation name, default Wilma; design.md D17).
Built, not deployed yet: `attach_file`, `get_attachment_link`, `describe_attachment`,
`delete_attachment` (attachments step 1).

## Key design decisions (details in the docs named)

- Knowledge path (`docs/phase1-m1-plan.md`): one `item` table, gte-small embeddings (384)
  computed inside the Edge Function, hybrid search (`search_items` SQL, RRF), revisions on
  edit, restricted spaces never searched. Each request runs as the user (JWT forwarded, RLS).
- Vault (`docs/phase1-m2-vault-plan.md`, see "As built"): zero-knowledge. Secrets are
  libsodium sealed boxes to the owner's X25519 public key, encrypted/decrypted only in the
  browser on the vault pages. Private key wrapped by Argon2id(passphrase) and by a recovery
  key. Values never pass through chat or tool results: tools return one-time `#t=` links
  (entry 15 min, reveal 10 min, stored as SHA-256). Vault-page SQL functions refuse tokens
  with a `client_id` claim (the connector's OAuth token). `payload_enc` and wrapped keys are
  not selectable by `authenticated`.
- Vault pages load only same-origin code: libsodium 0.8.4 and supabase-js 2.117.2 are
  vendored in `docs/vault/vendor/`; strict CSP; SRI hashes on every script/module.

## Rules that must hold (CLAUDE.md)

Secrets never reach the model, logs or embeddings; restricted spaces invisible to search;
sharing never touches secrets; RLS everywhere; no credentials in the repo or chat; revisions
on edit; soft delete items. Every new table/function: revoke `anon`, grant only what
`authenticated` needs. Migrations live in `supabase/migrations/` (new file per change; never
edit an applied one).

## How to work on it (practical notes for a Claude Code cloud session)

- **Ask the owner before applying a migration or deploying the Edge Function.** The owner is
  returning to development: explain steps plainly, stop when they must act, and never ask
  them to paste a password, passphrase, recovery key or API key into chat.
- **Branches:** `main` is protected (pull request required, no force push). Work on a branch,
  open a PR, merge when the owner agrees.
- **Deno** is not preinstalled: `npm i -g deno`, then set `DENO_CERT=/root/.ccr/ca-bundle.crt`.
  Unit tests: `deno test -A --config supabase/functions/mcp/deno.json tests/deno` (56 tests).
- **SQL tests** run through the Supabase connector (`execute_sql`), each wrapped in
  `begin; … rollback;` (`tests/sql/run.sh --print NN` builds the script). To check a new
  migration *before* applying it, prepend the migration to a test inside the same rolled-back
  transaction (dry run).
- **Deploying `mcp`** with the connector's `deploy_edge_function`: pass every file under
  `supabase/functions/mcp/` (not `deno.lock`), `verify_jwt: false`, and
  `import_map_path: "deno.json"` (without it the deploy fails on a stale import-map path).
- **After editing anything in `docs/vault/`, `docs/oauth/` or `docs/files/`:** `node scripts/vault-sri.mjs`
  (updates the SRI hashes); `tests/deno/vault_pages_test.ts` fails if you forget.
- **Attachments:** Storage uploads in SQL tests are simulated by inserting the `storage.objects`
  row as the user (the Storage policies apply). A test that deletes and then checks must use two
  statements (one statement sees the snapshot from before the delete).
- **End-to-end / browser tests** (`tests/e2e/vault_e2e.ts`, `tests/browser/vault_flow.mjs`)
  need a throwaway user: create it with SQL in `auth.users` + `auth.identities`
  (email `…@example.invalid`, random password), run, then `delete from auth.users` for it.
  Never use the owner's account.
- **Sandbox network:** cdn.jsdelivr.net and hassan-wehbe.github.io are blocked (check Pages
  builds via the GitHub Actions run logs instead); `*.supabase.co` and npm work. Chromium via
  Playwright needs `--proxy-server=$HTTPS_PROXY` and, to trust the sandbox proxy's CA only,
  `--ignore-certificate-errors-spki-list=<sha256 SPKI of /root/.ccr/agent-proxy-ca.crt>`.
  Serve pages locally with `python3 tests/browser/serve.py docs`.

## Owner status

- Connector connected and in use. Vault set up (checked 2026-09-28); recommend they test
  the recovery key once on `/vault/recover`.
- `main` is protected; GitHub Pages builds from `main`, folder `/docs` (confirmed 2026-09-28,
  build #7 onward).
- Assistant name: Wilma (default), live since `mcp` v4. The owner should try "Wilma, …" in a
  new chat; if it is not picked up, disconnect and reconnect the connector.
- The old branch `claude/festive-fermat-fg6i75` is fully merged; the owner deletes it on
  GitHub (Claude Code sessions cannot delete other branches: HTTP 403).

## Open follow-ups (small)

- Done (applied 2026-09-28) in `20260929090000_cleanup_followups.sql` and the sign-in page cleanup: dead vault
  links answer HTTP 410 (PT410) instead of 500, RLS policies use `(select auth.uid())`,
  foreign keys are indexed, `docs/oauth/` loads only same-origin code (vendored
  supabase-js, strict CSP, SRI via `node scripts/vault-sri.mjs`), CLAUDE.md names
  `supabase/migrations/` as the source of truth.
- Advisor items left on purpose: `owns_*` and vault functions "callable by signed-in
  users" (they only answer for the caller; RLS needs them), token tables with RLS and
  no policies, "multiple permissive policies" (owner + share policies), unused indexes
  (the data set is still tiny). Leaked-password protection is a paid-plan Auth setting.

## Roadmap (docs/design.md §6)

- Restricted-space session unlock (make restricted spaces reachable when named and unlocked).
- Attachments: step 1 built (above); later TIFF, audio/video transcripts, automatic picture
  descriptions, a cleanup for files uploaded but never recorded, and item purge (must delete files).
- Emergency access for a trusted person (dormant grant + waiting period; private key sealed
  to the grantee).
- Item sharing (view/edit, expiry); reminders (`secret.expires_at`, follow-ups).
- Phase 3: voice input, Hermes/Telegram front end, web UI.
