# A5e: voice, speech to text (plan)

Status: **approved by the owner (2026-10-05): Q1-Q8 all as recommended** (below). Step 2
merged (#79, live in Play versionCode 8, mic off). Step 3 (the mic button) is in review; see
"As built: step 3" at the end. Next: step 4. Parent plan: `docs/phase5-chat-plan.md` (A5e). Builds on
A5d, the one box (`docs/phase5-a5d-one-box-plan.md`). Design: `docs/design.md` D18 (one box and
voice, no modes). Read `docs/handoff.md`, "Lessons from this session (read before adding native
packages)", before step 2.

**Which model builds this:** the strongest one, in a fresh session, for steps 2 and 3 (a new
native module, a new Android permission, and a change to the box that feeds the chat loop;
CLAUDE.md). A smaller model (Sonnet) is fine for step 4 (privacy wording, docs) and step 5
(merge, build, phone checklist, handoff).

## What the owner will see

1. A **microphone button** next to Send, in the home screen's one box and in the chat screen's
   box. Nowhere else.
2. The first tap asks Android's usual question: "Allow Wilma to record audio?" Say yes once.
   If you say no, the button explains how to allow it in Settings; typing still works.
3. Tap the mic and speak. The words appear **in the box** as you talk. Recognition stops by
   itself after a short silence, or when you tap the mic again.
4. You read the text, fix a word if needed, then tap **Send** yourself. **Nothing is ever sent
   by voice alone** (Q1).
5. There is no mic in the vault, on the sign-in screen, on the change-password screen, or on any
   screen that blocks screenshots (Q4).
6. Wilma answers in text, as today. Spoken replies are not part of this phase (Q7).

## How it works

- The phone does the listening. On Android the app asks the phone's own speech service (usually
  Google's) to turn speech into text. The app never records or stores audio itself, and no audio
  goes to our server or to the AI model. Only the resulting text goes, exactly as if typed.
- The text lands in the same `text` state the keyboard fills today. From there nothing changes:
  Send calls `send(text)` in `app/src/lib/chat.tsx:153`, which runs the A5d router
  (`routeMessage`, `chatRoute.ts`) and then Wilma. So a dictated message gets every check a typed
  one gets: restricted spaces stay out of lookups (rule 3), and the server's credential check
  (rule 9, `supabase/functions/mcp/lib/credentials.ts`, used by the chat function too, see
  `supabase/functions/chat/tools.ts:3`) still refuses to save a password said out loud.
- Where the button goes:
  - Home box: the row at `app/src/app/index.tsx:66-84` (the `TextInput` at line 67, the Send
    button at line 83). The mic goes between them.
  - Chat box: the row at `app/src/app/chat.tsx:95-110` (multiline `TextInput` at line 96, Send or
    Stop at lines 105-109). The mic goes before Send, and is hidden while a reply streams.
  - Dictated words are **appended** to what is already in the box, so you can type half and say
    half.
- The mic is off while the box cannot send (`canSend` false, e.g. the thread is still loading),
  and listening stops when the app goes to the background or the screen is left.

## The library and the permission

**Candidate:** `expo-speech-recognition` (by jamsch), the usual choice for Expo apps. It wraps
Android's `SpeechRecognizer` and iOS's speech framework, and has a config plugin. It is **not
added yet**; step 2 adds it. These facts could not be checked from this session (no reliable
internet) and are marked **to check** in step 2, by reading the package's README and its
`android/` source in `node_modules` before anything else:

- **To check:** a release that supports Expo SDK 57 (`app/package.json`: `expo ~57.0.26`,
  `react-native 0.86.3`) and the New Architecture (RN 0.86 runs only the New Architecture,
  handoff lessons).
- **To check:** its config plugin adds `android.permission.RECORD_AUDIO` to the manifest, and a
  `<queries>` entry for `android.speech.RecognitionService` (Android 11+ hides speech services
  from apps without it). Options for the iOS permission texts (`microphonePermission`,
  `speechRecognitionPermission`) are not needed for Android but should be set to plain wording.
- **To check:** the option `requiresOnDeviceRecognition` keeps audio on the phone. On Android it
  is said to need Android 13+ and a downloaded language pack; the module should have a call to
  ask whether on-device recognition is available. Otherwise Android uses its default service,
  usually Google's (`com.google.android.googlequicksearchbox`), which may send audio to Google.
