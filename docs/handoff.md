# Handoff: state of the project and how to keep building

Last updated 2026-09-30 evening (end of the session that built A2b "Share to Wilma" and A3a
vault unlock and reveal). Read this, then `CLAUDE.md`, `docs/design.md` and
`docs/phase3-mobile-app-plan.md`, before changing anything. The owner is returning to
development: explain steps plainly, keep PRs small, say clearly when they must act, never ask
for passwords, tokens or keys in chat.

## Where things stand (2026-09-30 evening)

| Piece | State |
|---|---|
| Database | migrations up to `recycle_bin` applied (unchanged this session) |
| MCP server `mcp` | version 7, server 0.5.0, 22 tools (unchanged this session) |
| Mobile app (Expo, `app/`) | merged to `main` up to PR #21: A0-A2a, delete/recycle bin, **A2b Share to Wilma (#17)**, **A3a vault unlock and reveal (#18, #20, #21)** |
| Latest app build | preview build of `main` at 232f0c9 (PR #21): https://expo.dev/accounts/zafnut/projects/wilma/builds/669fe922-9e26-4e01-b65e-30d7f78ae42e . **Owner confirmed on the phone: it opens, vault unlock (passphrase, then fingerprint) and reveal work, "looking solid".** |
| Supabase | checked 2026-09-30 19:35 UTC: ACTIVE_HEALTHY; auth, storage, `mcp` (401 without a token) all answer |

What the app does now: everything before (sign in, spaces, search, items, attachments, new
note with photos/Visio, delete, recycle bin), plus **Share to Wilma** from other Android apps
(photos, Visio, text or a link -> new note or add to an existing note; confirmed by the owner)
and the **vault**: list secrets by name, unlock with the vault passphrase then the fingerprint,
reveal (values hidden until Show, hidden again after 30 s, clipboard cleared after 30 s,
screenshots blocked on the secret screen), lock after 5 minutes or a minute away.

## Next task: A3b "save, change, delete secrets in the app"

Owner's decisions for the vault (2026-09-30): passphrase once then fingerprint; open 5 minutes;
values hidden until Show; **everything in the app**, split into A3a (done), A3b (this), A3c (set
up the vault, recover with the recovery key, change the passphrase). Plan for A3b:
- Save: `save_secret(space, name, secret_type, url?)` (MCP) returns `entry_link` (`.../enter#t=`),
  `secret.id`; the app then calls `get_secret_entry_request(p_token)` (gives `public_key`,
  `secret_id`, `secret_type`, `is_update`) and `complete_secret_entry(p_token, p_payload_enc)` with
  `crypto.sealSecret(public_key, secret_id, secret_type, fields)`, like `docs/vault/enter.js`.
  Saving needs only the public key, not an unlocked vault.
- Change a value: `update_secret(secret_id, new_value: true)` returns an entry link, same
  completion (is_update). Name/url changes: `update_secret(secret_id, name?, url?)`.
- Delete: `delete_secret(secret_id)` (hard delete, logged), with a confirm dialog.
- Field forms per type from `SECRET_FIELDS` in `src/lib/vaultCrypto.ts` (password fields masked
  with Show; single-line values kept exactly as typed, textareas trimmed at the end, empty fields
  left out, like enter.js). Add the three tools to `APP_TOOLS` in `src/lib/wilma.ts` (+ test).
- Keep testable logic in `src/lib/vaultFlow.ts` (like `revealSecret`), UI in `src/app/vault/`.
  Entry screens should also block screenshots (`usePreventScreenCapture`).
- No database or server change expected. New build required only if native code changes
  (A3b should be JavaScript only, but builds are still how the owner gets it).

After A3b: A3c (set up / recover / change passphrase in the app; `crypto.createVault`,
`unlockWithRecoveryKey`, `rewrapPassphrase` already exist and are tested against the web code;
SQL `setup_vault`, `rewrap_vault_passphrase`), then A4 Play release, A5 chat and voice.

## Owner status and open items

- Owner signs in to the app with **hassan.wehbe@gmail.com** (the only account in the project).
- Expo account `zafnut`, project `wilma` (id `f51dc24a-fef9-4f2a-8602-3fbe2e2c5deb`),
  `EXPO_TOKEN` GitHub secret set. Builds: GitHub **Actions -> app build -> Run workflow
  (preview)** on `main` (Claude starts it with the GitHub tools after the owner says "merge and
  build"); the free Expo queue often takes an hour or more. The owner installs from the
  expo.dev build page.
- Branches the owner may delete on GitHub (sessions cannot): `claude/revert-a3a` (unused
  backup), `claude/vault-crash-fix`, `claude/fix-startup-crash-screen-capture`,
  `claude/a3a-vault-unlock-reveal`, `claude/a2b-share-to-wilma`, `claude/handoff-2026-09-30`.
- Google Play personal developer account: not confirmed yet (needed at A4).
- Search cutoff (`CLOSE_MATCH_MAX_DISTANCE = 0.2`) was not calibrated on real data; loosen it
  if the owner reports missing results.
- The recycle bin never empties itself (owner's choice).
- `tests/browser/attachments_flow.mjs` still not run against the live project (needs a
  throwaway user; ask first).

## Lessons from this session (read before adding native packages)

- **The start-up crash (A3a builds #18 and #20):** `expo-screen-capture` registers
  `Activity.registerScreenCaptureCallback` in its module's `OnCreate`, i.e. when the app starts;
  on Android 14+ that throws without `DETECT_SCREEN_CAPTURE`, which `app.json` had put in
  `blockedPermissions`. Fixed in #21 (permission no longer blocked; `src/lib/appConfig.test.ts`
  guards it). **Before blocking a permission a library declares, read its Android code for what
  runs at start-up** (`OnCreate`, `OnActivityEntersForeground`): Expo modules are created when
  the app starts, not when first used.
- The first diagnosis (react-native-libsodium) was a guess and cost a build; PR #20 replaced it
  anyway (still an improvement): the vault uses `src/lib/sodiumLite.ts` (noble-sodium + @noble in
  plain JavaScript, Argon2id native in `react-native-quick-crypto`, a Nitro module), loaded on
  first vault use. `expo-doctor` flags "untested on New Architecture" packages; React Native 0.86
  runs only the New Architecture, so prefer Expo modules, Nitro or TurboModule packages.
- When the owner reports a crash, ask *when* it happens (at launch, on a screen, on an action),
  then look for code that runs at that moment; list what changed since the last working build.
  An adb logcat from the owner's computer would show the exception if guessing fails.
- The vault crypto is tested three ways: `sodiumLite.test.ts` (each function vs libsodium
  0.8.4), `vaultCrypto.test.ts` (the app's vault on sodiumLite vs the web `docs/vault/crypto.js`,
  both directions), `vaultFlow.test.ts` (lock rules, reveal steps). Jest maps the web vault's
  vendored libsodium to the `libsodium-wrappers-sumo` dev dependency and transforms `@noble`
  and `@serenity-kit` (ESM).
- Prebuild rewrites `package.json` scripts: copy `package.json` aside before
  `npx expo prebuild` and copy it back after (a `git checkout package.json` also throws away new
  dependencies not yet committed). Then `rm -rf android`.
- `npm run check` has 105 tests.

## History of this phase (details in the plan's "as built" notes)

- **A2b Share to Wilma** (PR #17): `expo-share-intent` (Android only; iOS extension off until
  phase B), own listener `src/lib/shareIntake.tsx` (the package's hook drops content:// links),
  files copied to the cache, one save flow `src/lib/saveNote.ts`. Confirmed on the phone.
- **A3a vault unlock and reveal** (PRs #18, #20, #21): see "Lessons from this session" above.

- **A1 read** (PR #11) + **Android session fix** (PR #12): on Android, expo-crypto's
  `AESSealedData.fromCombined` accepts only bytes (docs and iOS also accept base64), so the
  saved session could not be read. Lesson: native Expo APIs can differ from their docs by
  platform; read `node_modules/<pkg>/android` and `ios` when a call takes "string or bytes".
- **A1 polish** (PR #13): migration `search_cutoff` (optional `p_max_distance` on
  `search_items`; MCP `close_matches_only`, used by the app only), sign-in form above the
  keyboard, offline moments no longer sign out (`src/lib/sessionToken.ts`).
- **A2a** (PR #14): save notes and attach photos/Visio from the app; file rules ported from
  `docs/files/filetypes.js` with a cross-check test; camera permission only (microphone and
  storage blocked).
- **Delete and recycle bin** (PR #15): owner's decisions: deleted notes go to a recycle bin
  (restore / delete for good); only empty spaces can be deleted (the foreign keys cascade, so
  the check is essential). Migration `recycle_bin` (dry run `tests/sql/08_recycle_bin.sql`
  22/22), MCP tools listed above, app buttons and `app/src/app/bin.tsx`.

## Plan and decisions (phase 3)

`docs/phase3-mobile-app-plan.md`. Owner's decisions (2026-09-29): Expo (React Native) in
`app/`; Android first, iOS after, one codebase; package / bundle id **`com.zaf.wilma`**
(permanent after the first Play upload; nothing uploaded yet); personal Google Play account
for now; testing tracks first; chat and voice at A5 (the owner creates the Anthropic API key
then and puts it in Supabase secrets themselves); voice via the phone's built-in speech.

Working on `app/` in this sandbox:
- `docs.expo.dev` is blocked by the network policy (the owner may add it to the environment's
  allowed domains). Read the bundled package docs and `app/AGENTS.md`; add packages with
  `EXPO_OFFLINE=1 npx expo install <pkg>` (SDK-matched versions) from `app/`.
- Verify with `npm run check`, `npx expo config --type public`, `npx expo export --platform
  android`, and `npx expo prebuild --platform android --no-install` (then delete `android/`
  and restore the `android`/`ios` scripts in `package.json`, which prebuild rewrites).
- `expo-doctor`'s two online checks fail here; CI runs them. The build workflow can only be
  started for workflows already on `main` (GitHub returns 404 for a branch-only workflow).

## Open items from earlier (small, owner's call)

- Offered, not decided: Wilma asks "just the contents, or keep the photo too?" when a
  picture is shared without saying where it goes (a server-instructions change + redeploy).
- `tests/browser/attachments_flow.mjs` has not been run against the live project (needs a
  throwaway user; ask the owner first).
- The owner may delete merged branches on GitHub (Claude Code sessions cannot).

## Earlier work: attachments, step 1 (live)

Built in PR #7 as `docs/phase2-attachments-plan.md` describes
(see its "As built" section). Owner's decisions (2026-09-28): pictures `.jpg` / `.jpeg` / `.png`
and Visio (`.vsdx` text read on the upload page, `.vsd` stored only); **no AI keys** (Claude
writes picture descriptions in the chat); every upload starts in the chat with a space and
context; upload from phone or PC through a one-time link.

Done with the owner's go-ahead (2026-09-28): migration `attachments` applied (checked first in
a rolled-back dry run: `tests/sql/06_attachments.sql`, 47 checks), `mcp` v5 deployed (server
0.4.0, 17 tools), PR merged (GitHub Pages publishes `docs/files/upload.html`).

Still open: run `tests/browser/attachments_flow.mjs` against the live project with a throwaway
user (ask the owner first), and the owner tries "Wilma, attach this photo to …" in a new chat
(reconnect the connector if the new tools do not show up).

## What exists and is live

| Piece | Where | State |
|---|---|---|
| Database | Supabase project `digital-assistant`, ref `motvckmpusxiuelpwqxy` | migrations `initial_schema`, `knowledge_path`, `vault`, `cleanup_followups`, `assistant_name`, `attachments`, `search_cutoff`, `recycle_bin` applied; Storage bucket `attachments` |
| MCP server | Edge Function `mcp` (`supabase/functions/mcp/`), `https://motvckmpusxiuelpwqxy.supabase.co/functions/v1/mcp` | version 7 (server 0.5.0), 22 tools |
| Sign-in page | `docs/oauth/consent.html` → `https://hassan-wehbe.github.io/digital-assistant/oauth/consent` | used by the Claude connector (OAuth 2.1 via Supabase Auth) |
| Vault pages | `docs/vault/` → `https://hassan-wehbe.github.io/digital-assistant/vault/` | setup, enter, reveal, recover |
| Mobile app | `app/` (Expo), package `com.zaf.wilma`, Expo project `zafnut/wilma` | preview builds via GitHub Actions `app build`; latest build of PR #15 (see top) |
| Upload page | `docs/files/upload.html` → `https://hassan-wehbe.github.io/digital-assistant/files/upload` | live |
| Claude connector | "Digital Assistant" custom connector in the owner's Claude account | connected and in use (spaces Logins, Recipes exist) |

GitHub Pages publishes the **`/docs` folder of `main`** (not the repo root: with root, every
URL gains `/docs/` and both the connector sign-in and vault links 404).

Tools: `list_spaces`, `create_space`, `save_item`, `update_item`, `get_item`, `search_items`,
`link_items` (knowledge, M1); `save_secret`, `find_secret`, `get_secret`, `update_secret`,
`delete_secret` (vault, M2); `set_assistant_name` (invocation name, default Wilma; design.md D17).
Attachments (step 1): `attach_file`, `get_attachment_link`, `describe_attachment`, `delete_attachment`.
Deleting (recycle bin): `delete_item`, `list_deleted_items`, `restore_item`, `purge_item`, `delete_space`.

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
  Unit tests: `deno test -A --config supabase/functions/mcp/deno.json tests/deno` (62 tests).
  App: `cd app && npm ci && npm run check` (61 tests).
- **SQL tests** run through the Supabase connector (`execute_sql`), each wrapped in
  `begin; … rollback;` (`tests/sql/run.sh --print NN` builds the script). To check a new
  migration *before* applying it, prepend the migration to a test inside the same rolled-back
  transaction (dry run). **In a dry run, setup statements that run as the superuser see the
  owner's real rows** (e.g. a real "Recipes" space): always filter superuser lookups by the
  test user's id (`owner_user_id = '00000000-0000-4000-a000-00000000000a'`).
- **Deploying `mcp`** with the connector's `deploy_edge_function`: pass every file under
  `supabase/functions/mcp/` (not `deno.lock`), `verify_jwt: false`, and
  `import_map_path: "deno.json"` (without it the deploy fails on a stale import-map path).
  The file contents are pasted into the call, so **verify after deploying**: `get_edge_function`
  (its output is saved to a file; parse it with python) and compare every file with the repo
  (all must be identical; `deno.json` is not listed back). Then `curl` the function without a
  token: it must answer 401.
- **Rollout order for a feature with a migration + server change + app:** apply the migration
  (new functions/parameters are backward compatible), deploy `mcp`, then merge and build the
  app. Ask the owner first ("merge and deploy").
- **GitHub API quirks:** `merge_pull_request` can answer HTTP 500 for a clean PR; retry after a
  minute (it worked on the second try on 2026-09-30). `expectedHeadSha` must be the full SHA.
  To wait for a CI run or the build hand-off, poll the public API with curl in a Bash loop
  (`/repos/Hassan-Wehbe/digital-assistant/actions/workflows/app-build.yml/runs?per_page=1`); the
  expo.dev build link is in the job log (`get_job_logs`, last lines, "See logs: ...").
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

## Owner status (earlier notes)

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
