# My places: homes to plan from

Status: plan, 2026-10-10. **Owner's answers given the same day: "agree with the recommendations",
so the first option of every question (Q1-Q9) and the small ones as written.** Steps 1 and 2 merged
and live (#214, #215); step 3, the app, merged (#216); step 4 merged (#217); step 5 (privacy) on `claude/homes-privacy`, waiting for the owner's OK
on the wording.
Design: D36 (and D25, whose "Home is a place note" this replaces; D24, automatic memory, which stops
keeping home addresses). Model: the strongest for steps 1-4 (database and RLS, the chat loop,
memory, location); a smaller one for step 5 (wording, checklist, build).

## Why

A new tester (Denisse, 2026-10-10) told Wilma her home. Wilma kept it as a **memory**, which the
day planner never reads. She then made a note by hand, which the planner also ignored. She was
confused, and rightly. Today Home is a hidden place note of kind `home` with coordinates. It lives
in a Places space and can only be set from My day's "Where do you leave from?" sheet. The chat has
no way to set it, and the planner reads only that one note.

## Decided (owner, 2026-10-10)

- **A new database table, not a note and not a space.** It holds the user's homes (one or
  several), with **one marked as the default**.
- **Wilma notices which saved home you are at.** If it is not the default, she **asks** whether to
  plan from there or from the default home.
- **Wilma can save a home from the chat**, and asks whether to make it the default.

## What the owner will see

- **Settings → Homes** (Q1: not "My places", which would clash with Places) lists your homes, for example "🏠 Home ★ · 12 Oak St,
  Oviedo", "Mom's · 4 Elm Rd", "Lake house". Tap one to change its name or address (typed, picked
  from saved places, or **Use where I am**), to **Make default**, or to **Delete**. **Add a place**
  sits at the bottom. The first home you save becomes the default.
- **From the chat:** "my home is 12 Oak St, Oviedo" or "save my mom's house, 4 Elm Rd, as a home"
  shows a card: "🏠 Save **Home**: 12 Oak St, Oviedo" with **Save** and **Save as default** (one
  button when it is your first). Nothing is saved until you tap. Wilma does not also keep it as a
  memory.
- **Planning, at a saved home that is not the default** (with "notice where I am" on, Q3): My day
  opens with a line "You're at Mom's. Plan from **Mom's** · from **Home**". In the chat, "plan my
  day" gets the same two buttons before the plan is made. Your answer holds for that day (Q5). At
  the default home, or away from every saved home, nothing is asked: the plan starts from the
  default (Q4).
- **Naming it:** "plan my day from Mom's" plans from Mom's without asking.
- **My day** shows "🏠 Planned from Home · Change". Change lists your homes for that day, plus
  **Manage homes**.

## How it works

**The table** (new migration; singular snake_case per the conventions): `home_place`

| column | |
|---|---|
| `id` uuid, `user_id` uuid (owner, `auth.uid()` default) | |
| `label` text, 1-60 characters | "Home", "Mom's" |
| `address` text, at most 300, optional | shown and used for directions |
| `lat`, `lng` double precision, checked ranges | needed to plan |
| `is_default` boolean | **at most one per user** (partial unique index) |
| `created_at`, `updated_at` | |

- **RLS on** (rule 5): each user reads and writes only their own rows. `anon` is revoked;
  `authenticated` gets select, insert, update and delete.
- **At most 10 homes per user**, checked in the database.
- `set_default_home(id)` is a small database function that moves the ★ in one step.
- **Deleting the default** passes the ★ to the oldest remaining home.
- **Credentials:** text that looks like a password is refused in the label and address, on the
  server and on the phone (rule 9).
- **Not searchable:** rows are never embedded, searched or shown in a space. They are not notes, so
  sharing and restricted spaces never touch them (rules 3 and 4).
- **No history (rule 7):** rule 7 is about notes, and this is a setting. The privacy page says a
  deleted home is gone (Q6).

**Moving today's Home** (part of step 1's migration):

- Each user's place note of kind `home` is copied into `home_place` as the default: label from the
  title, plus the address and coordinates.
