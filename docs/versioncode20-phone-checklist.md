# Phone checklist for versionCode 20

For the owner, on the Play build after versionCode 19. It carries:

- **homes** (D36, `docs/my-places-plan.md` steps 3-5): Settings → Homes, the 🏠 chat card, "Planned
  from … · Change", noticing which home you are at;
- **alarms, reminders and calendar entries** (D31, `docs/alarms-calendar-plan.md` steps 2-4);
- **tasks left open at the end of their day** (D35, `docs/task-day-end-plan.md` step 2);
- **My day opens the day asked for, and 📅 Pick a day** (#209);
- **Help**: the "?" and its topics (D37, `docs/help-plan.md` step 1). Step 2 is live on the server
  (`chat` v34): Wilma's help answers are short; the 🛟 card comes with step 3, not in this build.

The server parts are already live (`chat` v34, `mcp` v34). About an hour in all. You need **two
homes** for the noticing part (for example Home and a relative's place you can visit, or a café
saved as "Work"), and **Android** for alarms, reminders and calendar entries.

## Before you start

- [ ] The privacy page shows **"Your homes:"** under What Wilma stores and **"Notice which home I'm
  at when I plan"** in the Location paragraph (published when the step 5 PR is merged).
- [ ] The privacy page shows **"Alarms and reminders (Android)"**, and the calendar paragraph says
  Wilma adds an event only when you tap **Add to calendar** (published when alarms step 4 is merged).
- [ ] Play Console: **no Data safety change** for this build (`docs/phase4-play-release.md`: Homes;
  Alarms, reminders and calendar entries).

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

## Alarms and reminders (Android)

- [ ] "Wake me at 6:30": tap **Set in Clock**. The Clock opens at 6:30; save; it rings.
- [ ] "Alarm at 5:45 on weekdays": the Clock opens at 5:45 and the card says to tick Mon–Fri.
- [ ] "Cancel my 6:30 alarm": **Open Clock** shows the list.
- [ ] "Remind me in 5 minutes to stretch": tap **Set reminder** (allow notifications). It shows on
  time or a few minutes late, as a heads-up.
- [ ] "Cancel my reminder to stretch" (with one set): the card lists it; Cancel works. Settings →
  **Reminders** shows the same list.
- [ ] "Remind me at 6 that the gate code is 4821": no reminder card; Wilma points to the Vault.
- [ ] Sign out and back in: Settings → Reminders is empty.

## Calendar entries (Android)

- [ ] When updating, Android shows **no new permission prompt** for the calendar (read and write
  were granted together). Settings → Calendars says Wilma adds an event only when you tap Add to
  calendar.
- [ ] Settings → Calendars (Use my calendar on): **"New events go to"** lists only calendars you can
  add to (no Holidays or Birthdays); your main calendar is chosen. Pick another; it stays chosen.
- [ ] "Put the dentist on my calendar Tuesday at 3": the card says Tue · 3:00 pm – 4:00 pm and the
  calendar you chose. Don't tap: the calendar app shows nothing new.
- [ ] Tap **Add to calendar**: "Added to …"; **Open in Calendar** shows it, 3-4 pm, with your
  calendar's usual reminder. Close and reopen the chat: the card still says Added.
- [ ] "Put Lexi's recital on Friday": an all-day event on **Friday** (not Thursday or Saturday) in the
  calendar app.
- [ ] On a card, **Change details**: change the time and the place, and Change the calendar; add it;
  the calendar app has what you set, in that calendar.
- [ ] Ask for an event at a time you already have something: the card says "You have … then".
- [ ] Change a card's title to "garage code 4471": the card refuses, and Add to calendar is greyed.
- [ ] Turn off Use my calendar, ask for an event: the card says to turn it on; nothing is added.

## Tasks left open

- [ ] Give a task a time today with *Mark it done*; the next morning it is not in My day and Tasks
  shows it done.
- [ ] The same with *Move to the next day*: the next day it is in "Not placed yet", without its time.
- [ ] A task with a time and *Ask me*: the next day "Left open yesterday" shows it; try Add to today
  (then Find a time), Done, and Remove (then find it in the Recycle bin).
- [ ] A task with a time on a later day does not show in today's plan.

## My day: the day asked for, and Pick a day

- [ ] In the chat, "plan Tuesday the 13th" (a day after tomorrow), then **Open my day**: it shows
  that day, not today.
- [ ] My day: **📅 Pick a day** opens the date picker; pick a day next week: its plan shows, and the
  chip shows that date.

## Help

- [ ] Home: tap **?**. Help lists the topics; Alarms is there (Android). **Places & Homes** has a
  Settings → Homes link.
- [ ] Open **Passwords & the Vault**, tap **Open the Vault**: the Vault opens.
- [ ] Open **Alarms…**, tap "Wake me at 6:30": the chat opens with those words in the box, not sent.
  Tap the same example again from Help: the box fills again.
- [ ] In Ask Wilma, tap **?**, pick a Try it: back in the same chat with the words in the box.
- [ ] Settings → **Help** opens the same list. The welcome card (new account) says "Tap ? any time
  for help."
- [ ] In the chat, "what can you do?": a short answer (a few lines, not a long list).

## If something is wrong

Note what you tapped and what you saw, and tell Claude in a new session (point it at this file and
`docs/my-places-plan.md`). Never paste a password or code into the chat.
