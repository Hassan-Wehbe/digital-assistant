# Wilma mobile app

Expo (React Native, TypeScript) app for Android first, then iOS, from one codebase.
Plan: `../docs/phase3-mobile-app-plan.md`. Owner setup: `../docs/phase3-mobile-app-setup.md`.

- App name **Wilma**, package / bundle id **`com.hmw.wilma`** (permanent after the first
  Google Play upload).
- Screens live in `src/app/` (Expo Router: every file is a screen). Other code in
  `src/lib/`, `src/constants/`.
- `src/lib/config.ts` holds only public values (project address, publishable key). Never
  put a service-role key, an AI key or any other secret in the app.
- `AGENTS.md` is Expo's guidance for AI coding assistants (kept from the template).

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

Android asks for internet (and vibration) only. The storage and "draw over other apps"
permissions that Expo adds by default are blocked in `app.json`. Camera, microphone and
others are added only with the features that need them.