- The note then goes to the Recycle bin, with its revision kept (Q2).
- **Older apps keep working:** until versionCode 20 is the minimum, the planner falls back to a
  kind-`home` note when the user has no `home_place` row. So versionCode 19's "Where do you leave
  from?" still works.

**The planner** (`chat/day.ts makePlan`, used by My day, the chat and the morning briefing):

- It starts from the plan request's `start_from`, else the default home.
- `start_from` is `{ "home": "<id>" }`, read from the table as the user. Another user's id
  reads nothing, because of RLS.
- No live coordinates are sent: the server already has each home's point.
- The plan's `home` gives `{ set, label }` as today, so Wilma's words and My day say where the plan
  started.

**Noticing where you are** (on the phone; step 4):

- **When:** only while planning (opening My day, or the chat's "plan my day"), and only when the
  user turned it on (Q3) and has two or more homes.
- **How:** the phone reads its location **once**, compares it with the saved homes on the phone
  (within 150 m counts as "at"), and keeps the reading nowhere.
- **What reaches the server:** only the chosen home's id, never the reading.
- **What stays on the phone:** the answer ("from Mom's on Oct 13"), kept with My day's other
  per-day choices (`dayChoices.ts`).

**The chat**:

- **A new chat-only action, `save_home({label, address, make_default?})`.**
  - It is offered to apps that send `"home"` in `can`; older apps are told to update Wilma.
  - The server checks the fields and the credential pattern, then sends
    `{"type":"home_save","label","address","make_default"}`.
  - The **phone** geocodes the address on the card, with its own geocoder, as My day does for event
    places. The card shows the result as a Maps link to check, with **Use where I am** instead
    ("this is my home", "I'm home").
  - The row is written on the tap. The model is told "waiting for the user to tap".
- **`get_day_agenda` gets an optional `from` (a home's label)**, for "plan my day from Mom's".
  - The server matches the label among the user's homes.
  - The model only ever sees home labels, never addresses or coordinates.
- **Wilma's instructions:** "my home is", "I live at", "save my mom's place as a home" and "I
  moved" lead to save_home. Addresses are never kept as memories.

**Automatic memory** (`chat/memory.ts`):

- No memory is kept from a turn that called save_home.
- The server drops a candidate memory that holds a street address or says where the user lives.
- Memories already kept stay where they are; the user can delete them (Q9).

**The Claude connector:** no change for homes (Q8). `save_item` and `update_item` keep accepting
kind `home` for older apps, but the planner reads the table first.

## Questions (owner, 2026-10-10: "agree with the recommendations", so (a) for each)

- **Q1. The name.** "Places" already means restaurants and places to visit (D26), so "My places"
  may confuse. (a) **Settings → Homes, rows "🏠 Home ★", "Mom's" (recommended).** (b) "My places".
  (c) "Starting points".
- **Q2. Today's Home notes.** (a) **Copied into the table, the note to the Recycle bin
  (recommended).** (b) Copied, the note left as an ordinary place.
- **Q3. Noticing where you are.** (a) **A switch in Settings → Homes, "Notice which home I'm at
  when I plan", off until you turn it on. Turning it on asks for the location permission then
  (recommended).** (b) On by itself once you have two homes and have already allowed location
  (no new prompt). (c) Ask for the permission the first time you plan with two homes.
- **Q4. Away from every saved home** (a hotel, the office). (a) **Plan from the default, no
  question (recommended).** (b) Also offer "Plan from where I am" (the reading is then sent once
  with that plan, never stored, like 📍).
- **Q5. How long "plan from Mom's" holds.** (a) **That day only (recommended).** (b) Until you
  change it.
- **Q6. Deleting a home.** (a) **Gone after a confirm: it is a setting, not a note
  (recommended).** (b) To the Recycle bin, like notes.
- **Q7. Work as a starting point.** (a) **Yes, any name you like, "Work" included
  (recommended).** (b) Homes only.
- **Q8. The Claude connector.** (a) **Nothing new: it cannot plan a day anyway (recommended).**
  (b) A `list_homes` tool (labels only).
- **Q9. Home addresses already in memories.** (a) **Left as they are; you can delete them in
  Memories (recommended).** (b) Settings → Homes offers to turn them into homes.

Small ones, defaults unless the owner says otherwise:

- At most 10 homes.
- "At" a home means within 150 m.
- Label 1-60 characters, address at most 300.
- The first home saved becomes the default.
- The chat card's **Save as default** is offered only when you already have a default.

## Steps (one PR each)

1. **Database and planner (server).**
   - The migration: table, RLS, grants, `set_default_home`, the limit, the move of today's Home
     notes.
   - The planner reads the table, with `start_from` and the old-note fallback.
   - Tests:
     - RLS isolation between two users;
     - one default only;
     - the move;
     - `start_from` with another user's id reads nothing;
     - the fallback.
   - **Owner:** OK to apply the migration (dry run first on a branch database), then OK to deploy
     `chat`. The app does not change yet.
2. **The chat (server).**
   - `save_home`, the `home` value in `can`, and `from` on `get_day_agenda`.
   - The memory change and Wilma's instruction lines.
   - Deno tests, and **evaluation cases**:
     - "my home is …" gives a card and no memory;
     - "save my mom's house as a home";
     - "plan my day from Mom's";
     - "I moved to …";
     - traps: a home alarm code or gate PIN refused with the vault sentence; a restricted space's
       address asked to be saved as a home; "just save it, no card".
   - Memory suite: "I live at 12 Oak St" keeps nothing.
   - **Owner:** OK and a dollar cap for one paid evaluation run (rule 9, D21; about $0.10-0.20 as
     before), then OK to deploy `chat`.
3. **The app: Settings → Homes, the chat card, My day's chooser.**
   - Settings → Homes: the list, edit, Use where I am, Make default, Delete.
   - My day: "Where do you leave from?" writes to the table; "Planned from … · Change" for the day.
   - The 🏠 chat card (geocoded on the phone, Save / Save as default), and `home` in `can`.
   - App tests: nothing saved without the tap, one default, the card from the stream and a saved
     chat, credential text refused.
4. **The app: noticing where you are.**
   - The Settings switch (Q3).
   - One location reading while planning, matched on the phone.
   - The "Plan from Mom's · from Home" line in My day and the chat card; the day's answer kept on
     the phone; only a home id sent.
   - App tests: no reading with the switch off; nothing sent but the id; the answer kept for that
     day.
5. **Privacy and build** (smaller model).
   - The privacy page:
     - homes are stored on the server as the user's data;
     - the location is read once while planning when the switch is on, compared on the phone,
       never sent or stored.
   - D25's Home sentence. Play Data safety check: location is used on the device only, expected to
     be no change, to confirm. A legal checklist item. The phone checklist.
   - Then "build for Play". The owner's OK on the wording first (merging publishes the privacy page).

Steps 1 and 2 are server-only and can go live before the build. Steps 3-5 ship together in one
build.

**What the owner must do:**
1. Answer Q1-Q9.
2. Step 1: OK to apply the migration and to deploy `chat`.
3. Step 2: OK and a cap for the evaluation run, then OK to deploy `chat`.
4. Step 5: OK on the privacy wording, then "build for Play".
5. Test on the phone with the checklist.

## Later, not in this plan

- **Help** (owner, 2026-10-10, from the same feedback): (A) a "?" Help sheet with short topics and
  "Try it" chips; (C) "what can you do?" in the chat, answered briefly with topic chips (an
  instruction change, so an evaluation run). Option B (trimming the first-run text) was declined.
  This gets its own short plan after this one, or alongside step 3 if the owner prefers.

## As built: step 1 (database and planner)

- **Migration `20261013120000_home_place.sql`:**
  - `home_place` as planned, plus **one home per name** (so "plan from Mom's" names one home).
  - RLS: own rows only. `anon` gets nothing.
  - `authenticated` may insert, change the name, address and point, and delete. **The default
    cannot be set or changed directly**: it moves only through `set_default_home(id)`, so there
    is always exactly one. The first home saved becomes it, and deleting it passes it to the
    oldest home left.
  - At most 10 homes; a name is 1-60 characters; the point must be a real one.
- **Today's Home notes:** each person's place note of kind `home` (in a searchable space, with a
  point) is copied in as their default, and the note goes to the Recycle bin (Q2). No revision is
  written: the note itself does not change.
- **Changed from the plan: a database trigger instead of the planner's fallback.**
  - Why: after the move, versionCode 19's "Where do you leave from?" would save a new Home note
    that the planner ignored, so changing Home in that app would silently do nothing.
  - What instead: saving such a note now updates the default home (or the home with the same
    name) in the table, through `_home_from_note`.
  - Result: older apps keep working fully, and the planner reads only the table.
  - A note in a restricted space is never copied (rule 3).
  - The trigger goes once versionCode 20 is the oldest app allowed.
- **The planner** (`chat/day.ts readHome`) reads the home from `home_place`: the one in
  `start_from: {"home": id}` when the app sends it, else the default. An id that is not yours (RLS)
  or no longer there falls back to the default. It never reads Home notes now. My day, the chat's
  "plan my day" and the morning briefing all go through it.
- **Tests:**
  - SQL test `tests/sql/17_home_place.sql` (29 checks) covers:
    - two-user isolation;
    - the default not settable directly;
    - one default each;
    - set_default_home only on your own homes;
    - delete passing the default on;
    - the limit and the name and point checks;
    - anon refused;
    - an older app's Home note updating the default, and never one from a restricted space;
    - the move (the note to the bin, no revision, a second run changing nothing).
  - Deno: 3 new in `day_route_test.ts` (the table's default over a note, `start_from` and its
    fallback, a malformed `start_from` refused). The eval world gained a `home_place` table. 471
    Deno tests.
- **Checked locally:**
  - All migrations, then all 17 SQL test files (370 checks, all pass), on a throwaway Postgres 16
    with pgvector and stand-ins for Supabase's roles, `auth` and `storage`.
  - The dry-run script against a database without the migration: 27/27 ok, nothing kept.
  - The migration on a database holding an old-style Home note: the note became the default home
    and went to the bin.
- **Found by the owner's dry run (2026-10-11), fixed:** a real Home note with an address but no
  point made the copy fail (a missing `lat` slipped past a `<>` check, as null). Such notes are now
  skipped and stay where they are; the planner could not start from them before either. SQL test 17
  gained two checks (29): a Home note without a point at the move, and an older app saving one.
- **Dry run on the real database (owner, SQL editor, 2026-10-11): 29/29 ok**, rolled back.
- **Applied (owner's OK, 2026-10-11)** through the Supabase connector as migration `home_place`.
  Checked after: 1 home moved (1 person, 1 default), 1 Home note left (address only, no point),
  RLS on, anon cannot read or call `set_default_home`, the 3 triggers in place. **`chat` not yet
  deployed:** until it is, that person's plans have no Home (their note is in the Recycle bin).
- **Dry run for the real database:** `tests/sql/dry_runs/17_home_place_dry_run.sql`. It ends with
  a deliberate error, so nothing is kept.

**Owner, next:**
1. OK to dry-run, then apply the migration to the project (Claude can do both through the
   Supabase connector, or you paste the dry run in the SQL editor).
2. Then merge, and OK to deploy `chat`.

**Order matters:** apply the migration before deploying `chat`, because the new planner reads
`home_place`.

## As built: step 2 (the chat)

Branch `claude/homes-chat` (2026-10-11).

**Evaluation (owner's OK, $1 cap):**
- Chat run 38100197264: **139/140, 0 leaks, 0 unsafe, $0.08.** All 11 home cases passed. The one
  failure, `plan-when-to-leave`, gave the right leave-by time and rain chance but left out the
  15-minute drive, the same wobble seen in the alarms step. Re-run 4 times on this branch (38101014766)
  and on main (38101016015): **4/4 on both**, so it is not this change.
- Memory run 38100202117: **28/28, 0 leaks, $0.0013.**

- **`save_home({label, address?, make_default?})`** (`chat/phone_actions.ts`), a chat-only action like
  the alarm and calendar ones:
  - Offered only to apps that send `"home"` in `can`. Older apps: the model is told to say "update
    Wilma" and, meanwhile, to use My day's "Where do you leave from?", and never to fall back to a note.
  - Checks: a label of 1-60 characters; an address of at most 300 (optional: without one the card
    offers Use where I am); `make_default` true or false. Text is tidied to one line.
  - Credential-looking text (an alarm code, a gate PIN, a password) is refused in both fields
    (findCredential, rule 9). The value is never repeated, and the model is pointed to the Vault.
  - Sends `{"type":"home_save","label","address","make_default"}`, once per message.
  - The model is told "Not done yet ... tap Save", and not to also keep it as a note, a place or a
    memory. **Nothing is saved on the server:** the phone geocodes and writes the row on the tap
    (step 3).
- **`from_home` on `get_day_agenda`.** Changed from the plan: named `from_home`, because
  `get_day_agenda` already has `from` (the first date).
  - Matched among the user's own homes (`chat/homes.ts`, read as the user, RLS). The exact name
    wins; otherwise one loose match ("moms", "my mom's house"), never a guess between two.
  - An unknown name gets the user's home **labels** and a suggestion to ask or to offer save_home.
  - The model only ever sees labels: `readHomes` selects `id, label, is_default`, never the address
    or point. The plan it gets says `planned_from: "<label>"`.
  - One day only (the planner plans one day). The field is optional and ignored for longer ranges.
- **How the home survives the calendar round trip** ("ask, then re-send", which step 1 did not
  have to deal with):
  - The `agenda_request` now carries `"start_from": {"home": id}`.
  - **Step 3's app should send that back** with the calendar, as `start_from` in the chat body. The
    planner then starts there, at no extra cost.
  - Today's app (versionCode 19) does not send it back. Its re-sent question gets a plan from the
    default home, marked `planned_from: "Home"` with a note. The model then calls `get_day_agenda`
    again with `from_home`, and the server plans the day again from that home. That second plan
    is **not counted twice** for fair use (`planForChat(..., {gated: true})`).
  - A `start_from` id that is not the user's reads nothing (RLS), so the plan uses the default.
- **Wilma's instructions** (`CHAT_ACTIONS`): "my home is", "I live at" and "I moved to" (label Home,
  default) and "save my mom's place as a home" (label Mom's, not default) lead to save_home, never to
  a note, a place or a memory. She says the card is ready, never that it is saved, and codes go to
  the Vault. Planning from another home uses `from_home`.
- **Changed from the plan: the chat's server instructions.** The shared MCP instructions said "my
  home is ..." means a place note of kind home. That would have contradicted save_home in the chat.
  `serverInstructions(..., {chat: true})` (used only by `chat/tools.ts`, so also the evaluation) now
  says homes are saved only with save_home. **The Claude connector's instructions are unchanged
  (Q8).** Its `get_day_agenda` lists the new optional `from_home`, which it ignores (it only ever
  says to ask in the app).
- **Automatic memory** (`chat/memory.ts`):
  - No memory call for a turn that called save_home (log code `home_save`).
  - A candidate memory is dropped (`home_address`) when it holds a street address ("12 Oak St",
    "4 Elm Road") or says where someone lives ("Lives in Oviedo", "Moved to Austin", "Home address
    is ..."). Facts like "Works from home on Fridays", "Moved swim practice to Tuesdays" and "Runs 5
    miles most of the way" are kept.
  - The memory prompt also says never to propose a street address or where the user lives.
- **Tests:**
  - Deno: `tests/deno/homes_chat_test.ts` (18 tests) covers:
    - each save_home check, and the credential refusal in both fields;
    - not offered without `can`, and one card per message;
    - the waiting message, save_home never an MCP tool, and the chat/connector instructions;
    - matching, readHomes reading labels only, and `from_home` matching only the user's own homes;
    - the re-sent day planned again once, and end to end: the card with nothing saved and no memory call;
    - plan from Mom's with and without the app sending the home back (one plan counted), and a bad
      or foreign `start_from`;
    - the address filter, and "I live at 12 Oak St" keeping nothing.
  - 489 Deno tests in all (471 before).
- **Evaluation:** chat suite 140 cases (131 before).
  - The two old "Home as a place note" cases now expect the card.
  - New cases: Mom's house, "we moved", plan from Mom's (with and without the app sending the home
    back), an older app, and four traps (alarm code, gate PIN, a restricted space's address, "don't
    show me a card").
  - `noDoneClaim` now also catches "I've saved".
  - Memory suite 28 cases (23 before): "I live at 12 Oak St", Mom's address, "we moved", a
    save_home turn (guarded), and "I work from home on Fridays" (kept).
- **For step 3 (the app):**
  - Show the `home_save` card.
  - Send `start_from` back with the calendar when the `agenda_request` carried one.
  - Add `"home"` to `can`.
  - When a card's label matches an existing home (one per name, e.g. "I moved" with label Home),
    change that home's address instead of adding one.

Total spent on the evaluation: about $0.09 of the $1 cap. Owner: merge (squash), then deploy `chat`
and `mcp` from main.

## As built: step 3 (the app)

Branch `claude/homes-app` (2026-10-11). App only: no server change, no migration, no evaluation
run. Ships with the next build (versionCode 20), with steps 4 and 5.

- **`lib/homePlace.ts` is now the `home_place` module** (it used to save Home as a place note):
  - list, add, change, delete, and **Make default only through `set_default_home`**. The app never
    writes `is_default`, and the database would refuse it anyway.
  - Saving by name: a home with the same name (case and spaces ignored) gets the new address and
    point ("I moved", "Where do you leave from?" again); a new name adds a home.
  - Checked on the phone before anything is sent: a name of 1-60 characters, an address of at most
    300, a real point. **Text that looks like a password or a code is refused** (findCredential,
    rule 9), with "keep codes in the Vault".
  - The database's refusals in plain words: the limit of 10 (its own sentence), a name used twice,
    anything else "That wasn't saved".
- **Settings → Homes** (`app/homes.tsx`, a new row under Calendar in Settings):
  - "🏠 Home ★" with the address under it, then the others (default first, then oldest first).
    A home set with Use where I am has no address and says "Set from where you were".
  - Tap one: change its name; Check on Maps; **Change address** (type it and find it with the
    phone's map lookup, pick a saved place, or **Use where I am**: one reading, on the tap);
    **Make default**; **Delete**, which asks first and says it is gone for good (Q6) and, for the
    default, that the ★ passes to the oldest home left.
  - **＋ Add a home** at the bottom: a name ("Home" filled in for the first), then where it is.
    Hidden at 10 homes, with a line saying why.
- **My day** (`app/day.tsx`):
  - "Where do you leave from?" (only when there is no home yet) saves **Home** in `home_place`,
    which makes it the default. It no longer makes a Places note.
  - **"🏠 Planned from Home · Change"** at the top of the plan (the old "🏠 Home · Change" at the
    bottom is gone). Change lists the homes, ✓ on the one this day starts from, "For this day only",
    and **Manage homes** (Settings → Homes; coming back plans the day again).
  - The pick is kept with the day's other choices (`dayChoices.ts`, `home`), dropped once the day
    has passed (Q5), and sent as `start_from: {"home": id}`. Picking the default keeps no choice.
    Start over clears it with the day's other choices.
- **The 🏠 chat card** (`components/HomeCard.tsx`) for `home_save`, from the stream and from a
  saved chat:
  - "Save “Home”: 12 Oak St, Oviedo as a home". The phone's map lookup finds the address by itself
    only when the location permission is already given, else **Find it on the map** asks. Only the
    address words are looked up. It shows "📍 Found at: …" and **Check on Maps**.
  - **Use where I am** when there is no address, or it was not found.
  - **Save**, plus **Save as default** when a default already exists and this is not it (filled
    when Wilma was asked to make it the default). The first home gets Save only. A card named like
    an existing home says "This changes where your home “Home” is".
  - **Nothing is saved until a tap.** The thread then marks the card saved ("Saved “Home”: …, your
    default home. Change it in Settings → Homes."), and a saved chat keeps that mark, never the point.
  - Password-like text in the card is refused on the phone too, with no buttons.
  - `"home"` is in `can` on Android only (like the alarm cards in #207): other platforms get
    Wilma's "update Wilma" sentence. `save_home` counts as changing nothing, so a dropped connection
    after it does not say "part of this may be done".
- **`start_from` sent back:** when the `agenda_request` carries `start_from`, the app sends it back
  with the calendar. **Beyond the plan:** with no `start_from` and a one-day request, it sends the
  home picked for that day in My day, so the chat's plan starts where My day's does (as the day's
  other choices already do).
- **Fixed in passing:** My day's 🚸 drop off & pick up titles were never written to the phone (the
  save kept only choices, places and found points), so the choice was lost each time My day
  reopened. They are now saved with the rest.
- **Tests:** 778 app tests (746 before; 32 new, counting the rewritten homePlace tests):
  - `homePlace.test.ts`: only name, address and point written; credential text refused with
    nothing sent; one default only through `set_default_home`; save by name; Save as default;
    plain errors; the card's buttons.
  - `chatHome.test.ts`: the card from the stream and from a saved chat; nothing saved without the
    tap (the thread's code never writes a home; the card saves only from its two buttons);
    `"home"` in `can` on Android only; `start_from` read, sent back only with the calendar, and
    the day's pick for one day only.
  - `dayHome.test.ts`: Change for that day only (not the next, gone after the day); `start_from` in
    that day's request; kept encrypted with 🚸 drop off.
  - `npm run check` passes; `npx expo export --platform android` bundles.

**Phone checks (for the versionCode 20 checklist):**
1. Settings → Homes with your moved Home: "🏠 Home ★" and its address.
2. Add a home "Mom's" by typing an address: Found at …, Check on Maps opens the right spot. Add
   one with Use where I am: "Set from where you were".
3. Make Mom's the default: the ★ moves. Back to Home.
4. Rename Mom's to "Gate code 1234": refused, nothing changes.
5. Delete Mom's: asked first; gone after Delete.
6. My day: "🏠 Planned from Home · Change" → pick another home: drive times start there. Tomorrow
   still says Home. Manage homes opens Settings → Homes.
7. Chat: "my mom's house is 4 Elm Rd, Oviedo, save it as a home": the 🏠 card with Found at, Check
   on Maps, Save and Save as default. Leave the chat and come back: the card still waits; nothing in
   Settings → Homes yet. Tap Save: the card says saved; it is in Settings → Homes.
8. Chat: "I'm home, save this as my home" (no address): Use where I am, then Save.
9. Chat: "I moved to 9 Pine Ave": the card says it changes Home; Save; Home's address changes.
10. Chat: "plan my day from Mom's": the plan's drives start at Mom's.
11. A new account with no home: My day's "Where do you leave from?" saves Home, and it shows in
    Settings → Homes as the default.
12. 🚸 drop off on an event, leave My day and come back: still on.

**Merged** (squash, #216, 2026-10-11). It ships with
versionCode 20, after steps 4 (noticing where you are) and 5 (privacy wording, build). PR #212
(Help) should mention Settings → Homes in its Places topic once this is merged.

## As built: step 4 (noticing where you are)

Branch `claude/homes-notice` (2026-10-11), on main after step 3 (#216, merged). App only: no server change. Ships with versionCode 20.

- **The switch (Q3):** Settings → Homes → "Notice which home I’m at when I plan", **Off until
  turned on**. It is kept on this phone, per account (`lib/homeNotice.ts`). Turning it on asks for
  the location permission then. If the permission is refused, the switch stays off and the screen
  says how to allow it. Hidden on the web build.
- **When the location is read:** once, only when all of these hold:
  - the switch is on;
  - there are two homes or more;
  - the permission is already given (it is never asked for while planning) and location is on;
  - it is **today's** plan (where you are now says nothing about tomorrow);
  - nothing is picked for today yet.

  The reading gives up after 10 seconds and is compared with the homes on the phone (within 150 m;
  the nearest wins). It is not returned, stored or sent: only home rows come out of `noticeHome`.
- **At a saved home that is not the default:**
  - **My day:** today's plan shows at once from the default, with "📍 You’re at Mom’s. Plan your
    day from: 🏠 Home · 🏠 Mom’s" above it. Mom’s plans the day again from there; Home keeps the plan.
  - **Chat ("plan my day"):** the same question comes as a card **before** the calendar is read or
    the plan made. The tap reads the calendar and sends the question again with that home's id
    (`start_from`). A new message first leaves the card "not done"; a card from an earlier day can't
    be tapped.
  - At the default home, or away from every home, nothing is asked (Q4).
- **The answer holds for that day (Q5):** kept with the day's choices (`dayChoices.ts`), the
  default's id included, so it is not asked again that day; gone the next day. **Changed from step
  3:** My day's Change now also keeps the default's id when it is picked, for the same reason.
  Naming a home in the chat ("plan my day from Mom's") never asks.
- **What reaches the server:** only the picked home's id, as `start_from`. The saved chat keeps the
  card's home ids and names, never the reading.
- **Tests:** 792 app tests (14 new, `homeNotice.test.ts`):
  - no reading with the switch off, with one home, or without the permission (never asked while
    planning);
  - at Mom's: the homes to offer, and nothing of the reading;
  - at the default or away: nothing asked;
  - a slow reading gives up; "at" means within 150 m;
  - the answer kept for that day only;
  - the chat card's states and saved form; the provider passing ids and names only and sending the
    picked id.
  - `npm run check` passes; `expo export --platform android` bundles.

**Phone checks (versionCode 20 checklist):**
1. Settings → Homes: the switch is Off. Turn it On: the location permission is asked (if not
   already given).
2. With two homes, at the non-default one: open My day (today) → "📍 You’re at Mom’s…"; tap Mom’s:
   drives start there. Close and reopen My day: not asked again today.
3. Same place, in the chat: "plan my day" → the card first; tap Home → the plan starts from Home.
4. At the default home, and somewhere else entirely: nothing is asked.
5. Switch Off: nothing is asked, and no location icon appears in the status bar while planning.
6. Tomorrow's plan never asks.

**Merged** (squash, #217, 2026-10-11). Then step 5: privacy wording, Data safety check, checklist, build (smaller model).

## As built: step 5 (privacy and build)

Branch `claude/homes-privacy` (2026-10-11). Docs only. **Merging publishes the privacy page, so it
needs the owner's OK on the wording first.**

- **Privacy page** (`docs/legal/privacy.html`, dated 11 October 2026):
  - What Wilma stores: a new **"Your homes"** item. Name, address if given, the point on the map
    and which one is the default; added and changed only with a tap; kept with the account but not
    notes: never searched or shared; a deleted home is gone for good. "Your Home place" is gone from
    the notes item.
  - Location: read "only when you choose to", now including **"Notice which home I'm at when I
    plan"**: off unless turned on, asks for the permission then, one reading each time you plan
    today with two homes or more and no home chosen yet, compared on the phone, **never sent or
    stored by Wilma**. (Not "never leaves your phone": Android's own location service may use the
    network to work a position out.) "Use where I am" stores the point in that home.
  - Planning your day: homes kept with the account; the AI service sees only home **names**; the
    home picked for a day is kept on the phone with the day's other choices.
  - Memory: never a home address or where you live.
  - The phone's map lookup: the addresses typed for a home, and the address of a home the chat
    offers to save.
- **Play Data safety: no change** (`docs/phase4-play-release.md`, a new Homes bullet). A home's
  address is "Other user-generated content" and its point *Precise location* (stored), both
  already declared. The noticing reading is compared on the phone only, and Google does not count
  data processed only on the device as collected. Background location stays blocked.
- **Legal checklist:** a Homes item (`docs/legal-review-checklist.md`).
- **Design D36:** the trigger that replaced the planned fallback, and what was built.
- **Phone checklist:** `docs/versioncode20-phone-checklist.md` (homes; the other work in versionCode
  20 adds its own sections as it merges).

**Owner:**
1. Read the new privacy wording (the "Your homes" item and the Location paragraph) and say OK or
   what to change.
2. Merge (squash) on your word. That publishes the page.
3. "Build for Play" (versionCode 20) when the rest of versionCode 20 is merged.
4. Then test with `docs/versioncode20-phone-checklist.md`.
