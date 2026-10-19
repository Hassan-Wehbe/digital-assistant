# Date night and family day planners

Status: plan, 2026-10-19, **waiting for the owner's answers (Q1-Q10, below)**. Design: D40 (and
D25, the day planner; D26, places; D31, calendar entries; D38, the Plan with Wilma row). Mockups:
the owner's private canvas "Wilma Home and Planners", screens "Date night" and "Family day".
Model: the strongest for steps 1-4 (a new table holding details about children, the AI request,
the chat); a smaller one is fine for step 5.

## Why

The owner (2026-10-18): "need to plan for multiple buttons, plan date night, plan family activities
for the day, and eventually plan vacation options." Home's Plan with Wilma row already shows Date
night and Family day as "Soon" (D38). Most of what they need exists: saved places with occasions,
ratings, price and visits (D26), drive times and weather (D25), the phone's calendar, and the 📅
calendar card (D31). What is new is a way to ask, a small household setting, and one AI request
that turns a short list of places into a timed plan.

## Decided already (owner, 2026-10-18, D40)

- Buttons on Home's Plan with Wilma row; **Vacation stays "Soon"** (flights, lodging and search are
  a separate design).
- **Date night:** when, budget and mood; Wilma proposes a timed evening from saved places marked
  date night, favourites not visited lately, or ones marked want to go, with drive times and
  weather; Add to calendar through the 📅 card.
