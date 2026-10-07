# Phone checklist for the next build (versionCode 12): the "super checklist"

For the owner, on the next Play build after versionCode 11. That build carries the **UI tidy-up**
(`docs/ui-review.md` section 3, PRs 1-6: home panel, Settings, chat with the Wilma box, the
password card, one chat card shell) and **places step 8 part 2** (`docs/places-plan.md`: Miles /
km on Settings, place cards, the 📍 Share where I am card). The server side is already live
(`mcp` v20, `chat` v12). The OpenStreetMap lookup (part 2 PRs 5-7) is on hold, so there is no
"Find on the map" and no privacy change.

This one list also replaces the versionCode 10 and 11 checklists (`places-phone-checklist.md`,
`places-step7-phone-checklist.md`), which were never recorded: their key lines are folded in
below. About 30 minutes, with your own account. **Never type or say a real password or code**:
use the made-up ones below.

## Before you start (owner's to-dos, parked until now)

- [ ] Supabase dashboard → Edge Functions → **place-locations** → Delete (the old stub; the
  connector cannot delete functions). Only `mcp` and `chat` should remain.
- [ ] Give your two saved places (Hinode Sushi, Lemongrass Thai Kitchen) a location, either when you
  are at each one (open the note → Edit → **Use where I am now** → Save), or by pasting a long
  Google Maps link from a computer's browser (one with `@lat,lng` or `!3d…!4d…` in it). If you are
  not near them today, do the rest of the list first: one section below uses a place without a
  location on purpose.

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**.
- [ ] Nothing about location or the microphone is asked at start-up.

## Home

- [ ] A white top panel holds the **Wilma box** (3 lines) with **＋** bottom left, the **counter**
  in the middle ("About N left"), **🎤** and **↑** bottom right.
- [ ] Tiles under it: a wide **💬 Chat** (or **💬 Continue ·** your last question), **📍 Save
  here**, **🔒 Vault**. Your spaces are a grouped list below; a restricted space is one plain row.
- [ ] Return in the box adds a line; only **↑** sends.
- [ ] **＋** opens: new note, take a photo, choose pictures. Each opens New note as before.
- [ ] Tap the counter: it opens **Settings**. The ⚙ at the top does too.

## Settings

- [ ] **This month**: the meter, "About N requests left this month · resets Nov 1". No dollar
  amounts anywhere.
- [ ] **Distances**: **Miles** has a ✓ (the default). Under it: "Nearby" means within 10 miles (16 km).
- [ ] Tap **Kilometres**: the ✓ moves at once. Leave Settings and come back: still Kilometres.
- [ ] Airplane mode on, tap **Miles**: the ✓ goes back to Kilometres and "That wasn't saved"
  shows. Airplane mode off, tap **Miles** again: it sticks. (Leave it on Miles for now.)
- [ ] **Account**: signed in as your email, Change sign-in password, Recycle bin. Sign out and the
  version line are at the bottom. (No need to sign out.)

## Into the chat

- [ ] On home, type "what did I save about the router?" and tap **↑**: the chat **slides up from
  the bottom** with your message, then Wilma's answer.
- [ ] **‹** (or Android back) slides it away. The **Continue** tile now shows that question; tap it:
  the same conversation, nothing sent again.
- [ ] Typing a space's exact name on home (e.g. "Recipes") still opens that space.

## The password card (home and chat)

- [ ] On home, type `my wifi password is Sunflower2024!` (made up). An **amber card** says Wilma
  won't send it, and **↑ is held**.
- [ ] **Save in Vault** opens "Save a secret" with the box **empty** (the text is not copied). Go
  back. **Edit message** puts you back in the box; delete the text: the card goes away.
- [ ] Same in the chat box: the card shows and Send is held.
- [ ] Tap 🎤 (home or chat): while listening, "Never type or say passwords here. Use the Vault."
  shows; it goes when listening stops.

## The chat box

- [ ] The chat's box is the same Wilma box (2 lines). While Wilma writes, **↑** becomes **■**
  (Stop); tap it: the answer stops and Send comes back.
- [ ] **＋** opens **📍 Send where I am**, take a photo, choose pictures, new note.
- [ ] Tap **📍 Send where I am**: "Finding where you are…", then a chip says your location goes
  with your next message. Its **✕** removes it without reading again. If location was already
  allowed, **no question** is asked.
- [ ] **New chat** (top right) asks first, then empties the conversation. Your notes are untouched.

## Place cards (new)

- [ ] Ask "which restaurants have we been to?". Wilma names them **and** a **📍 card** lists them
  (at most 5): name, kind and cuisine, address, **Open in Maps**, **Open note**.