- **To check, the A3a lesson:** what the module does **when the app starts**. Read its Kotlin
  module definition for `OnCreate`, `OnActivityEntersForeground` and any listener registered at
  start-up. Expo modules are created when the app starts, not when first used, so a module that
  touches the microphone or the speech service at start-up could crash or prompt at launch.

**Where RECORD_AUDIO is blocked today, and every other permission setting:**

- `app/app.json:23-29`, `android.blockedPermissions`: `READ_EXTERNAL_STORAGE`,
  `READ_MEDIA_IMAGES`, `RECORD_AUDIO` (line 26), `SYSTEM_ALERT_WINDOW`, `WRITE_EXTERNAL_STORAGE`.
  Blocked means Expo removes them from the final manifest even if a library asks for them.
- `app/app.json:52-59`, `expo-image-picker`: camera and photos texts, and
  `"microphonePermission": false` (line 57). This must **stay false**: unblocking RECORD_AUDIO is
  for speech only, not for video recording in the picker.
- `app/app.json:45-50`, `expo-secure-store`: the Face ID text (iOS).
- `DETECT_SCREEN_CAPTURE` is deliberately **not** blocked (needed by `expo-screen-capture` at
  start-up).
- `app/src/lib/appConfig.test.ts:18-22` asserts RECORD_AUDIO stays blocked. Step 2 changes that
  test on purpose: RECORD_AUDIO is allowed **only if** the speech package is a dependency, and the
  other four stay blocked.

**The A3a crash lesson** (`docs/handoff.md:249-258`, `docs/phase3-mobile-app-plan.md:127-133`):
the first two A3a builds (PRs #18 and #20) crashed at launch. `expo-screen-capture` registers
`Activity.registerScreenCaptureCallback` in its module's `OnCreate`, which on Android 14+ throws
without `DETECT_SCREEN_CAPTURE`, and `app.json` had blocked that permission. The first diagnosis
(react-native-libsodium, #20) was a guess and cost a build; #21 (commit 232f0c9) unblocked the
permission and added the guard test. For A5e this means: read the new module's start-up code
before the first build, never block a permission it needs at start-up, and keep the mic's
JavaScript loaded only when the mic is first tapped (as the vault crypto is loaded on first use).

## Files (planned)

- `app/package.json`, `package-lock.json`: add `expo-speech-recognition` (step 2, owner approves).
- `app/app.json`: remove `RECORD_AUDIO` from `blockedPermissions`; add the plugin with its texts
  and options; keep `expo-image-picker`'s `microphonePermission: false`.
- `app/src/lib/config.ts`: `VOICE_ENABLED` (a plain constant, false in step 2, true in step 3).
- `app/src/lib/voice.ts` + `voice.test.ts` (new): the only file that imports the module, loaded
  lazily. Small pure helpers: `appendDictation(box, words)`, error-to-message mapping, and a
  `useDictation()` hook (start, stop, partial text, permission state).
- `app/src/components/MicButton.tsx` (new): the button, its listening state, its accessibility
  label ("Dictate", "Stop dictating").
- `app/src/app/index.tsx`, `app/src/app/chat.tsx`: the mic in each box.
- `app/src/lib/appConfig.test.ts`: the permission guard (above), plus a guard that the vault,
  sign-in and account screens do not import the mic.
- `docs/legal/privacy.html`, `docs/phase4-play-release.md` (Data safety answers) in step 4.
- `docs/phase5-a5e-phone-checklist.md` (new, step 5).

## Tests to write

1. **Permissions** (`appConfig.test.ts`): RECORD_AUDIO unblocked only with the speech package
   present; storage, media, drawing-over-apps still blocked; image picker's microphone still off;
   DETECT_SCREEN_CAPTURE still allowed.
2. **No mic on secret screens** (rules 1 and 9): a test reads `app/src/app/vault/*`,
   `sign-in.tsx`, `account.tsx` and the secret form components and fails if any imports
   `MicButton` or `voice.ts`.
3. **Dictation never sends** (Q1): with the module mocked, a final result only changes the box's
   text; `send` is never called by the mic; the box keeps what was typed before and appends.
4. **Same path as typing:** dictated text sent with Send goes through `send` exactly once and
   through the router (an existing A5d test, reused with dictated text, e.g. "wifi hunter2" goes
   to Wilma, never a lookup).
5. **Start-up safety:** importing `index.tsx` and `chat.tsx` does not load the speech module
   (lazy load checked with a jest mock); with `VOICE_ENABLED` false, no mic is shown.
6. **Errors:** permission denied, no speech service, no match, network error each give a short
   message under the box and leave the text alone.
7. By hand on a phone (step 5 checklist): the first launch after the update does not crash,
   the permission prompt appears only on the first mic tap, airplane mode, deny then allow in
   Settings, a long sentence, a name lookup by voice ("open recipes"), and "my wifi password is
   ..." said out loud (Wilma must refuse to save it as a note).

`npm run check` must pass on every PR.

## Steps (each a small PR; the owner approves merges, builds and deploys)

1. **Plan** (this PR). Owner answers Q1-Q8.
2. **Permission and module behind a flag, no screen.** Read the module's Android start-up code
   first and write what it does into the PR description. Add the package, the plugin, unblock
   RECORD_AUDIO, `voice.ts` (lazy), the tests. `VOICE_ENABLED = false`. Then a **preview build**
   (.apk) to prove the app still starts on the owner's phone before any button exists (the A3a
   lesson: a launch crash is found by a build, not by tests). Strongest model.
3. **The mic button** on the home box and the chat box, `VOICE_ENABLED = true`, tests 2-6.
   Strongest model.
4. **Privacy page and Play Data safety.** Update `docs/legal/privacy.html` with the wording below
   (owner approves the text) and the Data safety answers in `docs/phase4-play-release.md`. The
   owner updates the form in Play Console. Sonnet.
5. **Ship:** `docs/phase5-a5e-phone-checklist.md`, handoff update, then "merge and build for
   Play" (`production` profile; versionCode goes up by itself: `app/eas.json:4`
   `appVersionSource: remote` and `:17` `autoIncrement: true`; currently 6, so this is 7 or
   later). Step 4 must be live before this build reaches testers. Sonnet.