- **Family day:** who is coming, from a small **household** setting (names or labels and
  children's ages, nothing more), indoor or outdoor; the plan fits around the calendar and the
  weather.
- **Saved places only** at first (a paid place search for "somewhere new" is a later decision).
- **Pro**, like My day: one AI request and a few Mapbox calls per plan.
- The household setting goes to the AI **only while planning**, never to Mapbox; the privacy page
  gets a line before that build.

## What exists today

- **Places** (`item_type 'place'`, `mcp/lib/places.ts`): kind (restaurant, cafe, bar, shop,
  to-visit, …), cuisine, price level 1-4, status want/been, rating 1-5, would return, occasions
  (`date_night`, `kids`, `business`, `quick_lunch`, `group`, `special`), visits (date, who with), and
  a point. `find_places` filters by kind, status, cuisine, occasion and distance.
- **My day** (`chat/day.ts`, `_shared/dayplan/`): the phone's calendar sent by the app, homes
  (D36), drive times from Mapbox with traffic, hourly rain from the US National Weather Service,
  free gaps, Pro and a daily fair-use count (`use_day_plan`). No AI request; the plan is never
  stored (Mapbox's terms).
- **The 📅 card** (D31): one calendar event (title, start, end, location), added only on a tap.
- **Not there yet:** who is in the family; whether a place is indoor or outdoor; a plan with
  several stops; notes on a calendar event.

## What the owner will see

**Date night** (from Home's ❤️ Date night; mockup "Date night"):
- **When:** this Friday 7 pm, Saturday, or Pick… (a day and a start time).
- **Budget:** $ · $$ · $$$ (matched to places' price level).
- **Mood:** A favourite (been, rated well, not visited lately) or Somewhere new (want to go).
- Then **one plan card**: "Dinner and a walk", BEST FIT; leave home 6:40 · 18 min; 7:00 the
  restaurant (Italian · $$, "You rated it 5 · last went in July"); 8:45 a second stop if one fits;
  the weather line; **Add to calendar** and **Open in Maps**. Under it, one alternative ("Somewhere
  you wanted to try … Use this one") and **Another idea** (a new plan, counted).

**Family day** (from 👨‍👩‍👧 Family day; mockup "Family day"):
- **Day** (Saturday by default, or Pick…), **Who** (chips from the household: "2 adults", "2 kids
  (6, 9)", each can be turned off for this plan), **Kind:** Outdoors · Indoors · Either.
- The weather line ("Sunny until 3 pm, showers after. Outdoor things go first.").
- **A timed day** around the calendar: outdoor stops in the dry hours, the calendar's own events
  kept as they are ("Your 11:00 soccer practice … kept as they are"), lunch at a kid-friendly saved
  place, an indoor idea for the rain; each line with its drive.
- **Add to calendar** and **Change** (back to the choices).

**Settings → Household** (new): people, each a name or label ("Me", "Sam", "Kid 1") and, for a
child, a birth year (Q3). That's all. Used only by Family day.

**The chat:** "plan a date night Friday" and "plan a family day Saturday, outdoors" make the same
plans (step 4), shown as the same cards.

## How it works

1. **Household** (step 1): a table `household_member (user_id, label, kind adult|child,
   birth_year?, position)`, RLS own rows, anon nothing, at most 10 people; labels pass the
   password check (rule 9). Read and written by the app as the user. Never an item, never searched,
   never in memory, never shared.
2. **The planner route** (step 2): the `chat` function gets `{"mode":"outing", kind, date, start?,
   budget?, mood?, setting?, who?}` with the phone's calendar for that day (as My day). Pro and the
   fair-use count are checked first, as for My day.
   - **Code makes the short list** (no AI): the user's places in searchable spaces only (rule 3),
     with a point. Date night: occasion `date_night`, or a restaurant/bar/cafe rated 4-5 not
     visited for 30 days (A favourite), or status want (Somewhere new), within the budget; family
     day: occasion `kids`, kind to-visit, or a restaurant marked kids. At most 8, nearest and best
     first, from the home it starts from (D36).
   - **Drive times** from that home to each short-listed place (Mapbox, at most 8 legs), and the
     **weather** for the day at those points (NWS).
   - **One AI request** gets the short list as facts (title, kind, cuisine, price, rating, last
     visit, occasions, minutes away, rain by hour), the free hours from the calendar, the budget or
     mood, and for a family day only **roles and ages** ("adult", "child 6"), **never names**. It
     must answer with JSON: a title, 2-5 steps, each a place id **from the short list** (or a home or
     calendar step) with a start time and one short line, and one alternative. **Code checks
     everything:** unknown ids, times outside the free hours or overlapping the calendar, more steps
     than allowed → dropped or the plan refused; then real drive times for the chosen order are
     added (a few more legs at most).
   - The plan is **never stored** (as My day); "Another idea" asks again (counted again).
3. **Add to calendar** (step 3): one event for the whole plan ("Date night", start of the first
   step to the end of the last, the first place as its location), with the steps in the event's
   notes (the 📅 card gains a notes line). Only on the tap, as today (D31).
4. **The chat** (step 4): a tool `plan_outing` with the same route; the plan comes back as the
   same card; the model words it, never invents a place (only short-list ids).

## Rules check

- **Secrets (rules 1, 2, 9):** household labels pass the password check; places and plans are
  ordinary content. No secret is ever read. Evaluation traps in steps 2 and 4.
- **Restricted spaces (rule 3):** the short list reads places only from searchable spaces; a place
  in a locked space is never suggested, counted or hinted at.
- **Every row owned (rule 5):** `household_member` with RLS on, own rows only, anon nothing; the
  migration revokes anon and grants only what authenticated needs.
- **Children's details:** only a label and a birth year, entered by the parent; sent to the AI only
  as "child 6" while planning (no name), never to Mapbox or the weather service, never stored with a
  plan. The privacy page and the legal checklist get a line in step 5; Play Data safety is checked
  then.
- **History and delete (rules 7, 8):** the household is a setting, not an item: changes overwrite,
  a removed person is gone (as homes). No item is changed by planning.
- **Cost:** one AI request per plan (Pro fair use, counted like a My day plan plus the AI
  allowance); at most about 10 Mapbox legs per plan; weather is free.
- **Sharing:** not in this plan.

## Questions (recommendation first)

- **Q1. How a plan is made:** **code short-lists, one AI request orders and words it, code checks
  it** (rec.: places the AI cannot invent, times that fit, one small request); or no AI at all (a
  fixed template: dinner, then a walk; cheaper, but stiff, and family days vary a lot).
- **Q2. Where you ask:** **a screen for each, as in the mockups, plus the chat in step 4** (rec.);
  or the chat only (Home's buttons would open the chat with the words filled in).
- **Q3. A child's age:** **kept as a birth year, so it stays right** (rec.); or the age as typed
  (you update it each year).
- **Q4. What the AI hears about the family:** **roles and ages only ("2 adults, children 6 and 9")**
  (rec.); or names too (warmer wording, "Sam will love the farm", but names go to the AI).
- **Q5. Indoor or outdoor:** **Wilma judges from what a place is** (a park, a museum, a farm),
  and you can mark a place Indoor or Outdoor later if she gets it wrong (rec.); or a new place
  field from the start.
- **Q6. Add to calendar:** **one event for the whole plan, with the steps in its notes** (rec.: one
  tap, one event); or one event per stop.
- **Q7. Another idea:** **counts as another plan** (rec.: each is a real AI request and drive
  times); or free up to 3 per plan (cheaper to use, costs us more).
- **Q8. Date night's mood:** **A favourite or Somewhere new (want to go)** (rec., as the mockup);
  or add "Surprise me" (either).
- **Q9. Family day's hours:** **9 am to 6 pm, around the calendar** (rec.), changeable on the
  screen; or the whole day from when you wake.
- **Q10. Who sees Family day:** **everyone with Pro; the household setting is optional** (without
  it, Who is "Adults" and "Kids" chips with an age box) (rec.); or Family day asks you to set up
  the household first.

## Steps

1. **Household (strongest model).** Migration `household_member` (RLS, anon nothing, at most 10, a
   label check), its SQL test and a dry run; app Settings → Household (add, rename, birth year,
   remove). **Owner:** dry run, OK to apply.
2. **The planner route (strongest model).** `{"mode":"outing"}` in the `chat` function: the short
   list (code), drive times and weather, one AI request with a strict JSON answer, every field
   checked; Deno tests (restricted places never reach the list, names never reach the AI, an
   invented place id dropped); evaluation cases. **Owner:** OK + cap for an evaluation run, merge,
   OK to deploy `chat`.
3. **The app (strongest for the plan card, smaller for the screens).** Date night and Family day
   screens, the plan card, Open in Maps, Add to calendar (one event, notes); the row's Soon removed
   for both. App tests.
4. **The chat (strongest model).** `plan_outing` for "plan a date night Friday"; the same card;
   evaluation cases with traps (a restricted place, a password in a household label, a child's
   name never reaching the reply when names are off).
5. **Help, privacy, checklist, build (smaller model).** Help topic lines, the privacy page's
   household line, the legal checklist item for children's details, Play Data safety check, the
   phone checklist, then the build.
