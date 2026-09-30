# Wilma mobile app

Expo (React Native, TypeScript) app for Android first, then iOS, from one codebase.
Plan: `../docs/phase3-mobile-app-plan.md`. Owner setup: `../docs/phase3-mobile-app-setup.md`.

- App name **Wilma**, package / bundle id **`com.zaf.wilma`** (permanent after the first
  Google Play upload).
- Screens live in `src/app/` (Expo Router: every file is a screen). Other code in
  `src/lib/`, `src/components/`, `src/constants/`.
- `src/lib/config.ts` holds only public values (project address, publishable key). Never
  put a service-role key, an AI key or any other secret in the app.
- `AGENTS.md` is Expo's guidance for AI coding assistants (kept from the template).

## How it works (milestones A1, A2a)

| File | What it does |
|---|---|
| `src/app/_layout.tsx` | Signed out: only `sign-in` exists. Signed in: `index` (spaces, search), `space/[id]`, `item/[id]`. |
| `src/lib/supabase.ts` | Supabase sign-in (email + password, same account as the Claude connector and vault pages). |
| `src/lib/sessionStorage.ts`, `deviceStorage.ts` | The session is encrypted (AES-256-GCM); the key is in the phone's keystore (this device only, not in backups), the ciphertext in the app's local store. |
| `src/lib/wilma.ts` | Calls Wilma's tools on the MCP server with the user's token: `list_spaces`, `search_items`, `get_item`, `get_attachment_link`, `save_item`, `attach_file` only. |
| `src/app/new-item.tsx`, `attach.tsx` | New note (optionally with files); add files to an item. |
| `src/lib/upload.ts`, `picked.ts`, `filetypes.ts`, `deviceFiles.ts` | The upload page's steps and file rules, done by the app: one-time link from `attach_file`, files streamed to Storage, recorded with `complete_attachment_upload`. `filetypes.test.ts` checks the rules match `docs/files/filetypes.js`. |

Restricted spaces are shown with a lock and are not opened or searched. The app has no
vault tools yet (A3); secret values never pass through it.

## Commands (from this folder)

```bash
npm install
npm run check        # lint + type-check + unit tests (CI runs the same, plus expo-doctor)
npm start            # dev server (needs a development build or Expo Go on a phone)
node scripts/placeholder-icons.mjs   # regenerate the placeholder icons
```

## Builds

Builds run on Expo's servers (EAS), configured in `eas.json`:

| Profile | Output | Use |
|---|---|---|
| `development` | `.apk` with developer tools | day-to-day testing while building features |
| `preview` | `.apk` | install on your own phone |
| `production` | `.aab` | Google Play; build numbers are kept by EAS and go up by themselves |

Start one from GitHub: **Actions -> app build -> Run workflow** (needs the `EXPO_TOKEN`
repository secret). `ios/` and `android/` are generated at build time and are not committed.

## Permissions

Android asks for internet, vibration and the camera (A2a; Android asks the first time you
take a photo). Blocked in `app.json`: the storage permissions (Android's photo picker needs
none), "draw over other apps", and the microphone the image picker would add for videos.
Other permissions are added only with the features that need them.
