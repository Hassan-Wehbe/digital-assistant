# Phone checklist for versionCode 14: places you share, and your calendar

For the owner, on the Play build after versionCode 13. It carries:
- **"Is this it?" says where the match is** (#160): the found spot's street, town and country, a
  warning when Google Maps shared only a name, and Open in Maps on a note opens the saved
  location (`docs/places-plan.md` step 8, "Fix (owner, versionCode 13)").
- **Your calendar** (day planner step 1, #164 and #165): Settings → Calendars, and Wilma answering
  "what's on my day?" from the calendars you tick (`docs/phase6-day-planner-step1-plan.md`).
  The server side is already live (`chat` v14, `mcp` v22).

About 20 minutes. **Never type or say a real password or code.**

## Before you start

- [ ] Play Console: Data safety has **Calendar → Calendar events** (steps in
  `docs/phase4-play-release.md`, "Data types"). Send the change for review with this release.
- [ ] If not done yet: open **Craft & Common** and the pizza place → Edit note → **Remove the
  location** (their saved spots are in Orlando and in Spain).

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**.
- [ ] Nothing about the calendar is asked at start-up.

## Places you share from Google Maps

- [ ] In Google Maps, share **Craft & Common** to Wilma. The "Is this it?" card shows
  **📍 Found at:** with a street, town and country.
- [ ] When the share has no address, a line says it was **found by its name only** and to check
  the town.
- [ ] If the town is wrong, tap **No**: the place is saved without a location. If right, tap
  **Yes** and Save.
- [ ] Open a saved place note → **Open in Maps**: it shows the **saved pin** (where Wilma
  measures from), not Google's page. A note without a pin still opens Google's link.
- [ ] In the chat, a place card's Open in Maps does the same.

## Settings → Calendars

- [ ] Settings shows a **Calendar** section: **Calendars**, "Off".
- [ ] Open it. It explains what Wilma reads. Tap **Use my calendar**: Android asks **once** for
  calendar access. Allow.
- [ ] Your phone's calendars are listed (e.g. your Gmail calendar, Holidays, Birthdays), **all
  ticked**, with the account under each name.
- [ ] Untick one (e.g. Holidays). Go back: Settings says "On: Wilma may read N calendars".
- [ ] Close and reopen the app: the choice is kept.

## Wilma and your calendar

- [ ] Ask **"What's on my day?"**. A "Reading your calendar…" line may show, then Wilma
  answers with today's events and their times, in your time.
- [ ] Ask **"Am I free tomorrow at 3pm?"**: she answers from tomorrow's events.
- [ ] An event from the **unticked** calendar is never mentioned.
- [ ] A private event (if you have one) shows only as **busy**, never its title.
- [ ] Late in the evening (after 8 pm), "what's on my day?" still means **today**, not tomorrow.
- [ ] Settings → Calendars → **Turn off**, then ask "what's on my day?": a 📅 card says to turn on
  Use my calendar, with **Open Settings → Calendars**. Turn it on again from there.
- [ ] Phone Settings → Apps → Wilma → Permissions → Calendar → **Don't allow**. Ask again: the 📅
  card says where to allow it. Allow it again.
- [ ] In the Claude app (the connector), ask "what's on my day?": Claude says to ask in the
  Wilma app.

## Still works

- [ ] Typing "password" in the chat shows the vault card (no crash).
- [ ] "Restaurants close by" with 📍 names both restaurants.
- [ ] A 🔒 row in a space (e.g. Logins) opens the entry in the Vault.

## Report back

Tick what passed; for anything else, say what you did and what you saw (a screenshot helps).
