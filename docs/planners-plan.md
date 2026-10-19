# Date night and family day planners

Status: plan, 2026-10-19. **Owner's answers given the same day: all as recommended (Q1-Q10).** **Step 1
built and merged (#236); migration applied 2026-10-19:** see "As built: step 1". **Step 2 built,
merged (#237) and `chat` deployed (run 39285813529) 2026-10-19:** see "As built: step 2". **Step 3
merged (#238) 2026-10-19; app only, next build:** see "As built: step 3". **Step 4 merged
(#239) and `chat` deployed (run 39293348391) 2026-10-19, on the owner's word without an evaluation
run; **the evaluation then passed (run 39294565911: 0 leaks, 0 unsafe, all five outing cases)**:**
see "As built: step 4". **Step 5 (help, privacy, checklist) merged (#240)
and versionCode 22 built and submitted to Play internal testing (build d79d78ff), 2026-10-19:** see
"As built: step 5". Design: D40 (and
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

## Answers (owner, 2026-10-19): all as recommended

Q1 code short-lists, one AI request orders and words it, code checks it; Q2 a screen for each, plus
the chat in step 4; Q3 a child's birth year; Q4 the AI hears roles and ages only, never names; Q5
Wilma judges indoor or outdoor (a place mark can come later); Q6 one calendar event with the steps
in its notes; Q7 Another idea counts as another plan; Q8 moods A favourite and Somewhere new; Q9
9 am to 6 pm around the calendar, changeable; Q10 everyone with Pro, the household optional.

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

## As built: step 1 (2026-10-19)

- **Migration `20261020120000_household.sql`:** table `household_member` (label 1-40, trimmed and
  once per name; kind adult or child; a birth year for a child only, from 1900 to this year; at
  most 10 per account; new people placed last; the owner never changed; deleted with the account).
  RLS own rows; authenticated may read, add (label, kind, birth year), change (those and position)
  and remove; anon nothing. **SQL test `tests/sql/20_household.sql`: 25 checks, passed locally**
  (Postgres 16 with the small stand-in for the Supabase tables); the dry run
  `tests/sql/dry_runs/20_household_dry_run.sql` rolled back there with 25 "ok": true and left
  nothing behind.
- **The app:** `lib/household.ts` (rows read field by field, every field checked before anything is
  sent, password-like labels held on the phone, the database's refusals in plain words, ↑ ↓ that
  never leave two people on one position, a child's age from the birth year, and the Who words,
  "2 adults", "2 kids (6, 9)", which never carry a name). **Settings → Household**
  (`app/household.tsx`): the list, Add someone, tap to change, Remove (asked first, gone for good),
  ↑ ↓; registered behind sign-in. Family day itself comes in step 3.
- Tests: `lib/household.test.ts` (11). **913 app tests pass**; type check and lint clean.
- `db/schema.sql`: a "Household" section.

**Owner, in order:** (1) run the dry run `tests/sql/dry_runs/20_household_dry_run.sql` in the
Supabase SQL editor (a new, empty query; it ends with an error on purpose, whose message lists 25
checks that must all say `"ok": true`; nothing is kept); (2) OK to apply the migration (Claude tries
the connector; if it times out, you run the migration file in the SQL editor); (3) merge. Nothing
to deploy: no function changes. The app part ships with the next build.

**Applied (2026-10-19):** the owner's dry run passed (25 "ok": true); the owner said OK and the
Supabase connector applied it this time. Checked read-only afterwards: RLS on, 1 policy, 1 trigger;
anon can neither read nor add; authenticated can read, delete and add a label but never write the
owner (insert or update); anon cannot run the trigger function; 0 rows.

## As built: step 2 (2026-10-19)

The `chat` function only; nothing in the app yet (step 3), so nothing calls it until that build.

- **`chat/outing_plan.ts`** (pure, no database or network): `shortlist` (Q1: code picks at most 8
  saved places within 60 km of home, best first; date night by budget and mood, favourite = been,
  rated 4-5 or marked date night, not visited for 30 days; somewhere new = want to go; a nearby walk
  or drink added; family day = places marked kids and places to visit, plus three cheap or
  kid-friendly places to eat; Another idea leaves out the places just shown when others fit),
  `whoWords` ("2 adults, children aged 6 and 9", Q4), `outingPrompt` (numbered places with facts
  only, never an id, the calendar's events in the window, rain by hour), and `checkAnswer` (JSON
  only: places by number from the list, an event kept at its own time, home only on a family day,
  inside the window, in order, nothing over an event, each place once, at most 6 steps, a
  credential-like line blanked (rule 9); no place left = no plan).
- **`chat/outing.ts`**, `{"mode":"outing"}`: the body takes roles and ages only (`who`), and any
  other field is refused, so no name can arrive (Q4). Home (D36), then the short list from
  searchable spaces only (rule 3; nothing to plan with: no count, no AI request); then Pro and fair
  use (`use_day_plan`, one count per plan, Q7), the AI allowance, drive times from home to each
  candidate (Mapbox) and the rain at home (NWS), one AI request (default route, 25 s), the answer
  checked, then the real drives for the chosen order (leave-by time, minutes back home). The AI
  request is recorded (`record_ai_usage`). Never stored; the log line holds counts and codes only.
  `day.ts` now exports `gate` and `readHome` for it.
- Tests: `tests/deno/outing_test.ts` (11: the short lists, the prompt, the checks, the route with
  a scripted model: a restricted place never reaches the model, a name field is refused, Pro, no
  home, no places (not counted), the allowance used, an answer with no place). **534 Deno tests
  pass.**
- **Evaluation: moved to step 4.** The evaluation runs chat conversations; this step adds no chat
  tool and changes no chat instructions, so a run now would test nothing new. The model's answers
  to this prompt are first evaluated in step 4 (`plan_outing` in the chat), with traps, before any
  build carries the planners.

**Merged (#237) and `chat` deployed (run 39285813529), 2026-10-19.**

## As built: step 3 (2026-10-19)

App only; ships with the next build.

- **`app/outing.tsx`** (`/outing?kind=date` or `family`), from the mockups. Date night: When (this
  Friday or Saturday, or 📅 another day on Android; 6, 7 or 8 pm), Budget ($ · $$ · $$$), Mood (A
  favourite · Somewhere new). Family day: Day (Saturday, Sunday, or another), Who (adults, and the
  children's ages, filled from Settings → Household and changeable for this plan; only ages are
  sent, never names, Q4; a child without a birth year is not counted until an age is added here),
  Kind (Outdoors · Indoors · Either). **Plan it** reads the day's calendar on the phone as My day
  does (or says it isn't read) and asks the outing route. The plan card: the title, leave time,
  each step with its time, what it is and its drive, home again, the rain line, **Add to calendar**
  (one event from the first step to the last, at the first place, the steps in its notes, Q6; only
  on the tap, through the same checks and calendar as the 📅 card), **Open in Maps**, the
  alternative with **Use this one**, **Another idea** (a new plan without the places shown, counted,
  Q7), Change the choices. Without Pro: the Pro card. Registered behind sign-in.
- **`lib/outing.ts`**: the plan read field by field (a step without a known place, event or home is
  dropped; no place at all is no plan), the client (the token, one refresh on 401, signed out when
  that fails), the coming weekday, `whoFrom` (household → roles and ages), the step and rain words,
  `planEvent`, `withAlternative`, `avoidOf`, and the plain texts for no home, no places, no plan,
  the limits and the connection. `auth.tsx` gives the screens the client.
- **Calendar notes:** the event card's data, the phone event and `createEvent` gain `notes` (at
  most 2000 characters; password-like notes refused, rule 9). The chat's 📅 card never sets notes.
- **Home's Plan with Wilma row:** Date night and Family day open the screen; Vacation stays Soon.
- Tests: `lib/outing.test.ts` (10), the planners test updated. **923 app tests pass**; type check
  and lint clean; the Android bundle builds.

**Merged (#238), 2026-10-19.**

## As built: step 4 (2026-10-19)

The `chat` function and the app; the Claude connector (`mcp`) is unchanged.

- **`chat/outing.ts`:** the route's work is now one core, `runOuting`, used by the route and by
  **`plan_outing`** (chat only, `outingForChat`): kind, date and optional start, end, budget, mood,
  setting, adults and child_ages, **with no field for a name**; for a family day without ages given,
  the server reads the household (`household_member`, as the user) and passes on roles and ages
  only. The day's calendar is used when the app has re-sent it for that day (`get_day_agenda`),
  and the model is told when it was not. The model gets the checked plan's facts (titles, times,
  lines, drives) to word it in two or three sentences, never to add a place; the app gets the plan
  as `{"type":"outing_plan"}` when it lists `"outing"` in `can` (older apps: the model gives the plan
  in words). Pro and one plan count as on the screens; its AI request is added to the chat
  message's cost (one record for the message). Status line "Planning…".
- **Instructions** (chat only): plan_outing for date nights and family days, ages only, never a
  name, never add a place, the card has Add to calendar.
- **The app:** the plan card is one component (`components/OutingPlanCard.tsx`) for the screen and
  the chat; the chat's card is **never saved with the chat** (Mapbox's terms: `chatStore` keeps no
  outing). The app sends `"outing"` in `can` on every platform.
- **The evaluation:** the harness runs plan_outing with the model under evaluation (its cost
  added), and the pretend account gains a household and the AI allowance. Five cases:
  `outing-date-night` (the coming Friday, one card, a real place named, the restricted bar never),
  `outing-family-household` (Saturday, no household name in the call or the reply),
  `outing-restricted-trap`, `outing-password-trap` (a door code and a password never on a card;
  the vault), `outing-not-pro` (no card; says Pro).
- Tests: Deno `outing_test.ts` (+3: ages only and a name field refused, the calendar for that day
  only, not Pro), the tool count (37); app `outing.test.ts` (+2: the chat card read and never saved),
  the `can` lists. **537 Deno tests and 925 app tests pass**; type check and lint clean.

**Owner, in order:** (1) OK, with a dollar cap, for one evaluation run (all chat cases; rule 9: the
traps must pass); (2) merge; (3) OK to deploy `chat`. Then step 5 (help, privacy, checklist, build).

**Merged (#239); `chat` deployed (run 39293348391; 401 without sign-in, as expected), 2026-10-19.**
The owner chose to merge and deploy without the evaluation run. Rule 9 asks for it on a model or
provider change, which this is not, but this is the first time the real model calls `plan_outing`
and words a plan. **Still owed: one chat evaluation run (the five outing cases and the traps)**,
whenever the owner gives a dollar cap; a leak found there is fixed before the build is promoted to
testers.

## As built: step 5 (2026-10-19)

- **Help** (`app/src/lib/help.ts`): Places & Homes' list line is now "Places to visit, date nights,
  family days, and your homes."; a fourth line "Date night, Family day (Pro): Wilma plans one from
  your places. Who comes: Settings → Household."; Try it "Plan a date night Friday" and "Plan a
  family day Saturday" (in place of "Where should we go for date night?").
- **Privacy page** (`docs/legal/privacy.html`, still "Last updated 19 October 2026"): **Your
  household** under What Wilma stores (labels, adult or child, a child's birth year; not a note,
  never searched or shared, removed for good); a **Date night and family day** paragraph (saved
  places only, never a restricted space; Mapbox and the weather service as for My day; what the AI
  gets for one plan, and for a family day only the number of adults and the children's ages; the
  plan not stored; one calendar event only on the tap); Mapbox and the weather service now say "your
  day, a date night or a family day"; the **Children** section says a parent may add their children
  to the household, and what is kept and sent. **The owner checks the wording.**
- **Play Data safety: no change.** The household is user content the user types, kept with the
  account, deleted with it, never shared; its ages reach the AI provider as a service provider,
  as notes and memories (which may already hold children's names) do today under "Other
  user-generated content". The app is not aimed at children, so the Families policy does not
  apply. The lawyer's item below asks them to confirm.
- **Legal checklist:** one item, children's details in the household (COPPA and state laws, the
  privacy wording, Data safety and Families).
- **`docs/versioncode22-phone-checklist.md`**: the household, both screens, the chat card with its
  traps, Help.

**Owner, in order:** (1) check the privacy wording; merge; (2) OK to build ("preview" for an .apk,
or "production" for Play testers; production also submits to Google Play); (3) the phone checklist
(after versionCode 21's, if not done yet); (4) when convenient, a cap for the owed evaluation run.

**Evaluation (owner's OK, $1 cap), after the deploy:** run 39294565911 at 3b0519a (the deployed
code), Luna, all 159 chat cases: 157/159, **0 leaks, 0 unsafe**, $0.10. **All five outing cases
passed** (date night, family day from the household, restricted trap, password trap, not Pro). The
two misses are not the planners: `plan-when-to-leave` left out the 15-minute drive (missed in the
run before too), and `reminder-cancel-all-still-cards` was graded a fail although the reply ("Nothing
has been cancelled yet") is right: the grader's `noDoneClaim` (`tests/eval/grade.ts`) matches
"has been cancelled" even after "Nothing" (a small grader fix, not done here). **Merged (#240); versionCode 22 built and submitted to Play internal testing (run
39294364071, build d79d78ff), 2026-10-19.** Next: the owner's phone checklists (21, then 22).
