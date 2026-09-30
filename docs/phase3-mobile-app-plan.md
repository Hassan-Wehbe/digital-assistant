# Phase 3, step 1: the Wilma mobile app (plan)

Status: A0 (project setup) built, see `app/README.md` and `docs/phase3-mobile-app-setup.md`;
A1 (read), A2a, A2b, A3a and A3b built and confirmed on the phone; A3c (spaces, vault setup/recovery/passphrase) built, see the "as built" notes below; A4 (Play internal testing) in progress. Owner direction (2026-09-28): a real app, **publishable on Android
first and iOS after, from one codebase with minimal changes**. PC and Mac use a web page (no
install); an installed desktop app with background "Hey Wilma" may come later from the same
code. Read first: `CLAUDE.md`, `docs/design.md`, `docs/phase2-attachments-plan.md`.

## The experience: one Wilma, no modes (owner's direction, 2026-09-30)

**Value proposition:** you tell Wilma what you want, in your own words, typed or spoken, and
it happens. If you have to decide *how* to ask ("is this a search or a chat?", "which screen
does this go on?"), the assistant has failed. Everything below serves that.

- **One box, and a microphone.** The box at the top of the home screen *is* Wilma. Anything
  goes: "soup", "what's the cottage Wi-Fi password", "save this photo to Recipes, it's
  grandma's lentil soup", "delete the old one". There is no search mode, chat mode or
  button to choose between them.
- **Something useful at once, the answer right after.** Matching notes appear instantly (the
  existing search, free and private) while Wilma works out whether a real answer or an action
  is needed; if so, its reply appears under the matches a moment later. Never a blank wait.
- **Actions just happen, with a safety net.** Saving, attaching, moving happen directly and
  show the result. Anything destructive asks first (and deleted notes go to the recycle bin);
  passwords are only ever shown in the vault on the phone, never in the conversation.
- **It keeps the thread.** "Delete the old one" works because Wilma knows what was just shown.
- **The same Wilma everywhere:** the box, voice, the Share menu, and later "Hey Wilma",
  Telegram and the PC/Mac web page all feed the same conversation and the same tools.
- **The routing is invisible.** Behind the box a router decides, per message, what is needed.
  It is a speed and cost optimisation the user never sees (details under A5); when in doubt it
  goes to Wilma, because getting it right matters more than saving a cent.
- **No surprise bills.** A monthly AI budget the owner sets (for example $5 or $10), with a
  quiet warning near the limit; searches and browsing never count against it.
- **Browsing stays.** Spaces, notes, attachments and the recycle bin remain one tap away for
  when the owner wants to look around rather than ask.

## What the app adds over the Claude app

The Claude app already reaches Wilma on every platform. The app is for what it cannot do:

- Pictures and Visio files go straight in (camera, gallery, files, or **Share to Wilma** from
  any other app), with no upload link and no picking the file twice.
- The vault inside the app: save and reveal secrets with the same passphrase, no browser tab.
- Browse spaces and items, not only ask about them.
- The one box (A5): ask, save and act in plain words or by voice, without choosing a mode.
- Later: notifications (reminders).

## Technology

| Piece | Choice | Why |
|---|---|---|
| App framework | **Expo (React Native, TypeScript)** | One codebase builds the Android app, the iOS app and (later) the PC/Mac web page. Same language as the rest of the repo. |
| Builds and store upload | **EAS Build / EAS Submit** (Expo's build service) | Builds the Android and iOS packages in the cloud (no Mac needed for iOS builds) and sends them to the stores. Free tier is enough to start. |
| Sign-in | Supabase Auth (same account), session kept in the phone's secure storage (`expo-secure-store`) | Same account as the vault pages. |
| Wilma's tools | The app calls the **existing MCP server** (`/functions/v1/mcp`) with the signed-in user's token | Reuses every rule already built and tested: spaces, search (with embeddings), items, attachments, vault links. No second copy of the logic. |
| Files | `expo-image-picker` (camera, gallery), `expo-document-picker` (Visio), a share-target module for "Share to Wilma" | The app uploads with the same one-time-link flow as the upload page (`attach_file`, then Storage, then `complete_attachment_upload`), but does all of it itself: you pick the file once. |
| Vault | `react-native-libsodium` with the same format as `docs/vault/crypto.js` (sealed boxes, Argon2id, same key wrapping) | Secrets saved on the web open in the app and the other way round. The passphrase and decrypted values never leave the phone. |
| Tests | Jest for app logic; a shared set of vault test vectors checked by both the web crypto tests and the app | Proves the two vault implementations stay compatible. |

The app lives in a new folder, `app/`, next to the existing code. Nothing in `docs/`,
`supabase/` or the database changes for the first milestones.

## How the pieces connect

```
 Phone app (Expo)
   ├── Supabase Auth ─────────────── sign in (same account)
   ├── MCP server (existing) ─────── list/search/get/save items, attach_file, vault links
   ├── Supabase Storage ──────────── file upload (same bucket, same one-time-link rules)
   ├── Database functions ────────── vault page functions (browser-session only, as today)
   └── later: chat function ──────── Claude API + the same MCP tools (needs an API key)
```

The app signs in with email and password, like the vault pages, so its token is a normal
session (no `client_id`). That is what the vault functions and the Storage upload rule
already expect, so **no database change is needed** for milestones A1-A3.

## Milestones (Android first)

Each is one PR, tested, and approved by the owner before the next.

- **A0 Project setup.** Expo project in `app/`, TypeScript, lint and tests, EAS project,
  app name, icon and package id. Owner: create an Expo account (free) and a Google Play
  developer account ($25 once).
- **A1 Read.** Sign in, list spaces, search, open an item with its attachments, download
  link for an attachment.
  **A1 as built:** sign-in with supabase-js (email + password); the session is encrypted with
  AES-256-GCM (`expo-crypto`) and kept in the app's local store (`expo-sqlite` key-value
  store), with the key in the phone's keystore (`expo-secure-store`, this device only, left
  out of backups); SecureStore alone holds only small values. Screens (Expo Router, signed-out
  users see only sign-in): home (spaces, search), space (its items via `search_items` with the
  space), item (`get_item`: text, tags, attachments, linked items), download
  (`get_attachment_link`, opened in the phone's browser, never stored or logged). The app
  calls only `list_spaces`, `search_items`, `get_item`, `get_attachment_link`
  (`app/src/lib/wilma.ts`, plain JSON-RPC `tools/call`, one token refresh and retry on 401).
  Restricted spaces are listed with a lock and not opened. No database or server change.
  After the owner's phone test: an Android fix for reading the saved session (#12); the
  home search asks for close matches only (migration `search_cutoff`, MCP 0.4.1); sign-in
  form stays above the keyboard; offline moments no longer sign you out.
- **A2 Save and attach** (split: **A2a** save and attach inside the app, built; **A2b** the
  Android share menu, built). Save a note; attach from camera, gallery, files and the Android
  share menu (the same checks as the upload page: type from the first bytes, 20 MB, Visio
  text read on the phone).
  **A2a as built:** "New note or photo" (home) and "New note here" (space) open a form: space,
  title, note, and optional pictures/Visio files with a caption each. Without files it calls
  `save_item`; with files, `attach_file` with space + title + note creates the note and returns
  the upload link. "Add photos or files" on an item uses `attach_file` with the item id. The
  app then does what the upload page does (`app/src/lib/upload.ts`). If the note was created
  but the upload failed, Save retries the files on that same note. No database or server change.
  **A2b as built:** Share -> Wilma from Photos, Files, Chrome etc. (Android). `expo-share-intent`
  8 adds the share targets (single: text, JPEG, PNG, Visio types, `application/octet-stream`;
  multiple: the same without text) and no permission. The app uses the module directly
  (`src/lib/shareIntake.tsx`) rather than its hook, which drops Android's `content://` links
  and forgets a share when the app goes to the background. Shared files are copied into the
  app's cache (or the module's copy there is used), checked like picked files, and deleted
  after saving or cancelling. The share screen (`src/app/share.tsx`): *New note* (space, title,
  note; shared text or a link becomes the note) or *Add to a note* (space, then one of its
  50 most recent notes, filter by title), captions per file. Signed out, sign-in comes first,
  then the share screen opens. iOS share extension switched off (`disableIOS`) until phase B.
  No database or server change.