Not in A5e: spoken replies (Q7), a wake word ("Hey Wilma", `docs/design.md` roadmap), voice on
iOS and the web page (the app ships on Android only today), dictation in note editing screens.

## Decisions

**Owner's answers (2026-10-05):** Q1 into the box, the user taps Send; Q2 `expo-speech-recognition`
if step 2's checks pass; Q3 on-device when available, otherwise the phone's speech service, said on
the privacy page; Q4 the home box and the chat box only; Q5 the phone's language; Q6 words appear
while speaking; Q7 no spoken replies in this phase; Q8 "Never type or say passwords here."

- **Q1. Dictated text: into the box, or sent straight away?** *Recommend:* **into the box; you
  tap Send.** Never auto-sent. A misheard word could open the wrong thing, save junk, or start a
  delete (deletes confirm, but a save does not). And a dictated password must reach the same
  server credential check as a typed one (rule 9), which it does only through the normal Send.
  Alternative: auto-send after a pause (faster, hands-free; reconsider with a wake word later).
- **Q2. Which library?** *Recommend:* `expo-speech-recognition`, if step 2's checks pass (SDK 57,
  New Architecture, start-up code). Alternative: `@react-native-voice/voice` (older, not an Expo
  module; would need its own checks), or recording audio and sending it to a cloud speech API
  (costs money, audio leaves the phone to another company, more privacy text). Not recommended.
- **Q3. On the phone only, or Google's online service too?** *Recommend:* ask for **on-device**
  recognition when the phone has it (Android 13+ with the language downloaded), otherwise use the
  phone's default service, usually Google's, which may send the audio to Google. The privacy page
  says so. Alternative: on-device only, and hide the mic on phones without it (more private; on
  some testers' phones there would be no mic).
- **Q4. Where is the mic?** *Recommend:* only the home box and the chat box. **Never** in the
  vault (`app/src/app/vault/*`), on sign-in, change password, or any screen with a hidden field
  or blocked screenshots. Saying a password aloud sends it to the speech service and to anyone in
  the room. Alternative: also in the note editor (useful for long recipes; later, its own PR).
- **Q5. Language:** *Recommend:* the phone's language setting (Android's default). Arabic and
  French speakers get their own language. Alternative: a language choice in the app (later).
- **Q6. Show words while speaking?** *Recommend:* yes, partial results in the box, replaced by
  the final text. You see at once if it misheard. Alternative: only the final text (simpler).
- **Q7. Spoken replies (text to speech, `expo-speech`)?** *Recommend:* **not now.** Text replies
  stay; revisit after people have used dictation. When built, a replies-aloud switch, off by
  default, and never reading a secret card or a vault value aloud. Alternative: an optional
  "read aloud" button on each reply in this phase (small, but another module and more checks).
