# Phase 3, step 1: the Wilma mobile app (plan)

Status: plan, not built. Owner direction (2026-09-28): a real app, **publishable on Android
first and iOS after, from one codebase with minimal changes**. PC and Mac use a web page (no
install); an installed desktop app with background "Hey Wilma" may come later from the same
code. Read first: `CLAUDE.md`, `docs/design.md`, `docs/phase2-attachments-plan.md`.

## What the app adds over the Claude app

The Claude app already reaches Wilma on every platform. The app is for what it cannot do:

- Pictures and Visio files go straight in (camera, gallery, files, or **Share to Wilma** from
  any other app), with no upload link and no picking the file twice.
- The vault inside the app: save and reveal secrets with the same passphrase, no browser tab.
- Browse spaces and items, not only ask about them.
- Later: chat with Wilma in the app, voice, notifications (reminders).

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
- **A2 Save and attach.** Save a note; attach from camera, gallery, files and the Android
  share menu (the same checks as the upload page: type from the first bytes, 20 MB, Visio
  text read on the phone).
- **A3 Vault.** Save and reveal secrets in the app; compatibility tests against the web
  vault; optional fingerprint/face lock for opening the app (never stores the passphrase).
- **A4 Android release.** Privacy policy page (on the existing GitHub Pages site), Play
  Store listing, data-safety form, and a first release to a testing track (below).
- **A5 Chat with Wilma** (only after the API-key decision). New Edge Function `chat`: the
  app sends the conversation, the function calls the Claude API, which uses the same MCP
  tools. The key lives only in Supabase secrets. Pictures go to Claude (for the
  description) and to Storage (the file) in the same step.
- **B iOS.** Same code. Owner: Apple Developer account ($99 a year). iOS build through EAS,
  iOS permission texts and share extension settings, TestFlight, then App Store review.
- **Later:** voice (speech-to-text choice pending), notifications/reminders, PC/Mac web
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
- **Package id** `com.hmw.wilma` cannot change after the first upload.

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

- **Package id: `com.hmw.wilma`** (lowercase; permanent after the first Play upload). If Google
  reports it taken at the first upload, choose another before anything is published (for
  example `com.hmwehbe.wilma`). The display name ("Wilma") is separate and can change.
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

Still open:

1. **AI key for chat (A5):** yes or not yet. A1-A4 work without it.
2. **Accounts:** the owner creates the Expo account and the Play developer account when A0
   starts (never paste passwords or keys into the chat).

For later (commercial, not blocking A0-A4): in-app subscriptions must use Google Play Billing
and Apple in-app purchase (store fee 15% on the first $1M a year); a paid Supabase plan once
real users arrive (the free plan pauses inactive projects); per-user AI costs; terms of use;
a trademark check on the name "Wilma".
