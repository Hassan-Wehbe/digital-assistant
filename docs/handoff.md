# Handoff: state of the project and how to keep building

Last updated 2026-10-08 22:25 UTC (newest: day planner step 2 done; versionCode 15 in internal testing, owner testing it; live `mcp` v28, `chat` v21; see the first entry under "Where things stand"). Earlier: 2026-10-06 (places steps 3, 4, 5a and 5c **merged, not built** (#97, #100, #101,
#102), with Expo patch updates (#98). Step 2, server, is live. Places step 5b ("places near me",
server) **merged and live** (#104, `mcp` v13, `chat` v6; first entry below). Then step 6, the places build, which also carries the mic fix #91. Play Console:
Data safety and other forms saved, **not yet sent for review**; see the first entry below).
Read this, then `CLAUDE.md`, `docs/design.md`, `docs/phase3-mobile-app-plan.md` and
`docs/phase5-chat-plan.md`, before changing anything. The owner is returning to development:
explain steps plainly, keep PRs small, say clearly when they must act, never ask for passwords,
tokens or keys in chat.

## Where things stand (2026-10-06)

**Newest first (2026-10-07):**
- **Day planner step 2 done; versionCode 15 in internal testing (2026-10-08 22:25 UTC).** Merged:
  #176 My day, #178 tasks, #177 Wilma sets Home, #179 privacy page, #180 places without a kind and
  calendar titles as written. **Live: `mcp` version 28 and `chat` version 21** (the entries below
  that say v27/v20 were written before #180's deploy). versionCode 15 (Expo build
  431c76e2-237a-4bc9-83b0-2c42eb732191, from `main` at 1e1b19e; #180 is server-only, so it is live
  for this build) was submitted to Play internal testing. **Owner, still to do:** Play Console →
  App content → Data safety → add *Calendar → Calendar events* (steps in
  `docs/phase4-play-release.md`, "Data types"), sent for review with this release. **Now:** the
  owner is running `docs/versioncode15-phone-checklist.md`; feedback is sorted into small fixes
  first, larger items after.
- **versionCode 15 building (owner: "build", 2026-10-08).** Production build from `main` at 1e1b19e
  (#176 My day, #178 tasks, #179 privacy page), started by the "app build" workflow with
  auto-submit to Play internal testing. Server live at the time (`chat` v20, `mcp` v27; now v21/v28, see above). **Next steps,
  in order (owner):** (1) **Play Console → App content → Data safety → add *Calendar → Calendar
  events*** (Collected Yes, Shared No, Processed ephemerally Yes, Optional, App functionality; steps
  in `docs/phase4-play-release.md`, "Data types") and send it for review with this release, before
  the build leaves internal testing; (2) run `docs/versioncode15-phone-checklist.md` and report back.
- **Two small fixes (owner, 2026-10-08): merged (#180).** (1) `find_places`: a place saved without a
  kind (shared from Google Maps) is no longer ruled out by a kind filter; it comes back with
  `kind_not_saved` (the parked "places without a kind" fix, and likely why "pizza" offered Hinode
  and Lemongrass). (2) Calendar titles are used as written ("Alex swim BD" was read as a birthday):
  a line in the calendar note (`chat/agenda.ts`) and an evaluation case (110). 393 Deno tests.
  **Evaluation (owner's OK, $1 cap): run 37851214466 at 087ece0, Luna 108/110, 0 leaks, 0 unsafe,
  $0.05**; the "BD" case passes; misses: `place-not-since-summer` (as before) and
  `place-shared-point-not-stored` (untouched here; **re-run alone 5 times, run 37852431237: 5/5**).
  Merged and deployed with the owner's OK (see the newest entry). Privacy page (#179)
  merged; Play Console's Data safety change after the build (owner's choice).
- **Live (2026-10-08, owner's OK): `mcp` version 27 and `chat` version 20**, deployed by the "deploy
  chat" workflow (runs 37849787259 and 37849790683) from `main` at f725b96 (#176, #178, #177); both
  refuse requests without a sign-in. Live now: Wilma sets kind `home` for "my home is ..." (#177)
  and `update_item` takes the phone's date for a repeating task (#178). Not compared file by file
  this time (the workflow deploys from its own checkout of `main`).
- **Day planner step 2, step 6 (ship): PR open (2026-10-08).** Privacy page (planning your day,
  Mapbox, the Weather Service, tasks and Home), Data safety notes (no new data type), and
  `docs/versioncode15-phone-checklist.md`. **Owner:** approve the privacy wording and merge (it
  publishes the page); in Play Console add *Calendar → Calendar events* (left from versionCode 14);
  then say "build for Play" (versionCode 15).
- **Day planner step 2, step 5 (tasks in the app): merged (#178), not built (2026-10-08).**
  Tasks tile and list, the task form (new/edit), ＋ Add with Find a time in My day, and
  `update_item` `today` (the phone's date for repeating tasks; server, live after the `mcp` and
  `chat` deploys). Details: plan step 5 "As built". 654 app tests, 392 Deno tests. My day (#176)
  merged too. **Owner:** OK the `mcp` and `chat` deploys (together with #177's). **Next:** step 6,
  ship (privacy page, Data safety, phone checklist, build versionCode 15; Sonnet).
- **Wilma sets kind `home` (owner's phone test, 2026-10-08): merged (#177).** The owner asked Wilma to
  save a place "Home"; it was saved without kind `home`, so the planner said no Home. Claude set
  that note's kind to `home` with the owner's OK (one SQL update; the revision trigger kept the old
  version). Fix: one line in Wilma's place instructions (`mcp/lib/assistant.ts`: home is kind
  `home`, only one, give an existing one the kind instead of saving another) and 2 evaluation cases
  (109). **Evaluation (owner's OK, $1 cap): run 37847123220 at 4e8ac71, Luna 108/109, 0 leaks, 0
  unsafe, about $0.05**; both Home cases pass; the miss is `place-not-since-summer` again (passed
  5/5 alone in run 37808971148; untouched here). **Owner:** OK the `chat` and `mcp`
  deploys (with #178's server change).
- **Day planner step 2, step 4 (the app's My day): merged (#176), not built (2026-10-08).** The 🌅 My
  day tile on Home and the 🌅 Plan my day chip in an empty chat (PRO badge and the Pro card without
  Pro), the My day timeline from `{"mode":"day"}` (drive, rain, alert, overlap, free, task rows;
  credits), first-use "Where do you leave from?" (saves Home), the event detail (the sum, hourly
  rain, Not driving, Directions), "📍 Where is this?" / Not a trip, choices and place answers kept
  on the phone (encrypted per account), and **Open my day** from the chat's `day_plan` event. The
  chat's "plan my day" now re-sends events with the phone's places and the day's choices. **The plan
  is never saved on the phone** (Mapbox's terms). Details: plan step 4 "As built". 639 app tests (58 new).
  No server change, no migration, no evaluation run needed (the chat's prompt and tools are
  unchanged). It ships with step 6's build (versionCode 15). **Secrets checked
  (2026-10-08):** the owner's "plan my day" requests logged both providers (so `MAPBOX_TOKEN` and
  `NWS_CONTACT` are set) with 0 requests and 0 failures: no event had a place the server could
  find (the build on the phone sends no points; a location must equal a saved place's name). **Next:** step 5, tasks in the app
  (strongest model, fresh session).
- **Day planner step 2, PR 3 (Mapbox drive times, NWS weather, the planner in "plan my day"):
  merged (#174) and live: `chat` version 19 (2026-10-08, owner's OK).** Deployed by the "deploy
  chat" workflow (run 37834222424) from `main` at b714258: 57/57 deployed files identical to
  `main` (the dayplan `mapbox.ts`, `nws.ts`, `time.ts` among them); the workflow's own check
  passed (401 without sign-in and with a fake token). `mcp` unchanged (version 26; the listing
  showed `chat` 19 and `mcp` 26, newer than the v16/v24 noted below, so other deploys happened in
  between). Secrets not yet seen working: the first "plan my day" from a Pro account shows it
  (the `day` log line's `drive_failures` and `weather_failures` stay 0). Earlier state: Details: plan step 3 "As built" and "Mapbox:
  pricing and terms". Mapbox checked: 100,000 Directions requests a month free, then $2.00 per
  1,000; its terms do not allow keeping Directions results (nothing is kept; **step 4: the app must
  not save the plan on the phone**); no rule found that needs a Mapbox map for Directions results;
  queries must answer a person's request (**re-check before proactive alerts**). Mapbox's own pages
  are blocked from Claude's environment: the owner glances at them when making the account. 391
  Deno tests, 107 evaluation cases (3 new). Owner set `MAPBOX_TOKEN` and `NWS_CONTACT` (2026-10-08;
  Claude cannot list secrets, so they are checked after the deploy: drive times no longer
  "unavailable"). **Evaluation (owner's OK, $1 cap): run 37832337431 at b7de176, Luna 107/107, 0
  leaks, 0 unsafe, $0.05**; the 3 plan cases pass. **Owner:** (1) review and merge; (2) OK the
  `chat` deploy (then drive times and weather go live for Pro). Next: step 4, the
  app's My day (strongest model, fresh session).
- **Day planner step 2, PR 2: merged (#172) and live: `chat` version 16, `mcp` version 24;
  migration applied; owner and Play review accounts Pro (2026-10-08, owner's OK).** Migration
  `20261009120000_day_plan.sql` was run by the owner in the SQL editor (the dry run did not run
  first: two pastes failed at once, with chat text and a fragment, changing nothing). Checked by
  Claude after: column, checks, `day_plan_usage` (keys, RLS, own-rows policy), both functions'
  code identical to the file, limit 30, anon refused, users read but cannot update `plan` or write
  counts. Behaviour test 13 was not run on the live database (the connector times out on it);
  optional: `tests/sql/dry_runs/13_day_plan_check.sql` (rolled back). Pro set for
  hassan.wehbe@gmail.com and hassan.wehbe+playreview@gmail.com. Deployed by the "deploy chat"
  workflow from `main` at 5684b78 (runs 37818213859 and 37818217591): 54/54 and 38/38 listed files
  identical to `main`; 401 without sign-in and with a fake token. Nothing in the app calls the day
  route until step 4; drive times say "unavailable" until step 3. **Next: step 3, Mapbox and NWS**
  (strongest model, fresh session; owner first: a Mapbox account and token). Earlier state: Details: plan step 2 "As built". 372 Deno tests,
  SQL test 13, 104 evaluation cases; **evaluation run 37807486314: Luna 103/104, 0 leaks, $0.05**
  (the miss, "since the summer", passed 5/5 on its own, run 37808971148). **Owner:** (1) run the dry run of
  `20261009120000_day_plan.sql` with SQL test 13 in the Supabase SQL editor (the connector times
  out on it; Claude gives the script; every line must say ok), then apply the migration there;
  (2) ~~evaluation~~ (done); (3) set Pro for the owner's account and the Play review
  account (owner, 2026-10-08: both; Claude runs it once the migration is applied); (4) merge, then OK the `chat` and `mcp`
  deploys. Nothing in the app uses My day until step 4. **Access token (owner, 2026-10-08):**
  `SUPABASE_ACCESS_TOKEN` stays set in GitHub while the day planner is built (the owner is the
  repository's only collaborator; an expiry date if Supabase offers one); deleted in Supabase and
  GitHub when that work is done. Do not ask the owner to delete it after each deploy.
- **Day planner step 2, PR 1 (Wilma tasks, server): merged (#169); live: `mcp` version 23 and `chat`
  version 15 (2026-10-08, owner's OK).** `chat` deployed by the workflow (run 37803132438) from
  `main` at 79448d0: 52/52 listed files identical to `main`, 401 without sign-in and with a fake
  token; the app's Wilma chat now has tasks (no app build needed to save and ask about them).
  **Owner:** delete the Supabase access token used for these runs (Supabase → Account → Access
  Tokens) and remove `SUPABASE_ACCESS_TOKEN` from the GitHub repository secrets. **Next:** step 2
  (planner core and the Pro switch; strongest model, fresh session). Details of the `mcp` deploy: `mcp` deployed with the owner's OK by the "deploy chat" workflow (function
  `mcp`, run 37802605333) from `main` at 79448d0: 38/38 listed files identical to `main`
  (`deno.json`, `deno.lock`, `lib/supabase-ai.d.ts` not listed back, as usual); 401 without sign-in
  and with a fake token. So the Claude connector has tasks; **the app's Wilma chat (`chat` v14) does
  not until `chat` is deployed** (owner's OK; the repository's `SUPABASE_ACCESS_TOKEN` was still set
  for this run). **Owner:** OK the `chat` deploy, then delete the Supabase access token.
  Earlier state: Tasks are
  notes of type `task` (due date, duration, priority, place, done), `find_tasks`, `update_item`
  `task_done`, a Tasks space made on the first task; rule 9, 3 and 7 tests; 340 Deno tests, 103
  evaluation cases. **Evaluation run 37798727091: Luna 102/103, 0 leaks, 0 unsafe, $0.05**; the miss
  was the grader (find_tasks not listed as reading), fixed with a guard test (341); **task cases
  re-run 37800606256: 5/5, 0 leaks.** Same PR: the plan now makes day
  planning **Pro** (server-side `app_user.plan`, set by hand for testers until Play Billing),
  adds a **🌅 My day** tile and a **Plan my day** chat chip, and estimates the running cost
  (Mapbox free for about the first 100-150 Pro users, then roughly $1.50-3.00 per Pro user per
  month with AI; owner's request, 2026-10-08); mockups updated (section 0); Pro tester invite codes
  in `signup-plan.md` (Q9, owner: yes); iPhone drive times from Apple's MapKit later. **Owner:**
  review and merge, then OK the `mcp` and `chat` deploys (a fresh
  `SUPABASE_ACCESS_TOKEN` for the `chat` workflow, deleted after). **Next:** step 2 (planner core
  and the Pro switch; strongest model, fresh session).
- **Day planner step 2 planned (owner's feedback on versionCode 14, 2026-10-08).** The phone
  calendar works (Settings → Calendars, "plan my day" lists the events), but reading the calendar
  alone is not useful: the owner wants a plan. Mockups approved (`docs/day-planner-mockups.html`,
  also a private artifact): a play-by-play in the chat plus a **My day** timeline with leave-by
  times (Mapbox, traffic), rain and alerts (US National Weather Service), overlaps with fixes
  ("take both"), and **Wilma tasks** placed into the day. Plan:
  `docs/phase6-day-planner-step2-plan.md` (six small PRs, Q1-Q9). **Order (owner): before
  invite-only sign-up.** The rest of the versionCode 14 checklist (places sharing, calendar
  off/permission, "Still works") was not reported yet. **Play Console:** the owner chose to do
  *Calendar → Calendar events* at the end, with step 6's Data safety changes, before the build
  leaves internal testing. **Owner:** approve the plan; before step 3, a Mapbox account and token
  (Supabase secret `MAPBOX_TOKEN`). Parked as before: the server fix for places without a kind.
- **versionCode 14 building (owner: "build for Play", 2026-10-08).** Production build from
  `main` at cc3a181 (GitHub run 37721583530, checks passed: lint, typecheck, 581 app tests), Expo
  build abae235a-019e-4eff-9f6f-519f2d89354b, auto-submit to Play internal testing scheduled
  (submission f83d0953-f810-41a4-8600-ce9d1baee771). Carries the place lookup fix (#160) and the
  calendar app side (#164, #165); server already live (`chat` v14, `mcp` v22). **Owner:** Data
  safety *Calendar → Calendar events* in Play Console (steps in `phase4-play-release.md`), then
  run `docs/versioncode14-phone-checklist.md` and report back (a fresh session: Sonnet to sort the
  feedback; the strongest model for fixes to the calendar, location or the chat loop). **Next
  after feedback:** invite-only sign-up (`docs/signup-plan.md`); parked: the small server fix for
  places without a kind and the forgiving filters ("pizza" got Hinode and Lemongrass).
- **versionCode 14 ready to build once step 3 is merged (2026-10-08).** On `main`: the place
  lookup fix (#160) and the calendar app side (#164 Settings → Calendars, #165 Wilma reads it
  when she asks; 581 app tests). Step 3 PR: privacy page (calendar paragraph, OpenAI line, 🔎
  sentence; owner approved), Data safety answer (*Calendar → Calendar events*), and
  `docs/versioncode14-phone-checklist.md`. **Owner:** merge step 3; update Data safety in Play
  Console (steps in `phase4-play-release.md`); then say "build for Play". Android asks for read
  and write calendar access together (the package needs both); the app never writes.
- **Day planner step 1, server: merged (#161) and live: `chat` version 14, `mcp` version 22
  (2026-10-08, owner's OK).** Both deployed from `main` by the "deploy chat" workflow (#162
  added the function choice for `mcp`): `chat` run 37718710319 at d7d327c (50/50 listed files
  identical to `main`), `mcp` run 37719590550 at e740918 (36/36 identical, the new
  `get_day_agenda` among them); 401 without sign-in and with a fake token for both. Today's app
  does not send `can: ["calendar"]`, so nothing changes for it until step 2. **Owner:** delete
  the Supabase access token used for these runs. **Next:** step 2, the app side (strongest
  model; a native package, so a new build).
- **Day planner step 1, server (earlier state, 2026-10-08).** Owner's choice: "ask, then
  re-send" instead of pausing `chat` (it keeps nothing between requests). Wilma's get_day_agenda
  makes `chat` send the app an `agenda_request` and end the answer; the app (step 2, not built)
  reads the ticked calendars and sends the question again with the trimmed events, which `chat`
  checks and hands to the model as calendar data. Also the phone's time zone for "today". 330
  Deno tests; 98 evaluation cases. **Evaluation (owner's OK, $1 cap): run 37712976912 at e6bb6ef,
  Luna 97/98, 0 leaks, 0 unsafe, $0.04**; the miss: "save the details of today's key pickup" got a
  question instead of a calendar read (nothing saved). Fix f0da46d (one phrase in the
  instructions: requests about something on the calendar read it too); **calendar cases re-run,
  run 37714915747: 5/5, 0 leaks, under $0.01.** **Owner:** review and merge; then the `chat` deploy
  (workflow, fresh access token) and the `mcp` deploy, each only with your OK. Details: `phase6-day-planner-step1-plan.md` "How it works" and step 1.
- **versionCode 13 feedback (2026-10-08): wrong spots for places shared by name only. Merged
  (#160), not built.** Two new places got a wrong location from "Is this it?": Craft & Common
  (Oviedo FL) in downtown Orlando, so Wilma said "none within 10 miles, the nearest is 15.2 miles"
  (her maths was right for that spot), and a pizza place in Oviedo, Spain. Google Maps shared no
  address, the card showed only the name, and the note's Open in Maps opened Google's (right)
  link. Fix (`places-plan.md` step 8, "Fix (owner, versionCode 13)"): the card says
  "📍 Found at: <street>, <town>", warns when only the name was looked up, and Open in Maps opens
  the saved location first. Privacy wording approved by the owner. **Owner:** for
  Craft & Common and the pizza place, Edit note → Remove the location (or Use where I am now
  there). **Parked (server, small):** a place saved without a kind is left out by a kind filter,
  and the forgiving filters offered Hinode and Lemongrass for "pizza".
- **versionCode 13 building (owner: "build for Play when job 4 is merged", 2026-10-08).** Production
  build from `main` at c0675e8 (GitHub run 37705215361, checks passed), Expo build
  08981365-f3b9-43d2-8050-182b8476be28, auto-submit scheduled (submission
  682b25a7-f5bb-4531-aeee-024b2b7b7b4d). Carries the password-crash fix (#152), 🔒 vault rows in
  spaces (job 3, #155) and "Is this it?" for places shared from Google Maps (job 4, #158; geocoder
  tested by the owner in Expo Go: all four lookups right). Server: `mcp` v21, `chat` v13 (job 5).
  Privacy page: the approved job 4 wording is live; the 🔎 Find it on the map tap is not named in the
  Location paragraph (owner did not choose; offered as a follow-up). **Next: the owner tries it on
  the phone** (share Hinode Sushi from Google Maps → "Is this it?" → Open in Maps → Yes → Save; a
  space with vault entries shows 🔒 rows; typing "password" in Wilma no longer crashes; "restaurants
  close by" names both places), plus the open lines of `docs/versioncode12-phone-checklist.md`. Then
  the calendar (day planner step 1), then invite-only sign-up.
- **Job 4 (locations for shared places): PR open, app only, not built.** The owner's Expo Go test
  passed (both restaurants, "Hinode Sushi" alone and a Starbucks found by `geocodeAsync`), so the
  OpenStreetMap lookup stays dropped. A place shared from Google Maps is looked up by "name,
  address" with the phone's geocoder; the share screen shows "Is this it?" with Open in Maps and
  Yes / No; only Yes saves the point. Never the phone's own position. Android only answers once
  Wilma has the location permission: automatic when it is already given, else a "🔎 Find it on
  the map" tap asks for it. Privacy page: the owner's approved wording, verbatim. Play Data
  safety: no change. New `lib/placeLookup.ts` (+ tests), `components/PlaceLookup.tsx`,
  `deviceGeocoder` in `lib/location.ts`; 541 app tests. Details: `places-plan.md` step 8, "As
  built (job 4)". **Owner:** review and merge; it ships with versionCode 13 (no build until the
  owner says "build for Play"). Phone check for that build: share Hinode Sushi from Google Maps,
  see "Is this it?", Open in Maps, Yes, Save, then the note shows the location.
- **Job 3 (🔒 vault entries in a space): merged (#155), not built, app only.** A space screen now lists its vault
  entries (that space and its sub-spaces; restricted spaces never, as `find_secret` already does)
  under its notes as 🔒 rows: name and website only. A tap opens the same entry screen as the
  Vault list (`/vault/[id]`), which shows the unlock card only when locked. "Nothing in this space
  yet" only when there are no notes and no entries. Home is unchanged (Logins stays listed). New
  `app/src/lib/secretRows.ts` (+ 14 tests; 532 app tests). No server, schema or privacy change.
  Ships with the next Play build (versionCode 13). **Next:** job 4's small geocoder test build,
  when the owner says so.
- **Job 5 ("restaurants close by" said none): merged (#154) and live: `mcp` version 21, `chat`
  version 13 (server only, `mcp` 0.9.2).** Checked (read
  only): both real restaurants are `kind` restaurant, `status` been, cuisines japanese / thai, with
  numeric `lat`/`lng`, so a plain `kind: "restaurant"` call would have found them; the first call
  most likely sent `"restaurants"` (refused until now as "Filter not understood"), `status: "want"`,
  a cuisine like "sushi", or a small `within`. Fix, details in `places-plan.md` step 5 "Fix
  (2026-10-07)": `summary` sentence, forgiving filters (`other_nearby` with `not_matching`, plural
  kinds), one `find_places` log line (filter names and counts only), prompt ("close by" = near,
  only the filters the user said), 5 new Deno tests (309 in all), 2 new evaluation cases (93; dry run on Luna: at most about $0.33).
  **Evaluation (owner's OK, $1 cap), run 37683006853 on the PR branch at 290dbf4: Luna 93/93,
  0 leaks, 0 unsafe, $0.04**; both new cases and all 22 secret traps pass. (A first run started on
  `main` before the merge was cancelled after a few seconds: it would have tested the old code.)
  **Deployed (owner's OK, from the PR branch at 0e9b66f, 2026-10-07): `mcp` version 21 live**
  (36/37 files identical to the repo, `lib/supabase-ai.d.ts` not listed back as usual; 401
  without sign-in and with a fake token). **`chat` NOT deployed, still version 12** (old
  `find_places`, old `credentials.ts`; 401 checked): the connector's `deploy_edge_function` call
  was cut off at about 68 KB of the 214 KB payload and changed nothing. So the Claude connector
  has the fix, **the app's Wilma chat does not yet.** **Deploy route for `chat` (owner's choice,
  option A):** the manual GitHub workflow `deploy chat` (`.github/workflows/deploy-chat.yml`, runs
  `supabase functions deploy chat` from `main` only, then checks 401 without sign-in and with a
  fake token). It needs the repository secret `SUPABASE_ACCESS_TOKEN`; a Supabase access token
  cannot be limited to one project and must be able to write, so **the owner deletes it in
  Supabase right after each deploy** and makes a new one next time. After a run, check with
  `get_edge_function` that every file matches `main`.
  **`chat` deployed (owner's OK, 2026-10-07): version 13 live** from `main` at 513338b by the
  workflow (#156, run 37700449212); 48/48 listed files identical to `main` (`chat/deno.json` and
  `mcp/lib/supabase-ai.d.ts` not listed back); 401 without sign-in and with a fake token. The app's
  Wilma chat now has the fix, and #152's server `credentials.ts`. **Owner:** delete the Supabase
  access token used for this run; try "restaurants close by" on the phone. No Play build until the
  owner says so.
- **START HERE (2026-10-07, late): versionCode 12 findings and the next three jobs.** The owner
  ran part of the versionCode 12 checklist (stub deleted, update installed, both restaurants now
  have a location, start-up fine) and found:
  1. **Crash on "password"** (stop-ship): fixed and merged (#152, entry below). **No build yet**
     (owner): versionCode 13 waits for "build for Play". Until then, typing a label word (password,
     PIN, token, secret, code) in Wilma crashes versionCode 12; skip the checklist's password card
     and door/gate-code lines.
  2. **"Logins" shown with the other spaces:** not a bug. It is a normal space (not restricted)
     holding 0 notes and 2 vault entries; restricted means notes hidden from search, Wilma and the
     app until unlocked.
  3. **Vault entries in a space (owner: go, as recommended):** a space screen lists its vault
     entries under its notes as 🔒 rows (name and website only, never values); a tap opens that
     entry in the Vault (unlock only if locked). Password-only spaces like Logins stay on the home
     list. App only, no server or privacy change. Strongest model (vault).
  4. **Locations for shared places (owner: go, as recommended):** no scraping of Google pages (their
     terms forbid it, servers are blocked, and an earlier page read gave a point ~800 miles off).
     Instead the phone's own geocoder (`expo-location` `geocodeAsync`, Android's built-in lookup):
     from a Google Maps share, look up "name + address" on the phone, show "Is this it? <name>,
     <address>" with Open in Maps, save only on Yes. Free, no key, no server. Sends the place's
     name and address to Google through the phone: one privacy sentence for the owner to approve.
     **First a small test build:** does it find restaurants by name (Hinode Sushi, Lemongrass Thai
     Kitchen, Oviedo FL), or only street addresses? Replaces the on-hold OpenStreetMap lookup.
  5. **"Restaurants close by" said none, although both are under 10 miles away** (owner confirmed).
     Logs (tool names only): `ask_for_location` → shared → `find_places` once → "can't find any";
     after "look in my notes": `search_items`, `find_places` again, `show_places` with the right
     card. Both places have numeric `lat`/`lng` in Restaurants (checked). So the first call's
     arguments were wrong: likely a filter that matched nothing (e.g. cuisine "sushi" vs stored
     "japanese", or a `kind`/`space`/`status`), or a wrong point or `within`. Not a missing notes
     search: `find_places` already reads every place note. **Plan (server, strongest model,
     evaluation run and deploy with the owner's OK):** (a) `find_places` returns a plain `summary`
     sentence ("No saved place within 10 miles; the nearest is X, about N miles away"); (b)
     forgiving filters: when a filter removes every nearby place, also return the nearby ones as
     "nearby, not tagged <filter>"; (c) log which filters were set and the result counts, never
     names or points; (d) evaluation cases for a filter mismatch and for "close by". Also deploy
     #152's server copy of `credentials.ts` with it.
  **Order:** (5) and (3) next, then (4)'s test build, then versionCode 13 with all of it and the
  rest of the checklist; then the calendar (day planner step 1), then invite-only sign-up.
- **versionCode 12 stop-ship: the app crashes when a message contains a label word** ("password",
  "PIN", "token", "secret", "code"…), found by the owner typing "supabase pass…" in the chat. Cause:
  on the phone's JavaScript engine (Hermes), `matchAll` results have no named `groups`, so the
  password check (`findLabelled` in `credentials.ts`, new on the phone in UI PR 4) threw. Node and
  Deno return the groups, so no test caught it. Reproduced and verified with the Hermes 0.13 CLI
  (GitHub release). Fix: an `exec` loop on a fresh copy of the pattern, same change in the server
  and app copies, plus a Jest test that strips `groups` from `matchAll` (it fails on the old code).
  Needs a new build (versionCode 13); the server copy behaves the same under Deno, so its deploy
  can wait for the next server change. **Lesson: run new phone-side regex code on Hermes**
  (download `hermes-cli-linux.tar.gz` from github.com/facebook/hermes releases; `hermesc` in
  `node_modules` only compiles).
- **versionCode 12 building (owner: "build for Play", 2026-10-07).** Production build from `main`
  at 4d9e55e (GitHub run 37660106229, checks passed), Expo build
  3e11a3c6-35d5-47fd-950e-1d207625ab55, auto-submit scheduled (submission
  c892d53c-2c19-4ead-82f4-1d0f7e9c066f). Carries the UI tidy-up and places part 2 (PRs 1-4).
  **Next: the owner runs `docs/versioncode12-phone-checklist.md` and reports back.**
  **Order after that (owner, 2026-10-07):** fixes from the checklist, then **day planner step 1,
  the phone's calendar** (`docs/phase6-day-planner-step1-plan.md`, Q2-Q8 as recommended unless the
  owner changes them; strongest model for its steps 1-2), then **invite-only sign-up**
  (`docs/signup-plan.md`). The calendar needs no company account; testers' accounts stay manual
  until sign-up ships.
- **Next build's checklist ready (part 2 PR 8): `docs/versioncode12-phone-checklist.md`.** One
  "super checklist" for versionCode 12: the UI tidy-up, places part 2 (Miles/km, place cards, 📍
  Share where I am), the key lines of the unrecorded versionCode 10/11 lists, and the owner's
  parked to-dos (delete the `place-locations` stub, give the two places a location). **Next: the
  owner says "build for Play"** (production build from `main`, auto-submitted to internal testing;
  see the versionCode 11 entry for how it was run), then runs the list and reports back.
- **Places part 2: lookup skipped for now (owner, 2026-10-07).** OpenStreetMap does not know the
  owner's two places, so PRs 5-7 (privacy wording, server lookup, Find on the map) are on hold;
  draft #148 closed unmerged (approved wording kept on its branch). PRs 1-4 are merged (server
  live as `mcp` v20 / `chat` v12; the app parts wait for the build). **Next: part 2 PR 8**, the
  phone checklist for the next Play build (UI tidy-up and places part 2), Sonnet, then the build;
  the owner's parked to-dos join that "super checklist".
- **Places part 2 PR 4 (app: place cards and the 📍 Share where I am card in the chat): PR open.**
  App only (the server sends the events since `chat` v12). Details: `places-plan.md` step 8, "As
  built (PR 4)". 517 app tests. Ships with the next Play build. PR 3 (#146, Settings → Distances)
  is merged. **Next: part 2 PR 5** (docs and privacy for Q17, the OpenStreetMap lookup; the owner
  approves the privacy sentence), then PR 6 (server lookup; needs the OpenStreetMap coverage check,
  parked with the owner's to-dos).
- **Places part 2 PR 3 (app: Settings → Distances, Miles / Kilometres): PR open.** `app/src/lib/units.ts`
  (+ tests), Settings section, `GroupRow` `checked`. App only, no server change; ships with the
  next Play build. 501 app tests. **Next: part 2 PR 4** (app: the place cards and the Share where I
  am card on the ChatCard shell; it reads the phone's location on a tap), fresh session, strongest
  model (the plan's choice for every part 2 PR except the checklist).
- **Places part 2 PRs 1 and 2 merged (#142, #144) and live (deployed 2026-10-07): `mcp` version
  20 (36/37 files identical to `main` at 2bac3ad), `chat` version 12 (49/50 identical); in both,
  `supabase-ai.d.ts` is not listed back as usual; 401 without sign-in and with a fake token, both
  functions.** Evaluation before the deploy: run 37649342980, Luna 90/91, 0 leaks, 0 unsafe, $0.04
  (the miss was the grader, fixed in #144). Live now: miles by default, "nearby" = 10 miles, honest
  near answers, and the chat's `places` / `location_request` events (today's app ignores them; Wilma
  still names the places). **Deploy note:** the connector's `deploy_edge_function` takes every file's
  text in one call; the first `mcp` attempt was cut off at about 75 KB and changed nothing, the
  retry went through. Prepare the file list as JSON lines from `scripts/function-files.sh` and
  verify with `get_edge_function` (its output is saved to a file) plus a short python comparison.
  **Next: places part 2 PR 3** (app: Distances Miles / km on Settings), fresh session, Sonnet is
  enough. The owner's to-dos stay parked for the "super checklist" after the next Play build.
- **Places part 2 PR 2 (chat-only `show_places` / `ask_for_location`): merged (#144), live (entry above).**
  New `supabase/functions/chat/actions.ts`, shared by the chat function and the evaluation;
  the Claude connector never sees them. Events `{"type":"places","cards":[...]}` and
  `{"type":"location_request"}`; today's app (versionCode 11 and the merged UI PRs) drops unknown
  event types (`app/src/lib/chatStream.ts`), and Wilma still names the places in her text, so
  nothing changes on the phone until the app's cards (part 2 PR 4). Details: `places-plan.md`
  step 8, "As built (PR 2)". 304 Deno tests; eval dry run 91 cases on Luna, at most about $0.33.
  **Evaluation (owner's OK, $1 cap), run 37649342980 on the PR branch at e77e6f2: Luna 90/91,
  0 leaks, 0 unsafe, $0.04**; all 5 new card cases and all 22 secret traps pass. The one miss,
  `save-home-fact`, was the grader: Wilma saved the filter in Home as "16×25×1" (a multiplication
  sign), which the check now accepts too.
  **Owner's next steps:** merge; OK and spending cap for **one** paid evaluation run covering
  PRs 1 and 2 (GitHub Actions → model evaluation, models `luna`, cases `all`); OK to deploy `mcp`
  (37 files) and `chat` (50 files) (recipe below and in `phase5-a5b-chat-function-plan.md`:
  every file from `scripts/function-files.sh`, each checked identical with `get_edge_function`,
  401 without sign-in). Then part 2 PR 3 (Settings: miles / km).
  **Owner's instruction (2026-10-07): do not chase the owner's open to-dos for now** (deleting the
  `place-locations` stub, giving the two saved places a location, the versionCode 10 and 11 phone
  checklists, the OpenStreetMap coverage check before PR 6). They will be handled together in one
  "super checklist" and validation after the next Play build.
- **Places part 2 PR 1 merged (#142); migration `distance_unit` applied 2026-10-07** (column
  `app_user.distance_unit`, default `mi`; grants: `authenticated` select/update on that column
  only, no anon). Server code (`mcp` 0.9.0) **not deployed yet**: one evaluation run and one deploy
  of `mcp` + `chat` after **PR 2** (chat-only `show_places` / `ask_for_location`), as planned. The
  live server ignores the new column until then. **Next: places part 2 PR 2**, fresh session,
  strongest model.
- **UI tidy-up PRs 1-6 merged, not built (2026-10-07):** PR 5 chat with the Wilma box (#139),
  PR 6 one ChatCard shell (#140). Left: PR 8 (phone checklist, then the build). **Owner's choice:
  one Play build after places step 8 part 2.** **Places step 8 part 2: plan agreed (as
  recommended), written in `docs/places-plan.md` step 8 ("Part 2 build plan")**, 8 PRs; Q17
  recorded (#134 merged). **Next: places part 2 PR 1** (server + migration: miles/km, 10-mile
  nearby, honest answers), in a fresh session, strongest model. Open: the OpenStreetMap coverage
  check before PR 6 (the sandbox cannot reach Nominatim; see the plan).
- **UI PR 4 and PR 7 done (2026-10-07, afternoon).** PR 4 (#136, app, merged, not built): the
  phone holds a message that looks like a password (amber box, "Wilma won't send it" card with
  Edit message / Save in Vault, Send held; `app/src/lib/credentials.ts` is the server's check,
  kept identical by a test). PR 7 (#137, server, **live: `chat` version 11**, deployed
  2026-10-07, 48/48 listed files identical to `main` at b94e2f6, `mcp/lib/supabase-ai.d.ts` not
  listed back as usual; 401 without sign-in and with a fake token): a new message that looks
  like a credential gets a fixed answer with no model call and nothing counted; earlier ones
  (and Wilma's reply after them) are replaced before the model sees the history. No evaluation
  run (owner: skip; the harness does not include this step, so results would not change). Not
  covered: the Claude connector (the Claude app talks to Anthropic itself; rule 9 in `save_item`
  stays its guard). Places Q17 decided (#134): a shared place's location comes from an
  OpenStreetMap name lookup the user confirms (built with places step 8 part 2). **Next: UI
  PR 5** (chat with the Wilma box), then PR 6, places step 8 part 2, PR 8 and the Play build
  (owner may ask for an earlier build after PR 6; ask then).
- **START HERE: consolidated state (2026-10-07, end of day).** Two lines of work ran in parallel
  today and are now merged into this one note. Nothing is open on GitHub.
  - **UI tidy-up (`docs/ui-review.md` section 3):** PR 1 shared pieces (#123), PR 2 Settings
    behind ⚙ (#127) and PR 3 home A2 with the Wilma box, ＋ menu, counter, tiles and the chat
    sliding up (#128) are **merged, not built**. Next: **PR 4, the password check on the phone**
    (strongest model), then PR 5 (chat with the Wilma box), PR 6 (one chat card shell), PR 7 (the
    same password check in the `chat` function, with an evaluation run; owner's OK to deploy),
    PR 8 (phone checklist, then the Play build).
  - **Places step 8 part 1 is closed** (entry below): the server opens no Google links and reads
    coordinates only from a long Maps link or a `geo:` link; `mcp` v19 and `chat` v10 live.
    **Part 2 is next** (`docs/places-plan.md` step 8, Q11-Q16): Wilma names matching places that
    have no location instead of saying nothing is near and offers to add one, "nearby" = 10
    miles, miles by default with a miles/km setting (it goes on the new Settings screen), place
    cards and the "📍 Share where I am" card (they use PR 6's card shell).
  - **Order (recommended):** UI PR 4 → PR 7 (both close the gap where a typed password reaches the
    model) → PR 5 → PR 6 → places step 8 part 2 → UI PR 8 and one Play build carrying both.
  - **Owner to do:** delete the `place-locations` stub (Supabase → Edge Functions →
    place-locations → Delete; it was still listed at the end of the places session), give the two
    saved places a location (Use where I am now at the place, or paste a long Google Maps link
    from a computer's browser). The versionCode 10 and 11 phone checklists are not yet recorded.
- **Places step 8, part 1: coordinates from Google Maps links (Q15), server live (#124 merged;
  deployed 2026-10-07: `mcp` version 16, 36/37 files identical, `chat` version 9, 48/49 identical,
  the `.d.ts` not listed back; 401 without sign-in and with a fake token, both).** Why: on versionCode 11 "sushi near me" found nothing because the owner's 2 places
  (both shared from Google Maps: short link and name only) have no location. **#124**: when a
  place is saved or edited with a Maps link and no location, `mcp/lib/maps_link.ts` reads the
  coordinates from a long link (no request) or opens a short link (`maps.app.goo.gl`,
  `goo.gl/maps`) once: https only, at most 5 manual redirects, every hop on `maps.app.goo.gl`,
  `goo.gl/maps`, `maps.google.com` or `(www.)google.com/maps` (others refused unrequested; Google's
  EU consent page is read for its `continue=` link, never requested), 5 s in all, no cookies, body
  never read (changed by the owner's choice (a), below), nothing logged. Never replaces a location; does not put back one the user removed
  (same link); any failure leaves the place as it was and the save succeeds. No instruction
  change, so no evaluation run. `mcp` 0.8.2; `chat` carries the tools, so deploy both. **Not
  checked against Google yet** (this sandbox gets 403 for Google): the first real check is after
  the deploy. **#125** (stacked on #124): one-off admin function `place-locations` for places
  already saved (today 2, one owner, both short links): dry run by default (counts only, no
  request), `{"apply": true}` fills; service-role key only, run by the owner from the Supabase
  dashboard (Edge Functions → place-locations → Test, role service role), then deleted. **#126**:
  privacy page wording (owner approves; merging publishes; also removes "Wilma's servers do not
  contact Google about your places"). Wording approved by the owner (2026-10-07). **Owner's next steps:**
  the backfill (deploy `place-locations`, dry run, apply,
  delete), then merge #126. Part 2 (honest near answers, 10-mile radius, miles, cards) is next.
  **Update (2026-10-07):** `place-locations` deployed (version 1, 5/5 identical, 401 without the
  key, dashboard run not yet done). The owner's app edit showed the real chain fails: #129 (codes-
  only log line, `mcp` v17) logged `no_coordinates`, 2 requests, status 200: Google's share link
  leads to a place page whose address has no coordinates. **Owner chose (a):** the server reads
  that one HTML page (Google Maps host only, at most 1 MB, same 5 s) for the coordinates only
  (`places-plan.md` step 8 has the patterns). In a PR (`mcp` 0.8.4); after it is deployed, the
  owner changes one place field in the app and the log line says which pattern matched
  (`found`); then check the location with Open in Maps, run the backfill for the other place (or
  edit it), delete `place-locations`, merge #126.
  **Outcome (2026-10-07): (a) gave a wrong location, so withdrawn; owner chose (b).** `mcp` v18
  read the page (`found: page_image`) and stored a point about 800 miles from Hinode Sushi
  (Oviedo, FL): Google's page for a server has no pin, only a preview image centred elsewhere.
  Cleared by SQL with the owner's OK (history kept, change note "Removed a wrong location...").
  The server now opens no link at all: only coordinates written in a long Maps link or `geo:`
  link are read (`mcp` 0.8.5, `maps_link.ts` cut down; `place-locations` code removed). #126
  (privacy) closed unpublished: the page's "Wilma's servers do not contact Google about your
  places" stays true. Both places still have no location: the owner adds it with **Use where I
  am now** at the place, or pastes a long Google Maps link from a computer's browser. **Deployed
  2026-10-07:** `mcp` version 19 (36/37 identical), `chat` version 10 (48/49 identical; v9 still
  had the #124 link-following code), the `.d.ts` not listed back, 401 without sign-in and with a
  fake token, both. `place-locations` replaced by a stub (version 2, does nothing, 401 without
  sign-in). **Owner to do:** delete `place-locations` in the dashboard (Edge Functions →
  place-locations → Delete; the connector cannot delete functions), and give the two places a
  location (Use where I am now, or paste a long Google Maps link). Next: part 2.
- **UI tidy-up of home and chat: decided, build next (owner, 2026-10-07).** `docs/ui-review.md`
  section 3 is the plan: Home A2 (a 3-line Wilma box with ＋, usage counter, 🎤 and ↑ in a top
  panel; tiles Continue/Chat, Save here, Vault; Settings behind ⚙), the chat sliding up from the
  bottom with the same box, one chat card shell, and a password check on the phone (PR 4) and in
  the `chat` function (PR 7, server; found 2026-10-07: today a typed password in the chat reaches
  the model, only saving is blocked). Mockups: https://claude.ai/artifact/PgrfNQnowFu3w5M4mHYQQA.
  PRs 1-3 merged (#123, #127, #128), not built. **Next: PR 4 (password check on the phone),
  strongest model.** Order with places step 8 part 2: see "START HERE" above.
- **versionCode 11 building (owner: "build for Play", 2026-10-07).** Production build from `main`
  at 87f5ec4 (GitHub run 37556372279, checks passed), Expo build dbf2331f-0def-462d-8672-a78c8cd6cfd8,
  auto-submit scheduled (https://expo.dev/accounts/zafnut/projects/wilma/submissions/242901fc-5ec6-4e85-b20d-f79ae3289171).
  Carries: 📍 "near me" in the chat (#110; server live since `chat` v7), Edit space and moving a
  note (#115; server live since `mcp` v15), the usage meter (#118, D28 part 1). Privacy sentence
  (#111) is live. **Next: the owner updates from Play and runs `docs/places-step7-phone-checklist.md`**
  (📍, spaces, usage meter). Then places step 8 (`docs/places-plan.md`), then invite-only sign-up
  (`docs/signup-plan.md`, Q1-Q8 decided). The versionCode 10 checklist results are not yet recorded.
- **Places step 7 ("near me" in the chat, Q9), server live; app, privacy and checklist in PRs.**
  #108 merged (`chat` accepts `here: {lat, lng}` with one message; it becomes one line in that
  request's instructions only, never stored, logged or sent to the classifier; Wilma's
  instructions, `mcp` 0.7.1). Evaluation (owner's OK) run 37541617963, Luna, **76/76, 0 leaks,
  0 unsafe**, $0.03. **Deployed 2026-10-07:** `mcp` version 14 (34/35 files identical, the `.d.ts`
  not listed back; 401 without sign-in and with a fake token), `chat` version 7 (46/47 identical,
  401 both ways). Today's app never sends `here`, so nothing changes on versionCode 10.
  **Open PRs:** #109 (grader: `attach-photo-new-item` accepts save then attach by id), #110 (app:
  📍 in the chat only, Q10; merge now that the server is live; ships with the next build), #111
  (privacy sentence, owner-approved; merging publishes the page, so merge just before the next
  build), #112 (`docs/places-step7-phone-checklist.md` for the next build).
- **Edit a space and move a note (owner's requests, 2026-10-07), server live, app in a PR.**
  Owner's answers: name and description only (restricted on/off and moving a space later), also
  from the chat, old names in notes stay. #114 merged: new tool `update_space` (never restricted or
  the parent; refuses "/", a sibling's name, nothing to change); rule 9 now also checks space names
  and descriptions (`update_space` and `create_space`); no migration (`space_owner` allows updates).
  Moving a note already worked on the server (`update_item` `space`). Evaluation (owner's OK): run
  37552138432 80/81, 0 leaks; the miss, `secret-pin-for-someone-else`, then failed 1 of 3 on its
  own (run 37552981318: Wilma refused the PIN safely but said "save it securely, tell me which
  space" without naming the vault). Fix in the same PR: one sentence in Wilma's instructions (name
  the vault, never ask for a space as if it were a note), `mcp` 0.8.1; then 5/5 (run 37553724635)
  and all 22 secret cases 22/22, 0 leaks (run 37553726697). **Deployed 2026-10-07:** `mcp` version
  15 (35/36 identical, the `.d.ts` not listed back; 401 both ways), `chat` version 8 (47/48, 401 both
  ways). **#115 (app), open:** Edit space (header button on a space), and a Space choice in Edit note
  (no restricted spaces: the app cannot open them); ships with the next build.
- **Places step 8 planned (owner, 2026-10-07): place cards and asking for the location.** See
  `docs/places-plan.md` step 8 (Q11-Q14). Not started; strongest model, fresh session.

**Earlier (2026-10-06):**
- **Places step 6, the places build, started (owner: "build for Play", 2026-10-06).** Production
  build from `main` at 537fff2 (GitHub run 37540216475), **versionCode 10**, Expo build
  https://expo.dev/accounts/zafnut/projects/wilma/builds/28df2ba0-5a62-465d-b0d4-b83077ed29d1 ,
  auto-submitted to internal testing (submission ad25f9fe): places steps 3, 4, 5a, the Expo patch updates #98 and the mic fix #91.
  **Next: the owner runs `docs/places-phone-checklist.md`** on the phone (it also re-checks the
  mic: "The first tap" and "Dictating" from the A5e checklist).
- **"Near me" in the chat, decided (owner, 2026-10-06, Q9 as recommended):** later, as places
  step 7 after the step 6 build: a 📍 tap in the chat reads the location once and sends it with
  that one message, never stored. Not built. Until then Wilma asks which saved place you are
  near. Details: `docs/places-plan.md` step 7.
- **Places step 5b (server), merged and live (#104, 2026-10-06).** **Deployed:** `mcp` version 13
  (server 0.7.0; 34/35 files identical, the `.d.ts` not listed back; 401 without sign-in and with a
  fake token), `chat` version 6 (46/47 identical, 401 both ways). New read-only tool
  `find_places` (`mcp/tools/find_places.ts`): saved places sorted by straight-line distance
  (haversine, `distanceKm` in `mcp/lib/places.ts`) from `lat`/`lng` the user gave or from a saved
  place (`near_place`); filters space, kind, status, cuisine, occasion, `within_km`. A separate
  tool, not a `search_items` parameter: search ranks by words and stops at 50, so it would miss
  places. Reads only the user's places in `searchable_space_ids()` (restricted spaces never, not
  even as the starting point), checked again in code. Places without a location: counted, or listed
  by address with `include_without_location`, never a distance. **No migration.** Wilma's
  instructions (`mcp/lib/assistant.ts`, shared by chat and the Claude connector): use it for "near"
  questions, say "about N km" (never a travel time), never guess coordinates; for "near me" ask which
  saved place, since the chat does not know the phone's location (decided later as
  places step 7, Q9). 5 evaluation cases (72 in all, 20 traps, incl. a
  Wi-Fi password trap and a restricted bar next door); `mcp` 0.7.0. 267 Deno tests, app 370 (the app
  only learns that `find_places` is read-only; ships with step 6). **Evaluation** (owner's OK):
  run 37533843751, Luna, **71/72, 0 leaks, 0 unsafe**, $0.02; all 5 new cases and all 20 traps
  pass. The one miss, `attach-photo-new-item` (not about places, passed in the last run): Wilma
  saved the new item with save_item and attached to it by id, which the check does not accept.
  The app's one-line change ships with the step 6 build.
- **Play Console forms (owner, 2026-10-06), saved, not yet sent for review.** Publishing overview
  lists, waiting: store listing, target audience (18 and over), privacy policy URL, ads
  declaration, **Data safety** (with *Audio → Voice or sound recordings* and the new *Location →
  Precise location*; see `docs/phase4-play-release.md`) and App access (a separate **reviewer
  account**, created by the owner in Supabase with a `+playreview` email alias; its password is
  only in Supabase and Play Console). The page still says "complete the required steps in the app
  dashboard": **next, the owner finds the unfinished Dashboard tasks** (likely content rating, the
  other App content rows, store settings, screenshots), then **Send changes for review**. How to
  reach the forms: Play Console search box ("Data safety"), or Dashboard → "Set up your app", or
  App content (Actioned tab, **Manage**). Internal testing keeps working meanwhile.
- **Places step 5c (privacy), merged and live (#102).** The privacy page says the location is read
  only on the Save where I am / Use where I am now tap, once, stored in that place note only,
  never in the background; Google Maps is used only when Open in Maps is tapped (GitHub Pages
  deploy of d5b337e succeeded). Data safety answer added to `docs/phase4-play-release.md`.
- **Places step 5a (app), merged, not built (#101).** Home screen **📍 Save where I am** opens New
  note as a Place and reads the location once; the place form has **Use where I am now** and
  **Remove the location**; Open in Maps uses the coordinates when there is no saved link.
  Permission asked only on the tap and only when not already given (the #91 lesson); 20 s limit;
  plain sentences when refused or location is off. `expo-location ~57.0.20` (version from the
  installed SDK's `bundledNativeModules.json`; docs.expo.dev is blocked in this sandbox), loaded
  only by `app/src/lib/location.ts` on use. `app.json`: foreground only; background location, the
  location foreground service and activity recognition blocked (introspected manifest: only
  FINE and COARSE location). 370 tests. **Phone checklist (step 6):** first tap asks, second tap
  does not; refuse then allow in Settings; location off; Open in Maps with only coordinates.
- **Places step 4 (app), merged, not built (#100).** A share whose text holds a Google Maps link
  (and no files) opens the share screen as a Place with the name and link filled in. **Checked on
  the owner's phone:** Maps shares only the short `maps.app.goo.gl` link as text, with the place's
  name as the title, no address (the owner's Hinode Sushi and Lemongrass Thai Kitchen notes in
  Restaurants are plain notes made that way; after the build they can become places with Edit
  note → Make this a place). The link is never followed (Q3).
- **Places step 3 (app) merged, not built (#97, `main` at 0a98886).** New note has a **Note /
  📍 Place** choice (address, optional Google Maps link, kind, cuisine, price, dishes, occasions,
  want to go / been there with rating and "would go back"); Edit note edits a place's fields or
  turns a note into a place (fields the form does not show, visits, coordinates, Google place id,
  are kept); the note view shows the place, **Open in Maps** (the saved link, else
  `https://www.google.com/maps/search/?api=1&query=<address>`) and **We went again** (`update_item`
  `add_visit`); lists show "Restaurant · italian · $$ · Been there ★4". Code: `app/src/lib/places.ts`
  (pure, tested), `components/PlaceFields.tsx`, `components/PlaceCard.tsx`. **Links:** only Google
  Maps / `geo:` links are accepted or opened; React Native's `URL` is incomplete, so the app's
  `isMapsLink` reads links with patterns at least as strict as the server's (1,125 generated links
  compared: none accepted by the app and refused by the server). A new place with photos is saved
  with `save_item` first (the server checks its fields), then the photos go onto it. 355 tests;
  `expo export --platform android` bundles. **Not yet seen on a phone:** add its lines to the
  step 6 checklist (new place, edit, Open in Maps with and without a link, We went again, a
  non-Maps link refused, lists).
- **Expo patch updates (#98, merged, not built).** `expo-doctor` in the app checks turned red on
  every branch when Expo published patches: expo 57.0.27, expo-constants 57.0.21, expo-linking
  57.0.12, expo-router 57.0.25, expo-screen-capture 57.0.4, expo-sqlite 57.0.4. Taken as asked
  (patch level only); checks green. Ships in the step 6 build. In this sandbox `npx expo install
  --fix` cannot reach Expo's servers; install the versions the CI log names with `npm install`.
- **Places step 2 (server) is live** (`docs/places-plan.md`). #93: `mcp/lib/places.ts` checks a
  place's fields (known fields only, Google Maps / geo: links, kinds, status/rating, real dates,
  visits newest first), `update_item` gets `add_visit`, `search_items` returns a place's fields,
  migration `20261006120000_place_search.sql` (keyword search reads a place's metadata text;
  `search_items` returns `place`). #94: Wilma's instructions for places, **today's date in the
  chat prompt** (UTC), 8 evaluation cases. #95: the evaluation's pretend links now expire minutes
  ahead (they had a fixed 2026-10-02 date, which Wilma, now knowing the date, refused).
  **Migration:** dry run 12/12 in a rolled-back transaction, then **applied by the owner in the
  SQL editor** (the connector cancels scripts with `drop`, and `apply_migration` timed out), so
  Supabase's migration history does not list `place_search`; the repo's file is the record.
  Checked after: `search_items` returns `place`, anon refused. **Evaluation:** run 37497829851
  65/67 (the two link cases, fixed by #95), run 37499607450 **67/67, 0 leaks, 0 unsafe**, $0.02.
  **Deployed:** `mcp` version 12 (33/34 files identical, the `.d.ts` not listed back, 401 without
  sign-in and with a fake token), `chat` version 5 (45/46 identical, 401). This deploy also
  carries the `mcp` 0.6.1 vault-search change that was waiting for a deploy.
  **Mic, owner's answer (2026-10-06):** on versionCode 9 the permission question did appear on
  the first tap; later taps stopped silently. Fits the #91 explanation.
- **versionCode 9 mic bug, fixed in #91 (merged, not built).** On the owner's phone the mic
  turned red for a split second and stopped, recording nothing, no message. Cause (from the
  library code): every tap called `requestPermissionsAsync`; Expo opens Android's permission
  screen even for a permission already granted; that pauses the app, `AppState` said
  `background`, and `useDictation` cancelled the tap. Fix: `getPermissionsAsync` first, ask only
  when not allowed; going to the background stops the mic only once the recognizer has started
  (`pause()`). 335 tests. **Build decision (owner, 2026-10-06): no build for this fix alone;
  it ships with the next app build** (places step 6, `docs/places-plan.md`). Until then the
  mic on versionCode 9 does nothing (typing works). After that build: re-run "The first tap"
  and "Dictating" in `docs/phase5-a5e-phone-checklist.md` (and the rest of it, not yet
  reported). The owner's answer to "did the permission question appear on versionCode 9?" is
  not recorded.
- **A5e, voice: steps 3 and 4 merged, versionCode 9 building.** #86 the mic button in the home
  box and the chat box (`useDictation` / `createDictation` in `app/src/lib/voice.ts`,
  `MicButton.tsx`, `VOICE_ENABLED = true`; words go into the box, never sent by voice; Send waits
  while listening; 332 tests). #87 the privacy page (microphone and the phone's speech service)
  and the Data safety answers (Audio → Voice or sound recordings, optional, ephemeral); the page
  is live (Pages deploy of e7c15f8). The owner updates Data safety in Play Console (owner to
  confirm it was sent for review). **Production build** started 2026-10-06 from `main` at
  eaea7e4 (GitHub run 37405634042, auto-submit to internal testing): versionCode 9.
  **Next: the owner runs `docs/phase5-a5e-phone-checklist.md`** (it also carries the versionCode
  8 "Editing a note" lines). After that A5e is done; then `docs/places-plan.md` (step 2, server).
- **Play versionCode 8 is live** (built from `main` at e0baa40, GitHub run 37398360636, Expo
  build https://expo.dev/accounts/zafnut/projects/wilma/builds/0d379900-fd0b-4571-963a-4b351de7a2e3 ,
  auto-submitted): note editing (#78) and the speech package (#79, mic still off). The owner
  chose to skip the step 2 preview .apk and let this build be the start-up test: **it did not
  crash** (owner, 2026-10-06). The checklist's "Editing a note" lines are not yet reported.
  **Next: A5e step 3, the mic button** (strongest model, fresh session).
- **New idea, planned (2026-10-06): places**, a note type with a location for restaurants and
  places to visit (`docs/places-plan.md`, design D26). **Approved 2026-10-06, Q1-Q8 as
  recommended**; built after A5e (next there: step 2, server).
- **Play versionCode 7** (before 8), built from `main` at b3c50df: the Search
  link removal (#70) and the classifier's notes card (#77). **Phone checklist passed in full**
  (owner, 2026-10-06): `docs/phase5-a5d-step6-phone-checklist.md` minus its "Editing a note"
  lines, which belong to versionCode 8. **A5d step 6 is done on phones** (notes card and the
  Search link removal verified).
- **#78 (edit a note's title and text) is merged to `main`, not built:** it ships with
  versionCode 8, next when the owner says "build for Play"; then the checklist's "Editing a
  note" lines.
- **Step 6 server side is live:** migration `ai_cost_only` applied, `chat` version 4,
  classifier evaluation 28/28, 0 leaks (run 37351420880).
- **A5e step 2** (speech package, RECORD_AUDIO, `src/lib/voice.ts` behind `VOICE_ENABLED =
  false`, no screen): **merged (#79)**, built in versionCode 8, starts without a crash. Found while reading the packages: `expo-image-picker`'s
  `microphonePermission: false` blocks RECORD_AUDIO itself, so #79 removes it (the picker stays
  photos-only, guarded by a test).

The notes below are from 2026-10-05.

**A5d, the one box** (`docs/phase5-a5d-one-box-plan.md`; all 13 decisions "yes, as recommended"):
steps 1-5 merged (#63 plan, #64 router rules, #65 lookups in the thread, #66 routing in `send`,
#67 the box on the home screen), **not yet built**. The home screen's box sends the exact name
of one space (opens it) or one secret (its vault card, no model, not counted) without Wilma;
everything else goes to Wilma. Restricted spaces are left out of every lookup. A small **Search**
link (old note search, temporary) and **Conversation** link sit under the box. When the
allowance is used up, lookups still work. Rules: `app/src/lib/router.ts` (pure, tested);
routing: `chatRoute.ts` and `send` in `lib/chat.tsx`. **Step 6** (cheap classifier) is deferred
until the owner has used the box (it needs a `chat` change, a migration and eval cases).
**Built and live for internal testers: Play versionCode 6** (2026-10-05, from `main` at 6bb1b8e,
GitHub run 37246623531, https://expo.dev/accounts/zafnut/projects/wilma/builds/36ef55dd-3de7-43c5-b058-e68c47663ae1 ;
it also carries the layout fixes #60 and #61). **Phone checklist passed, 2026-10-05:** the owner
ran `docs/phase5-a5d-phone-checklist.md` on versionCode 6 and every line passed (the one box, the
allowance and offline lines, and the #60/#61 layout re-checks), so the layout fixes are now
verified on a device. **A5d is done.** Owner's decisions (2026-10-05): **drop the Search link**
(merged #70, not yet built: the home screen keeps only **Conversation** under the box; when the
allowance is used up, the held text runs the old note search instead, and the chat's **Search**
button runs it on the last question; never the model), **build step 6** (the cheap classifier)
and **start A5e** (voice) with a plan.

**Step 6, the cheap classifier: server side done (2026-10-05).** Migration `ai_cost_only`
(`record_ai_cost`: a classification's cost, not a request; #71) dry-run 11/11 in a rolled-back
transaction, then applied. `chat` **version 4** deployed from `main` at 003dafc (#72: the body
`{"classify": "..."}` answers `{"route":"search","query"}` or `{"route":"wilma"}`; the `router`
route gets only the message; vault words and credentials never reach the model; any failure is
`wilma`): 44/45 files identical to the repo (the `.d.ts` is not listed back, as before), 401
without sign-in and with a fake token. No live classification has been made yet: the app does
not call it. **Evaluation (#75, `tests/eval/router.ts`, `run.ts --suite router`):** 28 cases (10
searches, 9 for Wilma, 9 secret traps), each through the real `classify()`. **Run 37351420880
(2026-10-05), Luna on the router route: 28/28, 0 leaks, 0 timeouts, $0.0009 in total (about
$0.04 per 1,000 classifications), median 1.7 s;** the 5 guarded traps never reached the model.
**App side built (PR "App: the classifier's notes card"):** a short message that matches no name
at all (`placeLookup` null; two matches still go to Wilma, and vault words never reach the
classifier) asks the classifier; on `search` the app runs `search_items` (close matches, at most
5) and writes the message, a line naming the notes and a **notes card** with **Ask Wilma
instead**; anything else, no notes or any failure goes to Wilma. Not asked when the allowance is
used up. **Merged and built as Play versionCode 7** (2026-10-06, with #70);
`docs/phase5-a5d-step6-phone-checklist.md` passed on it (2026-10-06).
**A5e plan approved** (#73, Q1-Q8 as recommended): step 2 is PR #79 (above), `docs/phase5-a5e-voice-plan.md`.

**A5b, the `chat` function** (`docs/phase5-a5b-chat-function-plan.md`):
1. **Done, merged (#43):** one tool list (`mcp/tools/all.ts`) and one set of instructions
   (`_shared/assistant_prompt.ts`) for the MCP server, the evaluation and chat. The "new version
   replaces the old one" instruction is not yet confirmed by an evaluation run (the last run,
   55/56, missed exactly that). `mcp` not redeployed with this refactor (same behaviour; optional).
2. **Done, merged and applied (#44):** migration `20261002120000_ai_usage.sql` (27/27 checks in a
   rolled-back dry run): `ai_settings` (default $1/month), `ai_usage`, `record_ai_usage`,
   `my_ai_allowance`, personal limits, `is_admin` (the owner, $5 limit) and the admin functions.
3. **Built and merged, NOT deployed:** `supabase/functions/chat/` with `tests/deno/chat_test.ts`
   (21 tests). Protocol, rules and the deploy recipe: the plan's "As built: step 3". Merged (#46).
   Privacy page updated with the owner's approved chat wording (OpenAI, chat usage; 2026-10-02).
   Not yet confirmed against OpenAI's own data-controls page: the "up to 30 days for abuse
   monitoring" sentence; adjust if OpenAI says otherwise.
4. **Done, 2026-10-02: `chat` deployed** (version 2; a placeholder version 1 first proved that
   sibling-folder imports deploy). Deployed with the connector as the plan's "As built: step 3"
   says: 44 files named relative to `supabase/functions`, `entrypoint_path: "chat/index.ts"`,
   `import_map_path: "chat/deno.json"`, `verify_jwt: false`. Checked: 43 of 44 files identical to
   the repo (`mcp/lib/supabase-ai.d.ts`, types only, is not listed back, as for `mcp`); no sign-in
   and a fake token both answer 401. Live check on a throwaway user (then deleted by the owner in
   the dashboard; the connector's `execute_sql` timed out on the delete): streaming, status lines,
   a save, a vault-only message not counted, a delete that became a confirm card with the note
   untouched, 4 requests recorded at 0.108 cents (5 messages about 0.12 cents, so $1 is roughly
   2,000-4,000 messages), logs with ids, tool names and costs only. The app does not use `chat`
   yet (A5c). In this sandbox the owner had to approve calling the function and signing in the
   test user (Claude Code's safety check blocks both by default).
5. **Done, 2026-10-02:** evaluation re-run on the shared instructions with 3 new picture-upload
   cases (59 cases): **58/59, 0 leaks, 0 unsafe, $0.02** (run 37059170310). The "new version"
   instruction is confirmed; the one miss was the new case's check (fixed). Uploads are tested as
   the model setting them up (right note, upload link, no password copied from a picture): chat
   and the evaluation are text-only; the model seeing pictures is A5f.

**A5c progress (2026-10-04):** steps 2-7 done. The chat screen is **live for internal testers**
(Play versionCode 5, built from `main` at 61b1674, submitted 2026-10-04). The owner ran the phone
checklist (`docs/phase5-a5c-phone-checklist.md`): "looks good", but two layout bugs: the keyboard
covered the message box and Android's three-button bar covered it. Fixed in #60 (chat) and #61
(every screen) and merged, **not yet built**: the next Play build carries them. **Next:** a Play
build, then the owner re-checks chat, New note (Save button reachable), a form field near the
bottom while typing, the home search and the vault secret edit fields (the layout was verified by
lint, types, tests and a web bundle only, never on a device). Those re-checks are now part of the
A5d phone checklist.

**Next (was):** A5c, the chat screen in the app (strongest model: new code in the chat path).
The A5c plan (for the owner's approval, 10 decisions): `docs/phase5-a5c-chat-screen-plan.md`.

| Piece | State |
|---|---|
| Database | migrations up to `ai_cost_only` applied (2026-10-05; `ai_usage` 2026-10-02) |
| Chat function `chat` | **version 4, deployed 2026-10-05** (#72: the classifier request; 44/45 files identical, 401 without sign-in). Version 3, 2026-10-03 (#54: the `vault` event carries `secret_type` and `new_secret`; 43/44 files identical, 401 without sign-in), first deployed 2026-10-02 (version 2, #46) and live-checked; `OPENAI_API_KEY` and `LLM_ROUTES` set in Supabase secrets by the owner (2026-10-02) |
| MCP server `mcp` | **version 8, server 0.6.0**, 22 tools, with the rule 9 credential check (PR #31, deployed 2026-10-01; deployed files checked identical to the repo, unsigned calls answer 401) |
| Mobile app (Expo, `app/`) | merged to `main` up to PR #88 (#86, the mic button, building as versionCode 9; #70 and #77 built as versionCode 7; #78 and #79 as versionCode 8). Earlier, up to PR #69: A0-A3, A5c (chat screen, delete and vault cards) and A5d (the one box) complete, built (versionCode 6) and phone-checked. A3b secrets (#23), **A3c** spaces (#25), vault setup / recovery / passphrase change (#26), **A4** privacy + deletion pages and Play guide (#27), change sign-in password (#28), mascot app icon (#29, from another session), A5c chat screen (#50-#54), layout fixes (#60, #61), A5d one box (#64-#67). `npm run check`: 256 tests |
| Google Play | app created, **versionCode 9 building** (2026-10-06, from `main` at eaea7e4, run 37405634042: the mic button #86; Data safety needs the audio answer, `docs/phase4-play-release.md`). Internal testing, versionCode 8 live (2026-10-06, from `main` at e0baa40: #78, #79; started without a crash). versionCode 7 (from b3c50df: #70 and #77). Before it, versionCode 6 (built 2026-10-05 from `main` at 6bb1b8e, auto-submitted: https://expo.dev/accounts/zafnut/projects/wilma/builds/36ef55dd-3de7-43c5-b058-e68c47663ae1 ; A5d one box, chat screen, layout fixes #60/#61, mascot icon). Upload key reset done (see "Google Play and app updates"). App-content forms and store listing may still be incomplete; answers in `docs/phase4-play-release.md` |
| Web pages | `docs/legal/privacy.html`, `docs/legal/delete-account.html` live (contact zaftechlabs@gmail.com) |
| Supabase | ACTIVE_HEALTHY, region us-west-2 |

What the app does now: sign in (and change the sign-in password), spaces (create, nested,
delete when empty), search, items, attachments, notes with photos/Visio, recycle bin, Share to
Wilma, and the vault in full: set up (recovery key shown once), unlock (passphrase then
fingerprint), reveal, save / change / rename / delete secrets, change the passphrase, recover
with the recovery key. **Ask Wilma** (the chat screen, with delete and vault cards) is on the home screen.

## Trying the app in a browser (no phone, no build)

The app also runs as a web page (since `app/metro.config.js`, 2026-10-03), for a quick look at
work in progress. On a computer with Node.js: in `app/`, `npm ci`, then `npm run web:preview`
(builds the web version, then serves it at http://localhost:8080; Ctrl+C stops it); sign in with
your own Wilma account. (`npx expo start --web`, the live-reloading server, still fails on web:
expo-sqlite's worker is not bundled in that mode, Expo SDK 57.) Differences from the phone: no fingerprint (the vault unlocks
with the passphrase), screenshot blocking does nothing, and layout is close but not identical. The
phone checklist stays the final test before a Play build.

## Google Play and app updates (updated 2026-10-04)

- Wilma is on **Internal testing**, currently **versionCode 8** (2026-10-06: #78 note editing, #79 speech package, mic off). Testers are the owner plus family
  and friends; the owner creates their Wilma accounts in Supabase.
- **Server changes** (the `mcp` and `chat` functions, migrations) reach everyone without an app
  update.
- **App changes, how to ship:** the owner says "merge and build for Play".
  1. Merge the reviewed PRs.
  2. GitHub Actions **app build**, profile `production` (.aab, versionCode goes up by itself).
     It runs `npm run check`, then asks Expo to build (`--no-wait`) **and to auto-submit** the
     build to Play when it finishes. The GitHub run only starts the build; follow it on
     expo.dev (Builds, Submissions).
  3. If the build was not submitted (or only the submit failed): GitHub Actions **app submit**
     (`.github/workflows/app-submit.yml`) with the Expo build id (empty = latest finished
     Android build). It runs `eas submit ... --non-interactive --no-wait`. This path is proven
     (run 1, submission 1adc0d57…). Do not run both for the same build: Play refuses a
     versionCode it already has.
  4. `submit.production.android.releaseStatus` in `app/eas.json` is `"completed"`: the release
     is published to internal testers without pressing Publish in Play Console. Set it to
     `"draft"` to publish by hand.
  5. Testers update through Google Play. The Expo website has no submit button, only a command.
- **Submission key (set up 2026-10-04).** Google Cloud project `wilma-play`, service account
  `expo-upload@wilma-play.iam.gserviceaccount.com`, invited in Play Console with "Release apps
  to testing tracks" for `com.zaf.wilma`; its JSON key is at expo.dev → Credentials → Android →
  com.zaf.wilma → **"Google Service Account Key for Play Store Submissions"**. Lesson: it was
  first uploaded under "FCM V1 service account key" (push notifications), and the build then
  failed with "Google Service Account Keys cannot be set up in --non-interactive mode". The FCM
  entry is unused and harmless. The key file is never in the repo or in chat.
- **Auto-submit from `app build` works end to end** (proven 2026-10-05, versionCode 6: build and
  submission both succeeded, the owner confirmed). Its first run (18) had failed only because the
  key was in the wrong slot. `app submit` stays as the backup when only the submit fails.
- **Upload key.** The Expo credentials for `com.zaf.wilma` were deleted by mistake (2026-10-01),
  so EAS generated a new upload key for the next build; Google's upload-key reset was requested
  and became valid 2026-10-03 23:28 UTC, after which uploads work. (The helper workflow for
  extracting the certificate, #33, is on `main`; its follow-up #34 was closed, not needed.)
- **Preview .apk builds can no longer be installed over the Play version** (different signing
  key). Phones should use the Play version only.
- **Android layout lessons (A5c, #60/#61).** Expo SDK 57 draws the app edge to edge on Android:
  (1) every screen is padded at the bottom by the safe-area inset in `app/_layout.tsx` (otherwise
  the last button sits under the three-button bar); (2) `KeyboardAvoidingView` needs the
  header's height as its offset, so screens use `KeyboardScreen` from `components/ui.tsx`, never
  a bare `KeyboardAvoidingView`. The browser preview shows neither problem; only a device does.

## Rule 9 credential check (A5a step 1, built 2026-10-01)

`supabase/functions/mcp/lib/credentials.ts`, called first in `save_item`, `update_item`,
`attach_file` and `describe_attachment` (every text field: title, body, summary, tags, item
type, metadata keys and values, change note, attachment note and description). It refuses:
- well-known formats anywhere: Anthropic/OpenAI/GitHub/GitLab/AWS/Google/Slack/Stripe/
  Supabase/SendGrid keys, JWTs, private-key blocks, card numbers (network prefix + Luhn),
  `scheme://user:password@host`;
- labelled values: password/passcode/passphrase/pwd (also Passwort, mot de passe,
  contraseña, كلمة السر), Wi-Fi, PIN, door/gate/alarm codes, CVV, API key/token/secret, with
  `:`, `=`, `is`, `was`, `for X is`, `to`; plain-word passwords only when the value clearly ends
  the phrase ("Password: marigold", "the wifi password is sunshine.") or is first-person
  ("my password is fluffy and ...").

It lets through placeholders (`<password>`, `${DB_PASSWORD}`, `****`, `[YOUR-PASSWORD]`),
code and types (`password: z.string()`, `Uint8Array`), paths and links, and prose ("the
password is stored in the vault"). Run over this repo's own docs and code (about 1,400
paragraphs) it flagged only real-looking test values plus one known edge case: a JavaScript
ternary `x ? "passphrase" : "recovery"` reads like JSON `"password": "value"`.

The refusal ("Not saved: the body looks like it contains a password. ...") names only the
field and kind, never the value, points to `save_secret`, and suggests changing a value typed
into the chat. Nothing is saved, loaded or embedded when it fires. Tool errors are not logged.
Tests: `tests/deno/credentials_test.ts` (traps, false positives, through the tools).

## Owner's decisions this session (2026-09-30 / 10-01)

- Testing with the owner plus **family and friends** on Play **internal testing**. Each tester
  gets a Wilma account the owner creates in Supabase (sign-ups stay closed). Public contact
  email **zaftechlabs@gmail.com**.
- **A5 (chat and voice) comes before going public.**
- From another session (branch `design/vault-import`, merged in the A5-plan PR and renumbered
  after `main`'s D18): vault import D19, own app with AI built in D20, **provider-neutral
  model layer chosen by evaluation D21** (any provider's API key, not only Claude), pricing and
  budget D22, no search bar D23, memory D24, and **CLAUDE.md rule 9: security never depends on
  the model**. Rule 9's server check is built and live (PR #31, `mcp` version 8).

## Next task: A5a "safety net and evaluation" (`docs/phase5-chat-plan.md`)

1. Rule 9: `save_item` / `update_item` reject credential-looking content, with Deno tests.
   **Built and live** (PR #31, `mcp` version 8, server 0.6.0, deployed 2026-10-01).
2. `llm` module with Anthropic and OpenAI adapters (unit tests, no live calls). **Built** on
   branch `claude/a5a-llm-module` (`supabase/functions/_shared/llm/`, details in
   `docs/phase5-chat-plan.md` "The `llm` module"); nothing to deploy until the `chat` function.
3. The evaluation set and its runner: **built** (`tests/eval/`, 59 cases, 18 secret traps;
   `tests/eval/README.md`). It runs on a pretend account in memory behind the real tools, never on
   Supabase. Paid runs only with the owner's approval: GitHub Actions → "model evaluation".

Owner, before the first evaluation run: API accounts with a spend limit for the candidate
providers; keys as **GitHub repository secrets** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (for the
evaluation workflow), and later the same names in Supabase secrets (for the chat function).
Never in chat. Candidates in `tests/eval/models.json`: `luna` (`gpt-6-luna`, the
cheapest, released 2026-09-22; a first run with `gpt-6.0-luna` got "model not found" on every
case at no cost; the OpenAI project "Wilma" is
restricted to this one model), `haiku-4-5`, `sonnet-5-5-low`, `sonnet-5-5`; OpenAI prices were
found by web search on 2026-10-02 (OpenAI's pages are blocked from the sandbox), so compare a
run's cost with OpenAI → Settings → Usage. A model whose key is not set is skipped with a note.
Owner status 2026-10-02: OpenAI project "Wilma" with spend limits, restricted to
the GPT-6 Luna model, and an `OPENAI_API_KEY` created (in GitHub secrets per the owner's steps; not
verified from here). **Owner's decision: OpenAI/Luna only for now, no Anthropic key** while
Wilma's capabilities are tested; the eval workflow defaults to `luna`. What users see when a
limit is hit is decided: `docs/phase5-chat-plan.md` "What users see when a limit is hit". An
account out of credit is `llm` error `quota_exceeded` (not retried); the eval runner stops that
model and says so in the report.
First real results (Luna only): 52/56 twice, **0 leaks, 0 unsafe attempts**, about $0.27 per
1,000 requests, ~5 s per request; then 53/56; details in `docs/phase5-chat-plan.md` ("Results
so far"). The vault-search fix (`mcp` 0.6.1) needs an `mcp` deploy once merged. Also decide the per-person monthly limit for testers.

## Changing chat limits before the admin screen exists (after migration `ai_usage`)

Limits are in cents: 100 = $1. Changes apply from the next chat message; no deploy needed.

- **Default for everyone:** Supabase → Table editor → `ai_settings` → the one row →
  `default_monthly_limit_cents`.
- **One person:** Table editor → `app_user` → that person's row → `ai_monthly_limit_cents`
  (empty = use the default).
- **This month's usage:** Table editor → `ai_usage` (one row per person per month).
- **Admin:** `app_user.is_admin` is set by hand here too, for the owner only. Users can never
  change it, their own limit or their usage from the app.

## Owner status and open items

- Owner signs in to the app with **hassan.wehbe@gmail.com**. Testers' accounts: Supabase →
  Authentication → Users → Add user (Auto Confirm). To remove one: delete their Storage folder
  `attachments/<user id>/` first, then the user (the tables cascade; Storage does not).
- Expo account `zafnut`, project `wilma`, `EXPO_TOKEN` GitHub secret set. Builds: GitHub
  **Actions -> app build -> Run workflow** on `main`: `preview` (.apk for sideloading, "merge
  and build") or `production` (.aab for Play, "build for Play"; versionCode increments by
  itself). The owner uploads each `.aab` to Play Console by hand (internal testing → Create
  new release). **A Play install cannot update a sideloaded preview APK** (different signing
  key): uninstall the expo.dev APK first.
- Play listing images: `docs/play/icon-512.png` (= `app/assets/brand/play-store-icon-512.png`,
  the mascot) and `docs/play/feature-graphic.png`. The next production build carries the
  mascot icon (the current Play build still has the old "W").
- Suggested to the owner, not decided: Supabase Pro ($25/month) once family stores real data
  (daily backups, no pausing after 7 idle days).
- Branches the owner may delete on GitHub (sessions cannot delete branches): all merged
  `claude/*` branches (`revert-a3a`, `vault-crash-fix`, `fix-startup-crash-screen-capture`,
  `a3a-vault-unlock-reveal`, `a2b-share-to-wilma`, `handoff-2026-09-30`,
  `handoff-2026-09-30-evening`, `a3b-save-change-delete-secrets`, `plan-a3c-spaces`,
  `a3c-spaces`, `a3c-vault`, `a4-play-prep`, `a4-change-password`), `brand/wilma-mascot-icon`,
  `design/vault-import` and `claude/a5-plan-handoff` (PR #30 is merged).
- Search cutoff (`CLOSE_MATCH_MAX_DISTANCE = 0.2`) not calibrated on real data.
- The recycle bin never empties itself (owner's choice).
- `tests/browser/attachments_flow.mjs` still not run against the live project (throwaway user;
  ask first).

## Lessons from this session (read before adding native packages)

- **The start-up crash (A3a builds #18 and #20):** `expo-screen-capture` registers
  `Activity.registerScreenCaptureCallback` in its module's `OnCreate`, i.e. when the app starts;
  on Android 14+ that throws without `DETECT_SCREEN_CAPTURE`, which `app.json` had put in
  `blockedPermissions`. Fixed in #21 (permission no longer blocked; `src/lib/appConfig.test.ts`
  guards it). **Before blocking a permission a library declares, read its Android code for what
  runs at start-up** (`OnCreate`, `OnActivityEntersForeground`): Expo modules are created when
  the app starts, not when first used.
- The first diagnosis (react-native-libsodium) was a guess and cost a build; PR #20 replaced it
  anyway (still an improvement): the vault uses `src/lib/sodiumLite.ts` (noble-sodium + @noble in
  plain JavaScript, Argon2id native in `react-native-quick-crypto`, a Nitro module), loaded on
  first vault use. `expo-doctor` flags "untested on New Architecture" packages; React Native 0.86
  runs only the New Architecture, so prefer Expo modules, Nitro or TurboModule packages.
- When the owner reports a crash, ask *when* it happens (at launch, on a screen, on an action),
  then look for code that runs at that moment; list what changed since the last working build.
  An adb logcat from the owner's computer would show the exception if guessing fails.
- The vault crypto is tested three ways: `sodiumLite.test.ts` (each function vs libsodium
  0.8.4), `vaultCrypto.test.ts` (the app's vault on sodiumLite vs the web `docs/vault/crypto.js`,
  both directions), `vaultFlow.test.ts` (lock rules, reveal steps). Jest maps the web vault's
  vendored libsodium to the `libsodium-wrappers-sumo` dev dependency and transforms `@noble`
  and `@serenity-kit` (ESM).
- Prebuild rewrites `package.json` scripts: copy `package.json` aside before
  `npx expo prebuild` and copy it back after (a `git checkout package.json` also throws away new
  dependencies not yet committed). Then `rm -rf android`.
- `npm run check`: 105 tests after A3a, 117 after A3b, 129 after A4.

## History of this phase (details in the plan's "as built" notes)

- **A2b Share to Wilma** (PR #17): `expo-share-intent` (Android only; iOS extension off until
  phase B), own listener `src/lib/shareIntake.tsx` (the package's hook drops content:// links),
  files copied to the cache, one save flow `src/lib/saveNote.ts`. Confirmed on the phone.
- **A3a vault unlock and reveal** (PRs #18, #20, #21): see "Lessons from this session" above.

- **A1 read** (PR #11) + **Android session fix** (PR #12): on Android, expo-crypto's
  `AESSealedData.fromCombined` accepts only bytes (docs and iOS also accept base64), so the
  saved session could not be read. Lesson: native Expo APIs can differ from their docs by
  platform; read `node_modules/<pkg>/android` and `ios` when a call takes "string or bytes".
- **A1 polish** (PR #13): migration `search_cutoff` (optional `p_max_distance` on
  `search_items`; MCP `close_matches_only`, used by the app only), sign-in form above the
  keyboard, offline moments no longer sign out (`src/lib/sessionToken.ts`).
- **A2a** (PR #14): save notes and attach photos/Visio from the app; file rules ported from
  `docs/files/filetypes.js` with a cross-check test; camera permission only (microphone and
  storage blocked).
- **Delete and recycle bin** (PR #15): owner's decisions: deleted notes go to a recycle bin
  (restore / delete for good); only empty spaces can be deleted (the foreign keys cascade, so
  the check is essential). Migration `recycle_bin` (dry run `tests/sql/08_recycle_bin.sql`
  22/22), MCP tools listed above, app buttons and `app/src/app/bin.tsx`.

## Plan and decisions (phase 3)

`docs/phase3-mobile-app-plan.md`. Owner's decisions (2026-09-29): Expo (React Native) in
`app/`; Android first, iOS after, one codebase; package / bundle id **`com.zaf.wilma`**
(permanent after the first Play upload; nothing uploaded yet); personal Google Play account
for now; testing tracks first; chat and voice at A5 (the owner creates the Anthropic API key
then and puts it in Supabase secrets themselves); voice via the phone's built-in speech.

Working on `app/` in this sandbox:
- `docs.expo.dev` is blocked by the network policy (the owner may add it to the environment's
  allowed domains). Read the bundled package docs and `app/AGENTS.md`; add packages with
  `EXPO_OFFLINE=1 npx expo install <pkg>` (SDK-matched versions) from `app/`.
- Verify with `npm run check`, `npx expo config --type public`, `npx expo export --platform
  android`, and `npx expo prebuild --platform android --no-install` (then delete `android/`
  and restore the `android`/`ios` scripts in `package.json`, which prebuild rewrites).
- `expo-doctor`'s two online checks fail here; CI runs them. The build workflow can only be
  started for workflows already on `main` (GitHub returns 404 for a branch-only workflow).

## Open items from earlier (small, owner's call)

- Offered, not decided: Wilma asks "just the contents, or keep the photo too?" when a
  picture is shared without saying where it goes (a server-instructions change + redeploy).
- `tests/browser/attachments_flow.mjs` has not been run against the live project (needs a
  throwaway user; ask the owner first).
- The owner may delete merged branches on GitHub (Claude Code sessions cannot).

## Earlier work: attachments, step 1 (live)

Built in PR #7 as `docs/phase2-attachments-plan.md` describes
(see its "As built" section). Owner's decisions (2026-09-28): pictures `.jpg` / `.jpeg` / `.png`
and Visio (`.vsdx` text read on the upload page, `.vsd` stored only); **no AI keys** (Claude
writes picture descriptions in the chat); every upload starts in the chat with a space and
context; upload from phone or PC through a one-time link.

Done with the owner's go-ahead (2026-09-28): migration `attachments` applied (checked first in
a rolled-back dry run: `tests/sql/06_attachments.sql`, 47 checks), `mcp` v5 deployed (server
0.4.0, 17 tools), PR merged (GitHub Pages publishes `docs/files/upload.html`).

Still open: run `tests/browser/attachments_flow.mjs` against the live project with a throwaway
user (ask the owner first), and the owner tries "Wilma, attach this photo to …" in a new chat
(reconnect the connector if the new tools do not show up).

## What exists and is live

| Piece | Where | State |
|---|---|---|
| Database | Supabase project `digital-assistant`, ref `motvckmpusxiuelpwqxy` | migrations `initial_schema`, `knowledge_path`, `vault`, `cleanup_followups`, `assistant_name`, `attachments`, `search_cutoff`, `recycle_bin` applied; Storage bucket `attachments` |
| MCP server | Edge Function `mcp` (`supabase/functions/mcp/`), `https://motvckmpusxiuelpwqxy.supabase.co/functions/v1/mcp` | version 8 (server 0.6.0), 22 tools |
| Sign-in page | `docs/oauth/consent.html` → `https://hassan-wehbe.github.io/digital-assistant/oauth/consent` | used by the Claude connector (OAuth 2.1 via Supabase Auth) |
| Vault pages | `docs/vault/` → `https://hassan-wehbe.github.io/digital-assistant/vault/` | setup, enter, reveal, recover |
| Mobile app | `app/` (Expo), package `com.zaf.wilma`, Expo project `zafnut/wilma` | preview builds via GitHub Actions `app build`; latest build of PR #15 (see top) |
| Upload page | `docs/files/upload.html` → `https://hassan-wehbe.github.io/digital-assistant/files/upload` | live |
| Claude connector | "Digital Assistant" custom connector in the owner's Claude account | connected and in use (spaces Logins, Recipes exist) |

GitHub Pages publishes the **`/docs` folder of `main`** (not the repo root: with root, every
URL gains `/docs/` and both the connector sign-in and vault links 404).

Tools: `list_spaces`, `create_space`, `save_item`, `update_item`, `get_item`, `search_items`,
`link_items` (knowledge, M1); `save_secret`, `find_secret`, `get_secret`, `update_secret`,
`delete_secret` (vault, M2); `set_assistant_name` (invocation name, default Wilma; design.md D17).
Attachments (step 1): `attach_file`, `get_attachment_link`, `describe_attachment`, `delete_attachment`.
Deleting (recycle bin): `delete_item`, `list_deleted_items`, `restore_item`, `purge_item`, `delete_space`.

## Key design decisions (details in the docs named)

- Knowledge path (`docs/phase1-m1-plan.md`): one `item` table, gte-small embeddings (384)
  computed inside the Edge Function, hybrid search (`search_items` SQL, RRF), revisions on
  edit, restricted spaces never searched. Each request runs as the user (JWT forwarded, RLS).
- Vault (`docs/phase1-m2-vault-plan.md`, see "As built"): zero-knowledge. Secrets are
  libsodium sealed boxes to the owner's X25519 public key, encrypted/decrypted only in the
  browser on the vault pages. Private key wrapped by Argon2id(passphrase) and by a recovery
  key. Values never pass through chat or tool results: tools return one-time `#t=` links
  (entry 15 min, reveal 10 min, stored as SHA-256). Vault-page SQL functions refuse tokens
  with a `client_id` claim (the connector's OAuth token). `payload_enc` and wrapped keys are
  not selectable by `authenticated`.
- Vault pages load only same-origin code: libsodium 0.8.4 and supabase-js 2.117.2 are
  vendored in `docs/vault/vendor/`; strict CSP; SRI hashes on every script/module.

## Rules that must hold (CLAUDE.md)

Secrets never reach the model, logs or embeddings; restricted spaces invisible to search;
sharing never touches secrets; RLS everywhere; no credentials in the repo or chat; revisions
on edit; soft delete items. Every new table/function: revoke `anon`, grant only what
`authenticated` needs. Migrations live in `supabase/migrations/` (new file per change; never
edit an applied one).

## How to work on it (practical notes for a Claude Code cloud session)

- **Ask the owner before applying a migration or deploying the Edge Function.** The owner is
  returning to development: explain steps plainly, stop when they must act, and never ask
  them to paste a password, passphrase, recovery key or API key into chat.
- **Branches:** `main` is protected (pull request required, no force push). Work on a branch,
  open a PR, merge when the owner agrees.
- **Deno** is not preinstalled: `npm i -g deno`, then set `DENO_CERT=/root/.ccr/ca-bundle.crt`.
  Unit tests: `deno test -A --config supabase/functions/mcp/deno.json tests/deno` (211 tests:
  rule 9 check, `llm` module, evaluation machinery and the `chat` function included). Type check:
  `deno check --config supabase/functions/chat/deno.json supabase/functions/chat/index.ts` (and the
  same with `mcp`). Deno refuses npm packages younger than 24 hours: pin
  an older version rather than turning the check off.
  App: `cd app && npm ci && npm run check` (61 tests).
- **SQL tests** run through the Supabase connector (`execute_sql`), each wrapped in
  `begin; … rollback;` (`tests/sql/run.sh --print NN` builds the script). To check a new
  migration *before* applying it, prepend the migration to a test inside the same rolled-back
  transaction (dry run). **In a dry run, setup statements that run as the superuser see the
  owner's real rows** (e.g. a real "Recipes" space): always filter superuser lookups by the
  test user's id (`owner_user_id = '00000000-0000-4000-a000-00000000000a'`).
- **Deploying `mcp` (since 2026-10-08):** the "deploy chat" workflow with function `mcp`, as for
  `chat` (fresh `SUPABASE_ACCESS_TOKEN` secret, deleted in Supabase afterwards; it checks 401
  without and with a fake token); then compare the live files with `get_edge_function`. At
  about 140 KB, `mcp` no longer fits one connector call. The older connector route, for
  reference only:
- **Deploying `mcp`** with the connector's `deploy_edge_function`: pass every file under
  `supabase/functions/mcp/` (not `deno.lock`), `verify_jwt: false`, and
  `import_map_path: "deno.json"` (without it the deploy fails on a stale import-map path).
  The file contents are pasted into the call, so **verify after deploying**: `get_edge_function`
  (its output is saved to a file; parse it with python) and compare every file with the repo
  (all must be identical; one file may not be listed back: `deno.json` before 2026-10-01,
  `lib/supabase-ai.d.ts`, which holds types only, on 2026-10-01). Then `curl` the function without a
  token: it must answer 401.
- **Rollout order for a feature with a migration + server change + app:** apply the migration
  (new functions/parameters are backward compatible), deploy `mcp`, then merge and build the
  app. Ask the owner first ("merge and deploy").
- **GitHub API quirks:** `merge_pull_request` can answer HTTP 500 for a clean PR; retry after a
  minute (it worked on the second try on 2026-09-30). `expectedHeadSha` must be the full SHA.
  To wait for a CI run or the build hand-off, poll the public API with curl in a Bash loop
  (`/repos/Hassan-Wehbe/digital-assistant/actions/workflows/app-build.yml/runs?per_page=1`); the
  expo.dev build link is in the job log (`get_job_logs`, last lines, "See logs: ...").
- **After editing anything in `docs/vault/`, `docs/oauth/` or `docs/files/`:** `node scripts/vault-sri.mjs`
  (updates the SRI hashes); `tests/deno/vault_pages_test.ts` fails if you forget.
- **Attachments:** Storage uploads in SQL tests are simulated by inserting the `storage.objects`
  row as the user (the Storage policies apply). A test that deletes and then checks must use two
  statements (one statement sees the snapshot from before the delete).
- **End-to-end / browser tests** (`tests/e2e/vault_e2e.ts`, `tests/browser/vault_flow.mjs`)
  need a throwaway user: create it with SQL in `auth.users` + `auth.identities`
  (email `…@example.invalid`, random password), run, then `delete from auth.users` for it.
  Never use the owner's account.
- **Sandbox network:** cdn.jsdelivr.net and hassan-wehbe.github.io are blocked (check Pages
  builds via the GitHub Actions run logs instead); `*.supabase.co` and npm work. Chromium via
  Playwright needs `--proxy-server=$HTTPS_PROXY` and, to trust the sandbox proxy's CA only,
  `--ignore-certificate-errors-spki-list=<sha256 SPKI of /root/.ccr/agent-proxy-ca.crt>`.
  Serve pages locally with `python3 tests/browser/serve.py docs`.

## Owner status (earlier notes)

- Connector connected and in use. Vault set up (checked 2026-09-28); recommend they test
  the recovery key once on `/vault/recover`.
- `main` is protected; GitHub Pages builds from `main`, folder `/docs` (confirmed 2026-09-28,
  build #7 onward).
- Assistant name: Wilma (default), live since `mcp` v4. The owner should try "Wilma, …" in a
  new chat; if it is not picked up, disconnect and reconnect the connector.
- The old branch `claude/festive-fermat-fg6i75` is fully merged; the owner deletes it on
  GitHub (Claude Code sessions cannot delete other branches: HTTP 403).

## Open follow-ups (small)

- Done (applied 2026-09-28) in `20260929090000_cleanup_followups.sql` and the sign-in page cleanup: dead vault
  links answer HTTP 410 (PT410) instead of 500, RLS policies use `(select auth.uid())`,
  foreign keys are indexed, `docs/oauth/` loads only same-origin code (vendored
  supabase-js, strict CSP, SRI via `node scripts/vault-sri.mjs`), CLAUDE.md names
  `supabase/migrations/` as the source of truth.
- Advisor items left on purpose: `owns_*` and vault functions "callable by signed-in
  users" (they only answer for the caller; RLS needs them), token tables with RLS and
  no policies, "multiple permissive policies" (owner + share policies), unused indexes
  (the data set is still tiny). Leaked-password protection is a paid-plan Auth setting.

## Roadmap (docs/design.md §6)

- Restricted-space session unlock (make restricted spaces reachable when named and unlocked).
- Attachments: step 1 built (above); later TIFF, audio/video transcripts, automatic picture
  descriptions, a cleanup for files uploaded but never recorded, and item purge (must delete files).
- Emergency access for a trusted person (dormant grant + waiting period; private key sealed
  to the grantee).
- Item sharing (view/edit, expiry); reminders (`secret.expires_at`, follow-ups).
- Phase 3: voice input, Hermes/Telegram front end, web UI.
