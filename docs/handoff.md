# Handoff: state of the project and how to keep building

Last updated 2026-10-02 (A5b steps 1-3: shared tools and instructions, the `ai_usage` migration,
the `chat` function built but not deployed).
Read this, then `CLAUDE.md`, `docs/design.md`, `docs/phase3-mobile-app-plan.md` and
`docs/phase5-chat-plan.md`, before changing anything. The owner is returning to development:
explain steps plainly, keep PRs small, say clearly when they must act, never ask for passwords,
tokens or keys in chat.

## Where things stand (2026-10-02)

**A5b, the `chat` function** (`docs/phase5-a5b-chat-function-plan.md`):
1. **Done, merged (#43):** one tool list (`mcp/tools/all.ts`) and one set of instructions
   (`_shared/assistant_prompt.ts`) for the MCP server, the evaluation and chat. The "new version
   replaces the old one" instruction is not yet confirmed by an evaluation run (the last run,
   55/56, missed exactly that). `mcp` not redeployed with this refactor (same behaviour; optional).
2. **Done, merged and applied (#44):** migration `20261002120000_ai_usage.sql` (27/27 checks in a
   rolled-back dry run): `ai_settings` (default $1/month), `ai_usage`, `record_ai_usage`,
   `my_ai_allowance`, personal limits, `is_admin` (the owner, $5 limit) and the admin functions.
3. **Built and merged, NOT deployed:** `supabase/functions/chat/` with `tests/deno/chat_test.ts`
   (21 tests). Protocol, rules and the deploy recipe: the plan's "As built: step 3". Merged (#46).
   Privacy page updated with the owner's approved chat wording (OpenAI, chat usage; 2026-10-02).
   Not yet confirmed against OpenAI's own data-controls page: the "up to 30 days for abuse
   monitoring" sentence; adjust if OpenAI says otherwise.