- **A3 Vault.** Save and reveal secrets in the app; compatibility tests against the web
  vault; optional fingerprint/face lock for opening the app (never stores the passphrase).
  Owner's decisions (2026-09-30): passphrase once, then fingerprint; open 5 minutes (locks
  after a minute away from the app); values hidden until Show, hidden again after 30 s,
  clipboard cleared after 30 s; everything in the app (split into A3a unlock and reveal,
  A3b save / change / delete, A3c set up / recover / change passphrase, plus spaces, below).
  **A3a as built:** `src/lib/vaultCrypto.ts` is the web format (`docs/vault/crypto.js`).
  The first two builds (PRs #18, #20) **crashed at start-up**: `expo-screen-capture` registers a
  screen-capture callback when the app starts, which on Android 14+ needs
  `DETECT_SCREEN_CAPTURE`, and `app.json` blocked it (fixed in PR #21; guarded by
  `src/lib/appConfig.test.ts`). PR #20 had first suspected `react-native-libsodium` (untested
  on the New Architecture) and replaced it with `src/lib/sodiumLite.ts`: the same libsodium functions from `@serenity-kit/noble-sodium`
  (sealed boxes) and `@noble` (secretbox, BLAKE2b, key derivation) in plain JavaScript, with
  only Argon2id native (`react-native-quick-crypto`, a Nitro / New Architecture module). The
  vault's crypto now loads on first use, never at app start. `sodiumLite.test.ts` checks every
  function against libsodium-wrappers-sumo 0.8.4 (the web pages' version), and
  `vaultCrypto.test.ts` runs the app's vault on sodiumLite against the web `crypto.js`: each
  opens what the other made (vault, recovery key, secrets, passphrase change). Reveal:
  `get_secret` (one-time link) -> `get_reveal_request` -> `reveal_secret` -> decrypt on the
  phone (`vaultFlow.ts`). Fingerprint: the private key (never the passphrase) in
  expo-secure-store with `requireAuthentication` (Android keystore, invalidated when
  fingerprints change), deleted on sign-out. The secret screen blocks screenshots. No
  database or server change; reveals are logged with channel `web` like the reveal page.
  **A3b as built:** "Save a new secret" (vault list) opens `app/vault/enter.tsx`: space
  (restricted spaces left out, since the app never lists their secrets), name, kind, website,
  then the fields of `SECRET_FIELDS` (`SecretFieldsForm`, passwords hidden until Show, no
  autocorrect or suggestions). `vaultFlow.saveNewSecret`: fields checked first (as
  `enter.js`: single-line values exact, text boxes trimmed at the end, empty left out), then
  `save_secret` (metadata) -> `get_secret_entry_request` -> seal on the phone ->
  `complete_secret_entry`; it stops before sending anything if the link is for another
  secret, kind or entry type, or its public key is not the vault's. Same name in the same
  space asks first. Saving works while the vault is locked (public key only); on the secret
  screen, unlocked: "Change the value" (`update_secret` new_value, same steps with
  `is_update`), "Rename or change the website" (`update_secret` name/url), "Delete"
  (`delete_secret` after a confirm dialog). Change, rename and delete need the vault
  unlocked, so an open phone cannot overwrite or delete secrets. The entry screen blocks
  screenshots. No database, server or native change. **Confirmed on the phone** (build
  9c98f335 of `main` at 1bbf8e3, 2026-09-30: "seems everything works").
  **A3c plan (next):**
  - *Vault setup* (the vault screen's "not set up" card, today a link to the web page):
    choose a passphrase (twice, at least 12 characters), `crypto.createVault` ->
    `setup_vault` (accepts the app's sign-in, like the vault pages), then show the recovery
    key once with a "I have written it down" step; never copied to the clipboard, never logged,
    screenshots blocked.
  - *Recover with the recovery key* (forgotten passphrase): `crypto.unlockWithRecoveryKey`,
    then choose a new passphrase -> `crypto.rewrapPassphrase` -> `rewrap_vault_passphrase`.
  - *Change the passphrase* (unlocked): `rewrapPassphrase` -> `rewrap_vault_passphrase`; the
    fingerprint copy keeps working (it holds the private key, which does not change).
  - *Spaces in the app (owner's request, 2026-09-30):* **create a space** from the home screen
    (name, optional parent space, optional description, "restricted" switch with a plain
    explanation that restricted spaces never appear in search or in the app's vault list),
    using the existing MCP tool `create_space` (add it to `APP_TOOLS` + test; names cannot
    contain "/"). **Delete a space** already exists (space screen, "Delete space": only an
    empty space; the server names what is still inside, including vault passwords and the
    recycle bin); A3c only makes it easy to find and checks the message reads well. The home
    screen's "Ask Wilma in the Claude app to create one" text goes.
    *Spaces as built (PR "A3c spaces"):* "+ New space" next to "Spaces" on home, and "New space
    inside this one" on a space, open `app/new-space.tsx` (name, description, optional parent
    among the spaces the app can open, restricted switch off by default with a warning);
    checks in `src/lib/spaces.ts` (tested) before `create_space`. "Delete" is now also in the
    space screen's title bar, and the "cannot delete, still holds ..." message shows at the top.
    Not included: opening or deleting restricted spaces in the app (they cannot be opened yet;
    that comes with the restricted-space unlock on the roadmap).
    *Vault as built (PR "A3c vault"):* "Set up the vault" (vault screen, when not set up) opens
    `app/vault/setup.tsx`: passphrase twice -> `vaultFlow.startSetup` (new keys kept in
    `vault.tsx`, not in screen state) -> the recovery key shown once (not selectable, never
    copied or sent) and typed back -> `finishSetup` -> `setup_vault`; the vault opens.
    `app/vault/passphrase.tsx`: "Change the vault passphrase" (unlocked card) asks for the
    **current passphrase even when unlocked** (so an open phone cannot lock the owner out),
    "Forgot your passphrase?" (unlock card) takes the recovery key; both ->
    `rewrapPassphrase` -> `rewrap_vault_passphrase`, then the vault opens. The fingerprint
    copy keeps working (same private key). Both screens block screenshots. Tests in
    `vaultFlow.test.ts`: the stored keys open with the new passphrase and the recovery key, the
    old passphrase no longer does, nothing is sent when a check fails, and no passphrase,
    recovery key or private key appears in what is sent.
  - The crypto functions already exist and are tested against the web code; no database or
    server change expected. Suggested order: spaces first (small, separate PR), then setup,
    then recovery and passphrase change.
- **A4 Android release.** Privacy policy page (on the existing GitHub Pages site), Play
  Store listing, data-safety form, and a first release to a testing track (below).
  **Owner (2026-09-30):** Play developer account set up; test with the owner plus family and
  friends (internal testing, each tester with their own Wilma account created by the owner,
  sign-ups stay closed); public contact email zaftechlabs@gmail.com. Step-by-step guide with
  every form answer: `docs/phase4-play-release.md`. Pages: `docs/legal/privacy.html`,
  `docs/legal/delete-account.html`. Next in the app: "change sign-in password", so testers
  can replace the temporary password the owner gives them.
- **A5 One conversational box, typed and by voice** (the owner creates the API key at this
  point). Design: "The experience" at the top of this plan. Pieces:
  - **The box** replaces the home search field: text or microphone (the phone's built-in
    speech recognition; spoken replies with its text-to-speech, optional). Results and
    Wilma's replies appear as one thread under it; spaces stay below for browsing.
  - **Router, on the phone, invisible.** Rules first (instant, free): a lone keyword or short
    phrase shows search results only; a question ("what / how / when / did I ... ?", a
    question mark) or a command ("save / add / attach / move / delete / remind ...") goes to
    Wilma; a follow-up in an ongoing thread goes to Wilma. Unclear cases: a small, cheap Claude
    model classifies (lookup / question / action), a fraction of a cent. Search results always
    show at once; if they are weak (nothing close) Wilma is asked automatically. When in doubt,
    Wilma. The router learns nothing hidden: its rules live in the app code and are tested.
  - **New Edge Function `chat`:** the app sends the thread; the function calls the Claude API
    with the same MCP tools the Claude app uses (so every rule, including restricted spaces
    and the vault's zero-knowledge design, holds unchanged). The API key lives only in
    Supabase secrets. The model is chosen for cost and quality after measuring (default model
    for answers and actions, a small model for routing and short replies), with prompt caching.
  - **Safety net:** destructive tools ask for confirmation in the thread (a tap), deletes use
    the recycle bin; a vault request opens the in-app vault (A3) instead of showing a value.
  - **Budget:** a monthly limit the owner sets in the app (stored server-side and enforced in
    `chat`), a warning near it, and a clear message if reached (search and browsing keep
    working). The Console spend limit stays as a second safety line.
  - **Pictures** shared or taken in the thread go to Claude (for the description) and to
    Storage (the file) in the same step.
  - Same thread later from the Share menu (A2b shares can carry a spoken or typed request),
    "Hey Wilma", Telegram and the web page.
- **B iOS.** Same code. Owner: Apple Developer account ($99 a year). iOS build through EAS,
  iOS permission texts and share extension settings, TestFlight, then App Store review.
- **Later:** "Hey Wilma" wake word, notifications/reminders, PC/Mac web
  page from the same code, optional desktop app (Tauri) with background "Hey Wilma".

## Publishing: what the stores require

- **Testing tracks first.** Google Play: *internal testing* installs on up to 100 named
  testers' phones within minutes, with a light review. A new *personal* Play developer
  account must run a *closed test* with at least 12 testers for 14 days before it can
  publish to everyone. iOS: *TestFlight* works the same way for internal testers.
- **Sign-ups are closed today** (only the owner's account exists). The stores publish apps
  that anyone can download, and reviewers must be able to sign in (a demo account). For a
  personal app, stay on the testing tracks; for a public app, sign-ups would reopen and the
  app becomes multi-user (the design already supports that, D11).
- **Account deletion:** an app that lets people create accounts must also let them delete
  the account from inside the app (both stores). Needed only if sign-ups open.
- **Privacy:** a privacy policy page, Google's data-safety form and Apple's privacy labels
  (what is collected: account email, saved content, files; nothing sold or shared).
- **Package id** `com.zaf.wilma` cannot change after the first upload.

## Rules that still hold

- Secrets never reach the model: the vault stays zero-knowledge; the app encrypts and
  decrypts on the phone; the chat function (A5) never sees vault values.
- The app never contains the service-role key or an AI key. Only the public Supabase
  address and publishable key are in the app, as on the web pages today.
- Restricted spaces stay out of search (the MCP server enforces it; the app adds nothing).
- Every upload still starts with a place and a reason: the app asks for the space or item
  before uploading.

## Decisions

Made by the owner (2026-09-29):

- **Package id: `com.zaf.wilma`** (chosen 2026-09-29, replacing `com.hmw.wilma` before any upload; lowercase; permanent after the first Play upload). If Google
  reports it taken at the first upload, choose another before anything is published (for
  example `com.zafwilma.app`). The display name ("Wilma") is separate and can change.
- **Goal: a public, commercial listing.** Build for public from the start (privacy policy
  page, in-app account deletion, a sign-up screen kept switched off, a reviewer demo
  account), but release only to testing tracks until the owner decides to go public:
  internal testing first, then closed testing (a new personal Play account needs at least
  12 testers for 14 days), then production. Moving between tracks, or unpublishing, is
  possible at any time with the same app.

- **Google Play account: personal** for now, to find out whether the app is worth it
  before going further. A personal account cannot be converted; if a company comes later,
  open an organization account and transfer the app (same package id, users, reviews and
  ratings). The 12-testers/14-days closed test applies once, before the first public release.

- **Chat with Wilma, typed and by voice: yes**, at A5. The owner creates the Anthropic API
  key only then: a Claude Console account (separate from the Claude subscription), prepaid
  pay-as-you-go credit with a monthly spend limit, and the key pasted by the owner into
  Supabase secrets (never into chat, the app or the repo). No cost before A5 except the $25
  Play fee. Rough estimate to verify once chat works: a few cents per typed message with the
  default model; cost tuning (model choice, prompt caching) after measuring real use.
- **Voice uses the phone's built-in speech recognition and text-to-speech** (free, no extra
  key); a paid speech-to-text service only if the built-in one is not good enough.

Made by the owner (2026-09-30):

- **Seamless experience is the value proposition:** one box (and a microphone) for
  everything, no search/chat modes for the user to choose; an invisible router picks
  instant search, Wilma's answer or an action, and when in doubt asks Wilma; destructive
  actions confirm first; a monthly AI budget prevents surprise bills. See "The experience"
  at the top and A5.

Still open:

1. **Accounts:** the owner creates the Expo account and the Play developer account when A0
   starts (never paste passwords or keys into the chat).

For later (commercial, not blocking A0-A4): in-app subscriptions must use Google Play Billing
and Apple in-app purchase (store fee 15% on the first $1M a year); a paid Supabase plan once
real users arrive (the free plan pauses inactive projects); per-user AI costs; terms of use;
a trademark check on the name "Wilma".
