# Phone checklist for versionCode 20: homes

For the owner, on the Play build after versionCode 19. This file covers **homes** (design D36,
`docs/my-places-plan.md` steps 3-5). versionCode 20 also carries other work merged by then (tasks
left open, step 2; and, if merged, alarms and reminders #207/#208, Pick a day #209, Help
#211-#213): their phone checks are in their own plan docs and go below as they merge.

The server parts are already live (`chat` v33, `mcp` v34). About 20 minutes for homes. You need
**two homes** for the noticing part (for example Home and a friend's or a relative's place you can
visit, or a café saved as "Work").

## Before you start

- [ ] The privacy page shows **"Your homes:"** under What Wilma stores and **"Notice which home I'm
  at when I plan"** in the Location paragraph (published when the step 5 PR is merged).
- [ ] Play Console: **no Data safety change** for homes (`docs/phase4-play-release.md`, Homes).

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**.
- [ ] Settings → **Homes** shows your Home (moved from your old Home note in step 1) as
  **"🏠 Home ★"** with its address.

## Settings → Homes

- [ ] **＋ Add a home**: name "Mom's" (or your second place), Next, **Type an address**, Find it:
  "📍 Found at …"; Use this place. It is listed under Home, without ★.
- [ ] Tap it: **Check on Maps** opens the right spot.
- [ ] **Make default**: the ★ moves to it. Make Home the default again.
- [ ] Rename it to **"Gate code 1234"**: refused ("looks like a password or a code"), nothing changes.
- [ ] Add a third home with **Use where I am**: it says "Set from where you were". **Delete** it:
  asked first ("gone for good"); then gone.

## My day

- [ ] Today: **"🏠 Planned from Home · Change"** at the top. Change → pick the second home: drive
  times now start there. **Tomorrow** still says Home.
- [ ] Change → **Manage homes** opens Settings → Homes; back again, the plan updates.
- [ ] 🚸 **Drop off & pick up** on an event, leave My day and come back: still on (it was forgotten
  before).

## Chat: saving a home

- [ ] "My mom's house is 4 Elm Rd, Oviedo, save it as a home" (your real second address): a **🏠
  card** with "Found at", **Check on Maps**, **Save** and **Save as default**. Nothing in Settings →
  Homes yet.
- [ ] Leave the chat and come back: the card still waits. Tap **Save**: the card says it is saved;
  Settings → Homes lists it (or shows the new address, if that name already existed).
- [ ] "I'm home, save this as my home" (no address): the card offers **Use where I am**.
- [ ] "Plan my day from Mom's": the plan's drives start there.
- [ ] "Save my gate code 4821 as a home": no card with Save; Wilma points to the Vault.

## Noticing which home you're at

- [ ] Settings → Homes: **"Notice which home I'm at when I plan"** is **Off**. Turn it **On**: the
  location permission is asked if not already given.
- [ ] **At your second home** (not the default): open My day for **today** → "📍 You're at …. Plan
  your day from: 🏠 Home · 🏠 …". Tap the second home: drives start there. Close and reopen My day:
  **not asked again** today.
- [ ] Same place, another day, in the **chat**: "plan my day" → the 📍 card comes **first**, before
  any plan; tap **Home** → the plan starts from Home.
- [ ] **At your default home**, and somewhere that is neither: nothing is asked.
- [ ] Switch **Off**: nothing is asked, and no location icon shows in the status bar while planning.
- [ ] **Tomorrow's** plan never asks.

## If something is wrong

Note what you tapped and what you saw, and tell Claude in a new session (point it at this file and
`docs/my-places-plan.md`). Never paste a password or code into the chat.
