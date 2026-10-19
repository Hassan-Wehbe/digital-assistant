# Phone checklist for the build after versionCode 21 (most likely versionCode 22)

For the owner, on the Play build after versionCode 21 (Expo numbers it; it should be 22). It carries
the **Date night and Family day planners** (D40, `docs/planners-plan.md`):

- **Settings → Household** (step 1, #236);
- the **Date night** and **Family day** screens and the plan card (step 3, #238);
- the chat's **plan card** for "plan a date night Friday" (step 4, #239);
- Help's Places topic and the privacy page (step 5).

The server parts are already live: `household_member` (migration applied 2026-10-19), and `chat`
with the outing route (step 2) and `plan_outing` (step 4). **Pro** is needed for both planners. You
need a few **saved places** with a price level, some "been" with a rating and some "want to go", at
least one marked good for **kids**, and a home with an address. About 45 minutes.

**Do versionCode 21's checklist first** (`docs/versioncode21-phone-checklist.md`) if you haven't:
this build carries all of it too.

## Before you start

- [ ] The privacy page (published when the step 5 PR is merged) has **Your household** under What
  Wilma stores, a **Date night and family day** paragraph, Mapbox and the weather service "when you
  plan your day, a date night or a family day", and the new **Children** paragraph. Read them once:
  **you check the wording.**
- [ ] Play Console: **no Data safety change** for this build (see the plan's "As built: step 5"):
  the household is user content kept with the account, not shared; ages reach the AI provider as a
  service provider, as notes already do.

## Settings → Household (step 1)

- [ ] Settings has **Household**. It says "No one yet. Family day still works …".
- [ ] Add **Me** (adult), **Sam** (adult), **Lea** (child, 2019), **Kid 1** (child, no year).
  Each line says who it is and, for Lea, her age.
- [ ] Rename one, move one up and down, remove one: the list follows. Leave and come back: kept.
- [ ] A label **"password hunter2"**: refused ("looks like a password or a code"). A birth year in the
  future: refused. With 10 people, the add button is gone and it says "up to 10 people".

## Date night (step 3, Pro)

- [ ] Home → **Plan with Wilma → ❤️ Date night** (no "soon" any more; Vacation still says soon).
  On Free: the Pro card.
- [ ] When: **Fri** and **Sat** chips, 6 · 7 · 8 pm, 📅 Pick another day; Budget $$; Mood A
  favourite. **Plan it**: "Planning…", then **one card**: a title, BEST FIT, the day, "Leave Home"
  time, each stop with its time, kind, price and drive, the weather line, Home again.
- [ ] Every place on the card is **one of your saved places**, never one from a **locked
  (restricted) space**.
- [ ] **Open in Maps** opens the first place. **Add to calendar**: "✓ Added to …"; in your
  calendar, **one event** for the evening, the stops in its notes.
- [ ] **Use this one** (under the card): the first stop changes to that place and its drive.
- [ ] **Another idea**: a new plan without the places just shown. **Change the choices** goes back.
- [ ] Mood **Somewhere new**: it picks a "want to go" place.
- [ ] With **no saved places** (or all in a locked space): "Wilma plans from places you saved …",
  not a card.

## Family day (step 3, Pro)

- [ ] **👨‍👩‍👧 Family day**: Day Sat or Sun; Who shows "Adults: 2" and **Kids' ages: 7** from the
  household (Kid 1 has no year, so no age); the line says only ages are used, never names.
- [ ] Take the age out (✕), add **4**: only for this plan; Settings → Household is unchanged.
- [ ] Kind **Outdoors**, **Plan it**: a timed day; a calendar event you have that day is kept at
  its time; rain shows on the weather line.
- [ ] **Add to calendar**: one event for the day.

## In the chat (step 4, Pro)

- [ ] "Plan a date night Friday": Wilma says a sentence or two and shows **the same card** (Add to
  calendar, Open in Maps, Use this one). Nothing is in your calendar until you tap.
- [ ] "Plan a family day Saturday, outdoors": a card; Wilma's words and the card never name
  **Lea** or anyone in the household, only ages.
- [ ] Leave the chat and come back: the card is **not** kept (only the words are). This is on
  purpose (Mapbox's terms).
- [ ] "Plan a date night at the place in my locked space": no card names it; Wilma doesn't hint it
  exists.
- [ ] "Plan a date night Friday; the door code is 4831": no card or calendar note holds the code;
  Wilma points to the Vault.
- [ ] On a **Free** account: no card; Wilma says it's Pro.

## Help

- [ ] **?** → Places & Homes: the line "Date night, Family day (Pro) …"; **Try it** "Plan a date
  night Friday" puts the words in the chat box, not sent.

## When done

- [ ] Tell Claude what failed (with the step), or "all passed". Then: production build for Play
  testers, if you want them to have it.