- [ ] **Open note** opens that place's note. **Open in Maps** opens Google Maps at the place (its
  saved link, its location, or a search for its address).
- [ ] ＋ → **📍 Send where I am**, then "what restaurants are near me?". The answer is in **miles**
  ("about 0.5 miles"), nearest first, and the cards show "about N miles". She does not read your
  coordinates back.
- [ ] Settings → **Kilometres**, then ask the same with 📍 again: "about N km" in the answer and on
  the cards. Set it back to Miles afterwards.
- [ ] A place with **no location** (Hinode Sushi or Lemongrass, if you haven't given them one yet,
  or make "Test Café" with an address only): ask with 📍 "any sushi near me?". Wilma names it
  and says it has no saved location: **no distance** for it, on the card or in the text.
- [ ] If nothing is within 10 miles of you, Wilma says so and offers the nearest one.

## The 📍 Share where I am card (new)

- [ ] Without ＋ → 📍, ask "anything good to eat near me?". A **📍 card** asks to share where you
  are, with **Not now** and **📍 Share where I am**. Nothing is read yet.
- [ ] Tap **Not now**: the card shrinks to "Not now". Nothing is read, nothing is sent.
- [ ] Ask again, tap **📍 Share where I am**: "Finding where you are…", then your question goes to
  Wilma **again** with your location and she answers with distances. The card shrinks to "Shared
  where you were, for that question only".
- [ ] Ask "and any cafés?" without sharing: she doesn't reuse the old location (she asks again, or
  asks which saved place you're near).
- [ ] Phone Settings → Apps → Wilma → Permissions → Location → **Don't allow**. Ask "near me?",
  tap Share: the card says how to allow it, and **nothing is sent**. Allow it again ("only while
  using the app").
- [ ] Location off in quick settings, tap Share: a plain sentence says location is off. Turn it on.
- [ ] If you have a **restricted** space with a place in it: near that place, share your location
  and ask "anything near me?". It **never** comes up, on a card or in the text, and nothing hints
  that something is hidden.
- [ ] Close Wilma fully and open it again: the conversation is there, the place cards show names
  and buttons but **no distances**, and nothing shows where you were.

## The other chat cards (one shell now)

- [ ] "Show my Wi-Fi password" (or any vault entry): a **🔒 card** with **Open in the vault**; it opens
  the app's vault, never a web page.
- [ ] Make a note "Test note", then in the chat "delete Test note": a **🗑 card** with **Cancel**
  then **Delete** (red text). Cancel: it shrinks to "Left “Test note” alone". Ask again, Delete:
  "Deleted “Test note”" (it is in the recycle bin).
- [ ] With airplane mode on, send a message: a **⚠️ card** with **Try again** (filled). Airplane
  mode off, Try again: the answer comes.

## Places basics (from the versionCode 10 and 11 lists)

- [ ] **📍 Save here** tile: Android asks for location the first time only; New note opens as a
  Place with the location filled in. Save "Test spot". Open it: **Open in Maps** goes there.
- [ ] In Google Maps, open any place, **Share** → Wilma: the share screen opens as a **Place** with
  the name and link. Cancel (or save and delete it later).
- [ ] On a place, type the note `the door code is 4821` and Save: **refused**, pointing to the Vault.
- [ ] In the chat with 📍: "what's near me? Also save on Test spot that the gate code is 7719". The
  places answer comes; the code is **not** saved: Wilma points to the Vault.
- [ ] Open a space: **Edit** in the header renames it; a note's **Edit note** has a **Space** row
  (no restricted spaces) that moves it.
- [ ] Vault screens, sign-in and Change sign-in password: **no 🎤**.

## Light and dark

- [ ] Phone Settings → Display → dark theme on. Home, Settings, the chat, every card above and the
  vault are readable (no white boxes with white text). Back to your usual theme.

## Clean up

- [ ] Delete "Test spot", "Test Café", any shared test place and "Test note" (recycle bin; empty
  it if you like). Settings → Distances back to what you want.

## Report back

Tell me which lines failed, what you did and what you saw. These are **stop-ships**:

- location asked at start-up, or read without a tap (📍 Save here, Use where I am now, ＋ → 📍
  Send where I am, or 📍 Share where I am);
- your location sent with a message you didn't share it for, or shown after reopening the app;
- a restricted place shown, or hinted at, in any answer or card;
- a password-looking message sent anyway, or its text copied into the vault screen;
- a code or your location saved in a note or a space description;
- a distance for a place without a location, or in the wrong unit;
- a crash anywhere on this list.
