# Phone checklist: dictation, the mic button (A5e, versionCode 9)

For the owner, on the first Play build with the mic button (#86): **versionCode 9**, built
2026-10-06 from `main` at eaea7e4 (GitHub run 37405634042). About 10 minutes, with your own
account. **Never say or type a real password**: use the made-up ones below. Below, *Recipes*
stands for one of your spaces.

## Update and start

- [ ] Update Wilma from Play (internal testing). The app **starts without a crash**.
- [ ] Settings > Apps > Wilma > Permissions: the microphone is **not** allowed yet (nothing asked
  at start-up).

## The first tap

- [ ] Home screen: a **🎤** button sits between the box and **Send**.
- [ ] Tap it: Android asks to allow Wilma to record audio. Tap **Don't allow**: a line under the
  box says how to allow it in Settings; typing still works.
- [ ] Allow it in Settings > Apps > Wilma > Permissions > Microphone, come back, tap 🎤: it
  listens (the button turns red with ■, and "Never type or say passwords here. Use the Vault."
  shows under the box).

## Dictating

- [ ] Say "what did I save about the roof": the words appear in the box while you speak, and
  stay there when you stop. **Nothing is sent**: you tap Send yourself, and Wilma answers.
- [ ] Type "remind me", then tap 🎤 and say "to buy milk": the box reads "remind me to buy milk".
- [ ] Say a long sentence (three or four lines): the words keep coming; fix a word by typing
  after the mic stops, then Send.
- [ ] Tap 🎤, start speaking, tap ■: it stops and the words heard so far stay in the box.
- [ ] While listening, Send is greyed out and the box can't be typed in.
- [ ] Say "open recipes" (your space's name), then Send: the space opens, as when typed.
- [ ] Tap 🎤 and say nothing: after a few seconds "Didn't catch that…" shows, the box unchanged.

## Leaving while listening

- [ ] Tap 🎤, then press the phone's Home button: listening stops (no mic icon in the status bar
  after a moment). Back in Wilma, the box has any words already heard.
- [ ] Tap 🎤, then tap **Conversation**: listening stops.

## The chat screen

- [ ] In the conversation: 🎤 before **Send**; the line under the box reads "Never type or say
  passwords here. Use the Vault."
- [ ] Dictate a question and Send: while Wilma answers, the 🎤 is hidden (only **Stop** shows).
- [ ] Say "my wifi password is Sunflower2024" and Send: Wilma does **not** save it as a note and
  points you to the vault.

## Without a connection

- [ ] Airplane mode, tap 🎤 and speak: either it works (the phone has the language on the
  phone), or a short line says dictation needs a connection. Nothing crashes; typing works.

## No mic where secrets are

- [ ] Vault (all its screens), sign-in, Change sign-in password, New note, Edit note: **no 🎤**.

## Editing a note (from versionCode 8, if not yet reported)

- [ ] Open a note, **Edit note**, change title and text, **Save**: new title and text, and one
  more earlier version under it.
- [ ] Type `the wifi password is Sunflower2024!` into a note's text, **Save**: refused with
  "This looks like it holds a password…"; the note unchanged.
- [ ] **Cancel** leaves the note as it was.

## Report back

Which lines failed, with what you said or typed and saw. A message sent without tapping Send, a
mic on a vault or sign-in screen, or a password saved as a note is a stop-ship.
