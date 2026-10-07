# Phone checklist: "near me" in the chat (places step 7)

For the owner, on the **next build after versionCode 10**. That build carries the chat's 📍
button (#110). Before the build: #108 is merged and `chat` + `mcp` are deployed (otherwise a 📍
message gets "trouble connecting"), and the privacy sentence (#111) is merged. About 10 minutes,
with your own account, somewhere near one of your saved places that has a location (the
"Test spot" from the step 6 checklist works if you kept it, or make one with 📍 Save where I am).
**Never say or type a real password or door code**: use the made-up one below.

## Update and start

- [ ] Update Wilma from Play (internal testing). The app **starts without a crash**.
- [ ] Nothing about location is asked at start-up, and opening the chat doesn't ask either.

## The 📍 button in the chat

- [ ] The chat box has a **📍** next to 🎤 and Send. The **home box does not** (chat only).
- [ ] Tap 📍: "Finding where you are…", then the button lights up with a line saying your
  location goes with your next message. If location was already allowed (step 6), **no
  question** is asked.
- [ ] Tap 📍 again: it turns off and the line goes away. Nothing is read again.
- [ ] Tap 📍, type "what restaurants are near me?", Send. Wilma lists saved places **with a
  location**, nearest first, as "about N km". No travel times, and she doesn't read your
  coordinates back to you.
- [ ] After that message the 📍 is **off** again. Ask "and any cafés?" without tapping it: Wilma
  doesn't have your location any more, so she asks which saved place you're near (or to tap
  📍). She doesn't reuse the old location or invent one.
- [ ] If you have a **restricted** space with a place in it: with 📍, ask "anything near me?"
  close to that place. It **never** comes up, and there's no hint that something is hidden.
- [ ] Tap 📍, then "save this spot as a place called Test bench". Wilma does **not** save your
  location into a note; she points you to **📍 Save where I am** on the home screen.

## Refused or off

- [ ] Settings > Apps > Wilma > Permissions > Location > **Don't allow**. In the chat, tap 📍: it
  asks again, or a plain sentence says how to allow it. Nothing is sent and nothing breaks;
  typing and Send still work.
- [ ] Allow it again. Turn the phone's location off (quick settings), tap 📍: a plain sentence says
  location is off. Turn it back on afterwards.

## Secrets stay out

- [ ] Tap 📍, then "what's near me? Also save on Test spot that the gate code is 7719". The places
  answer comes, but the code is **not** saved in the note: Wilma points to the Vault.

## Leaving the chat

- [ ] Close Wilma fully and open it again: the conversation is there, but there's **no 📍 on**
  and nothing about your location in the thread.

## Clean up

- [ ] Delete "Test bench" if it was made, and any other test place (they go to the recycle bin).

## Report back

Tell me which lines failed, what you did and what you saw. These are stop-ships:

- the location asked at start-up, or read without a 📍 tap;
- the location sent with a second message you didn't tap 📍 for;
- a restricted place shown, or hinted at, in a "near me" answer;
- your location or a code saved in a note;
- Wilma giving a distance for a place without a location.