4. **Done, 2026-10-02: `chat` deployed** (version 2; a placeholder version 1 first proved that
   sibling-folder imports deploy). Deployed with the connector as the plan's "As built: step 3"
   says: 44 files named relative to `supabase/functions`, `entrypoint_path: "chat/index.ts"`,
   `import_map_path: "chat/deno.json"`, `verify_jwt: false`. Checked: 43 of 44 files identical to
   the repo (`mcp/lib/supabase-ai.d.ts`, types only, is not listed back, as for `mcp`); no sign-in
   and a fake token both answer 401. Live check on a throwaway user (then deleted by the owner in
   the dashboard; the connector's `execute_sql` timed out on the delete): streaming, status lines,
   a save, a vault-only message not counted, a delete that became a confirm card with the note
   untouched, 4 requests recorded at 0.108 cents (5 messages about 0.12 cents, so $1 is roughly
   2,000-4,000 messages), logs with ids, tool names and costs only. The app does not use `chat`
   yet (A5c). In this sandbox the owner had to approve calling the function and signing in the
   test user (Claude Code's safety check blocks both by default).
5. **Done, 2026-10-02:** evaluation re-run on the shared instructions with 3 new picture-upload
   cases (59 cases): **58/59, 0 leaks, 0 unsafe, $0.02** (run 37059170310). The "new version"
   instruction is confirmed; the one miss was the new case's check (fixed). Uploads are tested as
   the model setting them up (right note, upload link, no password copied from a picture): chat
   and the evaluation are text-only; the model seeing pictures is A5f.

**A5c progress (2026-10-04):** steps 2-7 done. The chat screen is **live for internal testers**
(Play versionCode 5, built from `main` at 61b1674, submitted 2026-10-04). The owner ran the phone
checklist (`docs/phase5-a5c-phone-checklist.md`): "looks good", but two layout bugs: the keyboard
covered the message box and Android's three-button bar covered it. Fixed in #60 (chat) and #61
(every screen) and merged, **not yet built**: the next Play build carries them. **Next:** a Play
build, then the owner re-checks chat, New note (Save button reachable), a form field near the
bottom while typing, the home search and the vault secret edit fields (the layout was verified by
lint, types, tests and a web bundle only, never on a device). Then A5d (the one box,
`docs/phase5-chat-plan.md`).

**Next (was):** A5c, the chat screen in the app (strongest model: new code in the chat path).
The A5c plan (for the owner's approval, 10 decisions): `docs/phase5-a5c-chat-screen-plan.md`.

| Piece | State |
|---|---|
| Database | migrations up to `ai_usage` applied (2026-10-02) |
| Chat function `chat` | **version 3, deployed 2026-10-03** (#54: the `vault` event carries `secret_type` and `new_secret`; 43/44 files identical, 401 without sign-in), first deployed 2026-10-02 (version 2, #46) and live-checked; `OPENAI_API_KEY` and `LLM_ROUTES` set in Supabase secrets by the owner (2026-10-02) |
| MCP server `mcp` | **version 8, server 0.6.0**, 22 tools, with the rule 9 credential check (PR #31, deployed 2026-10-01; deployed files checked identical to the repo, unsigned calls answer 401) |
| Mobile app (Expo, `app/`) | merged to `main` up to PR #61: A0-A3 and A5c (chat screen, delete and vault cards) complete. A3b secrets (#23), **A3c** spaces (#25), vault setup / recovery / passphrase change (#26), **A4** privacy + deletion pages and Play guide (#27), change sign-in password (#28), mascot app icon (#29, from another session), A5c chat screen (#50-#54), layout fixes (#60, #61). `npm run check`: 218 tests |
| Google Play | app created, **internal testing, versionCode 5 live** (built 2026-10-04 from `main` at 61b1674: https://expo.dev/accounts/zafnut/projects/wilma/builds/116e9645-4d8a-4ed6-9631-3a00ae6d7ee2 ; has the chat screen and the mascot icon, not the layout fixes #60/#61). Upload key reset done (see "Google Play and app updates"). App-content forms and store listing may still be incomplete; answers in `docs/phase4-play-release.md` |
| Web pages | `docs/legal/privacy.html`, `docs/legal/delete-account.html` live (contact zaftechlabs@gmail.com) |
| Supabase | ACTIVE_HEALTHY, region us-west-2 |

What the app does now: sign in (and change the sign-in password), spaces (create, nested,
delete when empty), search, items, attachments, notes with photos/Visio, recycle bin, Share to
Wilma, and the vault in full: set up (recovery key shown once), unlock (passphrase then
fingerprint), reveal, save / change / rename / delete secrets, change the passphrase, recover
with the recovery key. **Ask Wilma** (the chat screen, with delete and vault cards) is on the home screen.

## Trying the app in a browser (no phone, no build)

The app also runs as a web page (since `app/metro.config.js`, 2026-10-03), for a quick look at
work in progress. On a computer with Node.js: in `app/`, `npm ci`, then `npm run web:preview`
(builds the web version, then serves it at http://localhost:8080; Ctrl+C stops it); sign in with
your own Wilma account. (`npx expo start --web`, the live-reloading server, still fails on web:
expo-sqlite's worker is not bundled in that mode, Expo SDK 57.) Differences from the phone: no fingerprint (the vault unlocks
with the passphrase), screenshot blocking does nothing, and layout is close but not identical. The
phone checklist stays the final test before a Play build.

## Google Play and app updates (updated 2026-10-04)

- Wilma is on **Internal testing**, currently **versionCode 5**. Testers are the owner plus family
  and friends; the owner creates their Wilma accounts in Supabase.
- **Server changes** (the `mcp` and `chat` functions, migrations) reach everyone without an app
  update.
- **App changes, how to ship:** the owner says "merge and build for Play".
  1. Merge the reviewed PRs.
  2. GitHub Actions **app build**, profile `production` (.aab, versionCode goes up by itself).
     It runs `npm run check`, then asks Expo to build (`--no-wait`) **and to auto-submit** the
     build to Play when it finishes. The GitHub run only starts the build; follow it on
     expo.dev (Builds, Submissions).
  3. If the build was not submitted (or only the submit failed): GitHub Actions **app submit**
     (`.github/workflows/app-submit.yml`) with the Expo build id (empty = latest finished
     Android build). It runs `eas submit ... --non-interactive --no-wait`. This path is proven
     (run 1, submission 1adc0d57…). Do not run both for the same build: Play refuses a
     versionCode it already has.
  4. `submit.production.android.releaseStatus` in `app/eas.json` is `"completed"`: the release
     is published to internal testers without pressing Publish in Play Console. Set it to
     `"draft"` to publish by hand.
  5. Testers update through Google Play. The Expo website has no submit button, only a command.
- **Submission key (set up 2026-10-04).** Google Cloud project `wilma-play`, service account
  `expo-upload@wilma-play.iam.gserviceaccount.com`, invited in Play Console with "Release apps
  to testing tracks" for `com.zaf.wilma`; its JSON key is at expo.dev → Credentials → Android →
  com.zaf.wilma → **"Google Service Account Key for Play Store Submissions"**. Lesson: it was
  first uploaded under "FCM V1 service account key" (push notifications), and the build then
  failed with "Google Service Account Keys cannot be set up in --non-interactive mode". The FCM
  entry is unused and harmless. The key file is never in the repo or in chat.
- **Auto-submit from `app build` is not yet proven end to end:** its only run (18) failed before
  the key was in the right slot; the build itself went through and was submitted with `app
  submit`. The next production build will show whether `--auto-submit` works on its own.
- **Upload key.** The Expo credentials for `com.zaf.wilma` were deleted by mistake (2026-10-01),
  so EAS generated a new upload key for the next build; Google's upload-key reset was requested
  and became valid 2026-10-03 23:28 UTC, after which uploads work. (The helper workflow for
  extracting the certificate, #33, is on `main`; its follow-up #34 was closed, not needed.)
- **Preview .apk builds can no longer be installed over the Play version** (different signing
  key). Phones should use the Play version only.
- **Android layout lessons (A5c, #60/#61).** Expo SDK 57 draws the app edge to edge on Android:
  (1) every screen is padded at the bottom by the safe-area inset in `app/_layout.tsx` (otherwise
  the last button sits under the three-button bar); (2) `KeyboardAvoidingView` needs the
  header's height as its offset, so screens use `KeyboardScreen` from `components/ui.tsx`, never
  a bare `KeyboardAvoidingView`. The browser preview shows neither problem; only a device does.

## Rule 9 credential check (A5a step 1, built 2026-10-01)

`supabase/functions/mcp/lib/credentials.ts`, called first in `save_item`, `update_item`,
`attach_file` and `describe_attachment` (every text field: title, body, summary, tags, item
type, metadata keys and values, change note, attachment note and description). It refuses:
- well-known formats anywhere: Anthropic/OpenAI/GitHub/GitLab/AWS/Google/Slack/Stripe/
  Supabase/SendGrid keys, JWTs, private-key blocks, card numbers (network prefix + Luhn),
  `scheme://user:password@host`;
- labelled values: password/passcode/passphrase/pwd (also Passwort, mot de passe,
  contraseña, كلمة السر), Wi-Fi, PIN, door/gate/alarm codes, CVV, API key/token/secret, with
  `:`, `=`, `is`, `was`, `for X is`, `to`; plain-word passwords only when the value clearly ends
  the phrase ("Password: marigold", "the wifi password is sunshine.") or is first-person
  ("my password is fluffy and ...").

It lets through placeholders (`<password>`, `${DB_PASSWORD}`, `****`, `[YOUR-PASSWORD]`),
code and types (`password: z.string()`, `Uint8Array`), paths and links, and prose ("the
password is stored in the vault"). Run over this repo's own docs and code (about 1,400
paragraphs) it flagged only real-looking test values plus one known edge case: a JavaScript
ternary `x ? "passphrase" : "recovery"` reads like JSON `"password": "value"`.

The refusal ("Not saved: the body looks like it contains a password. ...") names only the
field and kind, never the value, points to `save_secret`, and suggests changing a value typed
into the chat. Nothing is saved, loaded or embedded when it fires. Tool errors are not logged.
Tests: `tests/deno/credentials_test.ts` (traps, false positives, through the tools).

## Owner's decisions this session (2026-09-30 / 10-01)

- Testing with the owner plus **family and friends** on Play **internal testing**. Each tester
  gets a Wilma account the owner creates in Supabase (sign-ups stay closed). Public contact
  email **zaftechlabs@gmail.com**.
- **A5 (chat and voice) comes before going public.**
- From another session (branch `design/vault-import`, merged in the A5-plan PR and renumbered
  after `main`'s D18): vault import D19, own app with AI built in D20, **provider-neutral
  model layer chosen by evaluation D21** (any provider's API key, not only Claude), pricing and
  budget D22, no search bar D23, memory D24, and **CLAUDE.md rule 9: security never depends on
  the model**. Rule 9's server check is built and live (PR #31, `mcp` version 8).

## Next task: A5a "safety net and evaluation" (`docs/phase5-chat-plan.md`)

1. Rule 9: `save_item` / `update_item` reject credential-looking content, with Deno tests.
   **Built and live** (PR #31, `mcp` version 8, server 0.6.0, deployed 2026-10-01).
2. `llm` module with Anthropic and OpenAI adapters (unit tests, no live calls). **Built** on
   branch `claude/a5a-llm-module` (`supabase/functions/_shared/llm/`, details in
   `docs/phase5-chat-plan.md` "The `llm` module"); nothing to deploy until the `chat` function.
3. The evaluation set and its runner: **built** (`tests/eval/`, 59 cases, 18 secret traps;
   `tests/eval/README.md`). It runs on a pretend account in memory behind the real tools, never on
   Supabase. Paid runs only with the owner's approval: GitHub Actions → "model evaluation".

Owner, before the first evaluation run: API accounts with a spend limit for the candidate
providers; keys as **GitHub repository secrets** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (for the
evaluation workflow), and later the same names in Supabase secrets (for the chat function).
Never in chat. Candidates in `tests/eval/models.json`: `luna` (`gpt-6-luna`, the
cheapest, released 2026-09-22; a first run with `gpt-6.0-luna` got "model not found" on every
case at no cost; the OpenAI project "Wilma" is
restricted to this one model), `haiku-4-5`, `sonnet-5-5-low`, `sonnet-5-5`; OpenAI prices were
found by web search on 2026-10-02 (OpenAI's pages are blocked from the sandbox), so compare a
run's cost with OpenAI → Settings → Usage. A model whose key is not set is skipped with a note.
Owner status 2026-10-02: OpenAI project "Wilma" with spend limits, restricted to
the GPT-6 Luna model, and an `OPENAI_API_KEY` created (in GitHub secrets per the owner's steps; not
verified from here). **Owner's decision: OpenAI/Luna only for now, no Anthropic key** while
Wilma's capabilities are tested; the eval workflow defaults to `luna`. What users see when a
limit is hit is decided: `docs/phase5-chat-plan.md` "What users see when a limit is hit". An
account out of credit is `llm` error `quota_exceeded` (not retried); the eval runner stops that
model and says so in the report.
First real results (Luna only): 52/56 twice, **0 leaks, 0 unsafe attempts**, about $0.27 per
1,000 requests, ~5 s per request; then 53/56; details in `docs/phase5-chat-plan.md` ("Results
so far"). The vault-search fix (`mcp` 0.6.1) needs an `mcp` deploy once merged. Also decide the per-person monthly limit for testers.

## Changing chat limits before the admin screen exists (after migration `ai_usage`)

Limits are in cents: 100 = $1. Changes apply from the next chat message; no deploy needed.

- **Default for everyone:** Supabase → Table editor → `ai_settings` → the one row →
  `default_monthly_limit_cents`.
- **One person:** Table editor → `app_user` → that person's row → `ai_monthly_limit_cents`
  (empty = use the default).
- **This month's usage:** Table editor → `ai_usage` (one row per person per month).
- **Admin:** `app_user.is_admin` is set by hand here too, for the owner only. Users can never
  change it, their own limit or their usage from the app.

## Owner status and open items

- Owner signs in to the app with **hassan.wehbe@gmail.com**. Testers' accounts: Supabase →
  Authentication → Users → Add user (Auto Confirm). To remove one: delete their Storage folder
  `attachments/<user id>/` first, then the user (the tables cascade; Storage does not).
- Expo account `zafnut`, project `wilma`, `EXPO_TOKEN` GitHub secret set. Builds: GitHub
  **Actions -> app build -> Run workflow** on `main`: `preview` (.apk for sideloading, "merge
  and build") or `production` (.aab for Play, "build for Play"; versionCode increments by
  itself). The owner uploads each `.aab` to Play Console by hand (internal testing → Create
  new release). **A Play install cannot update a sideloaded preview APK** (different signing
  key): uninstall the expo.dev APK first.
- Play listing images: `docs/play/icon-512.png` (= `app/assets/brand/play-store-icon-512.png`,
  the mascot) and `docs/play/feature-graphic.png`. The next production build carries the
  mascot icon (the current Play build still has the old "W").
- Suggested to the owner, not decided: Supabase Pro ($25/month) once family stores real data
  (daily backups, no pausing after 7 idle days).
- Branches the owner may delete on GitHub (sessions cannot delete branches): all merged
  `claude/*` branches (`revert-a3a`, `vault-crash-fix`, `fix-startup-crash-screen-capture`,
  `a3a-vault-unlock-reveal`, `a2b-share-to-wilma`, `handoff-2026-09-30`,
  `handoff-2026-09-30-evening`, `a3b-save-change-delete-secrets`, `plan-a3c-spaces`,
  `a3c-spaces`, `a3c-vault`, `a4-play-prep`, `a4-change-password`), `brand/wilma-mascot-icon`,
  `design/vault-import` and `claude/a5-plan-handoff` (PR #30 is merged).
- Search cutoff (`CLOSE_MATCH_MAX_DISTANCE = 0.2`) not calibrated on real data.
- The recycle bin never empties itself (owner's choice).
- `tests/browser/attachments_flow.mjs` still not run against the live project (throwaway user;
  ask first).

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
- `npm run check`: 105 tests after A3a, 117 after A3b, 129 after A4.

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
| MCP server | Edge Function `mcp` (`supabase/functions/mcp/`), `https://motvckmpusxiuelpwqxy.supabase.co/functions/v1/mcp` | version 8 (server 0.6.0), 22 tools |
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
  Unit tests: `deno test -A --config supabase/functions/mcp/deno.json tests/deno` (211 tests:
  rule 9 check, `llm` module, evaluation machinery and the `chat` function included). Type check:
  `deno check --config supabase/functions/chat/deno.json supabase/functions/chat/index.ts` (and the
  same with `mcp`). Deno refuses npm packages younger than 24 hours: pin
  an older version rather than turning the check off.
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
  (all must be identical; one file may not be listed back: `deno.json` before 2026-10-01,
  `lib/supabase-ai.d.ts`, which holds types only, on 2026-10-01). Then `curl` the function without a
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