- **Q8. A warning against dictating passwords?** *Recommend:* yes, the box's existing line
  ("Never type passwords here. Use the Vault.", `app/src/app/chat.tsx:113`) becomes "Never type
  or say passwords here. Use the Vault." in the chat box, and the same line appears on the home
  box while listening. The server still refuses them either way. Alternative: no new text.

## Privacy page wording (draft, for the owner's approval)

`docs/legal/privacy.html:35-36` says the app does not collect location or contacts and that "The
camera and file access are used only when you choose to add a photo or file." Proposed change:

> The camera, the microphone and file access are used only when you choose to: the camera and
> files when you add a photo or file, the microphone when you tap the microphone button to
> dictate a message. Dictation uses your phone's own speech recognition. Depending on your phone,
> it runs on the phone or your phone's speech service (on most Android phones, Google) receives
> the audio to turn it into text, under that service's own privacy terms. Wilma receives only the
> resulting text, never the audio, and does not record or keep audio.

Also add one line under "Services we use" for the phone's speech service, and update "Last
updated" (`privacy.html:14`).

## Google Play

- Data safety (`docs/phase4-play-release.md:65-83` lists audio as "Not collected", line 78).
  **To check** with Google's definitions: audio handled by the phone's system speech service,
  never sent by the app to our servers, may still count as not collected by the app. If in
  doubt, declare *Audio → Voice or sound recordings*: collected, optional, processed
  ephemerally, purpose App functionality. The text that results is already covered by "Other
  user-generated content".
- Where: Play Console → Wilma → **Policy and programs → App content → Data safety** (path **to
  check**; the release doc reached it through Dashboard → "Set up your app"). Save, then send the
  change for review (the Publishing overview page).
- **To check:** RECORD_AUDIO is not on Play's list of permissions that need a separate
  declaration form (that list covers SMS, call log, location in the background and others).

## Phone checklist (written in step 5)

`docs/phase5-a5e-phone-checklist.md`, in the style of `docs/phase5-a5d-phone-checklist.md`:
update from Play, app starts, first mic tap asks permission, deny then allow in Settings, dictate
a question, a space name, a long sentence, edit before Send, Stop while listening, leave the
screen while listening, airplane mode, no mic in the vault, and "my wifi password is ..." refused.

## What the owner does

- ~~Approve this plan and answer Q1-Q8.~~ Done 2026-10-05, all as recommended.
- Approve the merges (steps 2, 3, 4), the preview build in step 2 and the Play build in step 5.
- Approve the privacy wording; update Data safety in Play Console yourself (Claude cannot).
- Run the phone checklist. Never dictate or paste passwords or keys to Wilma or to me; if you
  do, change them.

## As built: step 3 (the mic button)

- `app/src/lib/voice.ts`: `createDictation(load, onChange)` is the mic without React (start,
  stop, cancel; partial words; permission state; short error lines), and `useDictation(onWords,
  enabled)` wraps it for a screen. It stops listening when the app goes to the background
  (`AppState`), when the screen loses focus (`useFocusEffect`), and when `enabled` turns false
  (the box cannot send, or a reply streams). A result only ever calls `onWords`: the screens pass
  `(words) => setText((t) => appendDictation(t, words))`.
- Partial words are shown after the box's text while listening but are not in the box's state;
  the final words are appended when the phone sends them. If listening ends without a final
  result (stopped, or the app went to the background), the words already showing are kept.
- While listening the box is read-only and **Send waits** (tap the mic to stop, then Send), so
  the words sent are exactly the words in the box. Nothing is sent by voice (Q1).
- Permission: asked on the first tap (`requestPermissionsAsync`); "denied" gives the Settings
  line. No speech service on the phone (`isRecognitionAvailable()` false) gives its own line.
- `app/src/components/MicButton.tsx`: 🎤 / ■, labels "Dictate" / "Stop dictating", between the
  text and Send in both boxes, hidden in the chat while a reply streams, off when `canSend` is
  false. Q8: the chat box's line reads "Never type or say passwords here. Use the Vault."; the
  home box shows it while listening.
- Tests: `dictation.test.ts` (tests 3, 4, 6 with a fake module), `micScreens.test.ts` (test 5:
  loading both screens does not load the speech package; the mic only under `VOICE_ENABLED`;
  only the two boxes use it), `appConfig.test.ts` (test 2, from step 2).
