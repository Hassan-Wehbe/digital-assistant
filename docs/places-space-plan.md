# A Places space, and Wilma's spaces on Home (D45)

Status: plan, 2026-10-28. **Owner's answers (2026-10-28): Q1 yes, an existing "Places" space becomes
the built-in one; Q2 every note marked as a place moves into Places; Q3-Q9 all as recommended ("I
want to see it in action").** **Step 1 merged and applied 2026-10-28** (recorded as
20261028193355): see "As built: step 1". **Step 2 merged (#288) and deployed 2026-10-29**
(`mcp` v40, `chat` v50, `place-search` v1): see "As built: step 2". Raised by the owner
after a tester could not find her place when adding it to a task. Before sharing step 3 (D32).
Model: the strongest for steps 1-2 (a built-in space, the server's place rules); a smaller one for
the app screens (step 3).

## What happened

Denisse made a space called "Places", added a place to it, and then could not pick it for a task
("Where is it done? → Pick a saved place" found nothing). The picker lists only notes that are
**both** saved as a 📍 Place (the Place kind on New note) **and** have a spot on the map (a
Google Maps link with coordinates, or Save where I am). So a place is invisible to it when:

- it was saved as an ordinary note in a space named Places (Wilma does not treat a space's name as
  meaning anything), or
- it was saved as a 📍 Place with a typed address but no map spot (the address is never looked up
  after saving).

Both are easy to do and nothing on screen tells you. That is the clunkiness, not her mistake.

## What the owner asked for (2026-10-28)

1. **Places becomes a built-in space** every account has, like Tasks, Recipes and Cocktails.
2. **Every note in Places is a place.**
3. **Looking for a place** (a task's "where", My day's "where do you leave from", the chat) looks at
   the user's homes and the Places space.
4. **Places are any spot**, a library, a pool, a park, a school, a doctor's, not only restaurants:
   cuisine, price, dishes and the like show **only for somewhere to eat or drink**.
5. **A section on Home with all of Wilma's own spaces** (Tasks, Places, Recipes, Cocktails, ...).
6. **Add places from home, without being there** (owner, the same day): "I want to add frequently
   visited places while I'm at home; I don't want to be there and click." Today a place gets its
   map spot only from a Google Maps link or Save where I am (standing there).

## How it would work (recommended answers)

- **Add a place from anywhere: "Find it on the map"** (the main change, Q9). New place starts with
  one box: type a name and town or an address ("Coral Gables library", "12 Elm St, Miami"). Wilma
  looks it up and shows **"Is this it?"** with the address found and a small map; tap **Yes** and
  the place is saved with its spot, its address and a kind guessed from the name when it is clear
  (library, park, pool) and changeable. **No** lets you try other words or type the address. No
  Google Maps link to copy, no need to be there. Save where I am stays for when you are there.
  - Free first: the phone's own map lookup (already used by "Type an address"): reliable for street
    addresses, finds some well-known places by name.
  - With Google's place search (the same service planned for Discover nearby, D42): any business
    or spot by name, with its address, even "YMCA pool Coral Gables"; a few tenths of a cent per
    search, Pro or a small daily number for everyone (Q9).
- **Saving a place with only a typed address** looks it up the same way at Save, so a place is
  never saved without a spot unless the address can't be found (then it says so and saves it
  anyway).

- **The Places space** (built-in `places`): made for every account, like Recipes (an existing
  top-level space named "Places" is adopted, as Recipes adopted an existing "Recipes"; Denisse's
  becomes the built-in one, her notes in it included). It can't be deleted, renamed, moved or
  restricted, like the other built-in spaces. Sub-spaces are allowed (Places/Restaurants,
  Places/Kids).
- **A note in Places is a place:** New note opened from Places starts as a 📍 Place; a plain note
  saved there (by the app, the chat or the Claude connector) is kept as a place of kind "other",
  so it is never invisible again. **Every note marked as a place, wherever it is today, moves into
  Places** (owner, Q2); a place in a restricted space stays where it is, so it never becomes
  visible (rule 3).
- **No more invisible places:** the picker lists every saved place, with or without a map spot;
  one without a spot shows its address, and picking it looks the address up on the phone then (as
  "Type an address" does), and offers to keep the spot on the place. A place with neither address
  nor spot says "Add an address".
- **The picker's list:** your homes first, then places (Places space first, then places saved
  elsewhere), newest first; typing filters by name, address and kind.
- **Kinds:** today restaurant, café, bar, shop, to visit, hotel, other. Add **park, library,
  sports (pool, gym, field), school, health (doctor, dentist, pharmacy)** (Q5). **Cuisine, price
  and dishes show only for restaurant, café and bar**; occasions, rating, been / want to go and
  visits stay for every kind.
- **Home: "Your spaces"** (Q6): a short row of Wilma's own spaces under Plan with Wilma, each one
  tap: ✅ Tasks, 📍 Places, 🍳 Recipes, 🍸 Cocktails, 🧠 Memories (Memories only when memory is
  on). Favourite spaces stay below as today.
- **Rules:** places in a restricted space stay out of every list (rule 3), as today; a place never
  holds a gate code or alarm PIN (rule 9, as today); homes stay in Settings → Homes (D36), never a
  place.

## What Google's place search would cost (Q9)

The cheapest way to add a place by name is Google's **Autocomplete**: suggestions as the user types
("Coral Gables lib…" → "Coral Gables Branch Library, 3443 Segovia St"), then one **Place Details**
lookup of the one they pick, for its spot and address. Google bills this per "session" (the typing
plus the one pick). Prices from Google's price list (October 2026; to confirm on the live page
before switching it on):

| Piece | Price | Free each month (whole app) |
|---|---|---|
| Autocomplete, per request while typing | $2.83 per 1,000 | 10,000 requests |
| Place Details Essentials (spot and address), per pick | $5.00 per 1,000 | 10,000 |
| or Place Details Pro (adds Google's name and kind): then the typing is free | about $17 per 1,000 | about 5,000 |

- **One place added: about 1.5 to 2 cents** (about 4 suggestion requests while typing, waiting for 3
  letters and a pause, plus the pick), either way.
- **A regular user** adds most places in the first weeks: say **10 places the first month (about 20
  cents), then 2-3 a month (about 5 cents)**. A Pro user who also uses it from the planners, a bit
  more; the 20-a-day limit caps anyone at well under a dollar a month.
- **For the app as a whole it is free until about 2,500 sessions a month** (the free 10,000
  requests and 10,000 picks), so about 1,000 users adding 2-3 places a month cost nothing. Past
  that, about $15-20 per 1,000 places added.
- Text Search (one search, a list of results, as planned for Discover nearby, D42) would be about
  **3.2 cents a search** (5,000 free): Autocomplete is cheaper for adding one known place.
- A $10 monthly budget alert in Google Cloud, as D42 planned, and usage tracking counts every
  lookup (`google_places`, D34).

## Questions (recommendation first)

- **Q1 (answered: yes, an existing "Places" adopted). A built-in Places space:** **yes, for every account; an existing top-level "Places" is
  adopted** (rec.); or only for new accounts.
- **Q2 (answered: every place moves into Places). Places saved in other spaces today** (testers have Restaurants spaces): **leave them where
  they are; they still count everywhere** (rec.: nothing moves under anyone); or move them all into
  Places once (Places/<old space name>), or ask each user in the app ("Move 6 places into Places?").
- **Q3. A plain note in Places:** **kept as a place of kind "other"** (rec.); or refused with "save
  it as a 📍 Place".
- **Q4. Places with no map spot:** **listed, looked up when picked, and the spot kept on the place
  with the user's OK** (rec.); or listed with "add a spot first".
- **Q5. New kinds:** **park, library, sports, school, health** (rec.); or a different list (say
  which).
- **Q6. Home's row:** **Tasks, Places, Recipes, Cocktails, and Memories when memory is on** (rec.);
  or without Memories; or the Vault too.
- **Q7. Sharing (D32):** **Places can be shared, like Recipes** (rec.: "our family's places"); or
  never.
- **Q9. Finding a place by name from home:** **Google's Autocomplete for everyone, 20 lookups a day,
  the phone's free lookup when typing a full street address** (rec.: about 1.5-2 cents a place, free
  for the whole app up to ~2,500 places a month; it reuses D42's setup); or the phone's free lookup only (addresses work, names sometimes);
  or Google's search for everyone with no limit.
- **Q8. When:** **before sharing step 3** (rec.: it changes the spaces the share screen lists); or
  after.

## Steps

1. **Database (strongest model).** Built-in `places` (made, or an existing "Places" adopted, for
   every account and at sign-up), the built-in guard, the kinds list; SQL test and a dry run.
   **Owner:** dry run, OK to apply, merge.
2. **Server (strongest model).** Places as the default space for a place; a plain note in Places
   kept as a place; the new kinds; eatery-only fields; find_places, the planners and near me read
   every place as before; Deno tests; an evaluation run (owner's OK and a cap). **Owner:** merge,
   OK to deploy.
3. **App (smaller model), mockups first.** "Find it on the map" on New place (Is this it?), the
   address looked up at Save, the picker (homes, every place, look up on pick), New note in Places, the place form's kinds and eatery-only fields, Home's "Your spaces" row; app
   tests. **Owner:** pick the mockup, merge, OK to build.
4. **Phone checklist.** Denisse's case first: a place in Places, with an address only, picked for a
   task; then adding the library and the pool from the couch.

With Google's search (Q9), steps 2 and 3 also carry a small `find_place` lookup on the server
(the Google key never on the phone), counted in usage tracking (D34) as `google_places`.

**Right away, before any of this (no build):** Denisse can open her place, tap Edit, choose the
📍 Place kind if it is a plain note, and add a Google Maps link (Share → Copy link in Google Maps)
or tap Save where I am while there; it then shows in the picker.

## Step 3 mockups and the owner's answers (2026-10-29)

Mockups: `docs/places-mockups.html`. **Owner's answers (2026-10-29): Q1 A (search first), Q2 B (small
tiles), Q3 turn the plain notes already in a built-in space into its kind once.** And, from the owner on
the mockups:

- **"If I am adding a note to Places, I should be adding a place note. Same for the built-in spaces."**
  One kind per built-in space (and its sub-spaces): Tasks holds tasks (and routines, D39), Places
  places, Recipes recipes, Cocktails (Mocktails) drinks, Memories memories. In the app, a built-in
  space's ＋ opens that kind's form (New task, New place, New recipe, New cocktail / mocktail, Remember
  something), with no Note / Place / Recipe choice; New note from Home keeps its chips and hides them
  once a built-in space is chosen. On the server, a plain note saved or moved there (chat, Claude
  connector) is kept as that kind; a task, recipe, drink or place in the wrong built-in space is
  refused.
- **"The big description must remain the same for stuff shared from outside that we can't read."**
  Turning a note into its space's kind, now or once for old notes, never changes its title or its text:
  only its type and a few empty fields. A recipe shared from TikTok that Wilma can't read keeps the
  whole shared description as its text.
- **"The links ideally should be clickable."** Web links (https and http) in a note's text open in the
  browser when tapped, on every note (places, recipes, tasks, plain notes). Other kinds of links stay
  plain text.

On the live project (read-only, counts only, 2026-10-29): Recipes holds 2 plain notes (and 4 recipes),
Memories 1 plain note (and the old Home note, which stays, D36), Tasks only tasks and a routine,
Cocktails nothing else. So the one-time change touches 3 notes.

### Steps, revised

2b. **Server and database (strongest model).** One kind per built-in space in `save_item` /
    `update_item` (Places done in step 2); a migration turning the plain notes already in Tasks,
    Recipes, Cocktails and Memories into their kind once (title and text unchanged, a revision kept,
    rule 7; a memory longer than one short fact is left as it is); SQL and Deno tests; an evaluation
    run. **Owner:** dry run, OK to apply, merge, OK to deploy.
3.  **App (smaller model).** Q1 A: New place starts with "Find it on the map" (Google's suggestions,
    then Is this it?), the address looked up at Save; the picker (homes, every place, looked up on
    pick); the kinds and eatery-only fields; each built-in space's ＋ opens its kind's form; Q2 B: "Your
    spaces" tiles on Home; tappable links in a note's text; app tests; a preview build on the owner's OK.

## As built: step 3, the app (2026-10-30)

Merged (#292, with Expo SDK 57 patch updates for expo-doctor). **versionCode 28 built 2026-10-30**
(EAS build 83f75d9b, production) and submitted to Google Play's internal track (submission
722e05a5). A preview build (EAS 0bf61cf7) was started first by mistake; it is not on Play and can be
ignored. Owner's picks: Q1 A (search first), Q2 B
(small tiles), one kind per built-in space, tappable links.

- **Find it on the map** (`components/FindOnMap.tsx`, `lib/placeSearch.ts`): a new place starts with
  one box. A name ("coral gables lib") shows Google's suggestions after 3 letters and a short pause
  (the `place-search` function; only the typed words are sent, never where the phone is), with
  "powered by Google" under them; a full street address ("12 Elm St, Miami") goes straight to the
  phone's own free map lookup. Picking one asks **Is this it?** with the spot the phone's lookup
  found for its address and Open in Maps; Yes fills the name, address, kind and spot (and keeps
  Google's place id). Not found: "Save it without a spot". No Google key yet, or the day's limit
  reached: the box says so and still finds a full street address. Also on the screen: 📍 Use where I
  am now, and Fill it in by hand; the form has "🔎 Find it on the map instead".
- **Saving with only a typed street address** looks it up on the phone at Save (no permission asked
  there; only the address is sent); not found, it is saved as typed.
- **Kinds**: park, library, sports, school, health added, each with an icon (🌳 📚 🏊 🏫 🩺);
  cuisine, dishes and price show only for a restaurant, café or bar (or before a kind is chosen) and
  are not saved for other kinds, as the server.
- **The picker** (`components/PlacePicker.tsx`, `pickRows` / `filterRows` in `lib/homePlace.ts`) opens
  straight to one list: homes first (not when picking where a home is), then every place, those in
  Places first, with or without a spot. Typing filters by name, address and kind. A place with an
  address but no spot is looked up when picked (Is this it?, with "Keep this spot on the place", on
  by default; kept with update_item); one with neither says "Add an address" and opens the place.
  Under the list: Type an address, Use where I am now (homes), Not now.
- **One kind per built-in space** (`lib/builtInSpaces.ts`): a built-in space's button (and its
  sub-spaces') says ＋ New task / New place / New recipe / New cocktail (New mocktail) / Remember
  something; New note hides the Note / Place / Recipe chips in a built-in space and uses its kind;
  Tasks opens the task form; Memories is one short line (200 characters, no files). Places is now
  marked BUILT-IN too.
- **Home**: "Your spaces" small tiles under Cook with Wilma (Tasks, Places, Recipes, Cocktails, and
  Memories when memory is on); the ＋ menu has 📍 New place.
- **Tappable links** (`components/LinkedText.tsx`, `lib/textLinks.ts`): https and http links in a
  note's text open in the browser; the text is shown exactly as saved; a link with a user name or
  password in it, or any other kind of link, stays plain text.
- **Tests**: new `placeSearch.test.ts` (8), `builtInSpaces.test.ts` (5), `textLinks.test.ts` (2), and
  more in `places.test.ts` and `homePlace.test.ts`. **`npm run check` passes: lint, type-check, 84 test
  files, 1,040 tests.**

**Owner:** the phone checklist on versionCode 28 (step 4). The Google key is still optional: without it, finding by name says it is not switched on
and a full street address still works.

## As built: step 2b (2026-10-29)

Merged (#290), **deployed 2026-10-29: `mcp` v41, `chat` v51**. **Migration applied 2026-10-29** with the
Supabase connector (recorded as 20261029165902 `one_kind_per_builtin_space`), after the owner's dry run
(10/10). Checked read-only, counts only: 3 notes changed (Recipes now 6 recipes, Memories 1 memory),
3 history entries written, the old Home note left in Memories, users can't run it.

- **One kind per built-in space, on the server** (`lib/builtin_kinds.ts`, `save_item`, `update_item`): a
  plain note (note, design, how-to, ...) saved in Tasks, Places, Recipes, Cocktails or Memories, or a
  sub-space of one, is kept as that kind (task: open; place: kind Other; recipe; drink; memory), its
  title and text unchanged, and the reply says so. Moved there, likewise. A note of another kind is
  refused ("\"Recipes\" holds only recipes"); a routine stays allowed in Tasks; a note there can be made
  plain only when it is moved out at the same time. The checks of each kind still apply: a memory must
  be one short fact (200 characters at most); a drink with no strength counts as one with alcohol for
  an account under 21 (D44). Shared spaces follow their owner's own rules (not built-in for the user).
- **Migration `20261029120000_one_kind_per_builtin_space.sql`** (Q3): `_one_kind_per_built_in(user)`
  turns every live plain note already in a built-in space into its kind once, for every account. Only
  the type and the fields change (an empty task, place, recipe, drink or memory, as the server makes
  one); the title and text stay word for word (owner: "the big description must remain the same").
  The old version goes to the history with a change note (rule 7). Left alone: notes of another kind
  (the old Home note in Memories, D36), the bin, a memory title too long to be one fact, and an
  under-21 account's notes in Cocktails while the age check is on. Users can't run it. On the live
  project this is 3 notes (2 in Recipes, 1 in Memories).
- **Tests:** SQL test 29 (10 checks); every SQL test passes (712 checks, local Postgres 16); dry run
  10/10 on a copy without the migration, nothing kept. Deno: 5 new checks in
  `tests/deno/places_space_test.ts`; **694 Deno tests pass**. Evaluation: a new case (a TikTok link
  saved to Recipes is a recipe, the link kept). **Run 40914205114: 183/186, 0 leaks, $0.12**; the
  three misses rerun three times each (run 40917907445): the restricted-recipe trap 3/3, "not since
  the summer" 3/3, the Venetian Pool 2/3 (once kind "to visit", fair for a landmark pool: the case now
  accepts sports or to visit).

**Next:** step 3, the app (smaller model, a fresh session).

## As built: step 1 (2026-10-28)

Branch `claude/places-step1`. **Migration `20261028120000_places_builtin_space.sql` applied 2026-10-28**
with the Supabase connector (recorded as 20261028193355 `places_builtin_space`). Checked read-only
(counts only): 3 accounts, each with one Places space and its five built-in spaces; 9 places in
Places; the one left elsewhere is the old Home note; users can't run the move.

- **Places is a built-in space** (`space.built_in = 'places'`) for every account and at sign-up:
  an existing top-level, not restricted "Places" (any case) is adopted with its notes; a restricted
  one is left alone and none is made beside it (rule 3). Like the other built-in spaces it can't be
  renamed, deleted, moved or restricted; its description can change; sub-spaces are allowed.
- **Every live place moves into Places** (`_move_places_into_places`, run once per account in the
  migration): from any space that is not restricted and not under a restricted one. Not moved: a
  place in a restricted space (rule 3), a place already in Places or under it, old Home notes (D36),
  places in the recycle bin. Only the space changes, so no revision is written; a place shared on
  its own (D32) keeps its share. The emptied spaces stay; the user can delete them.
- **On the live project (read-only, counts only, 2026-10-28):** 3 accounts; 2 already have a
  top-level "Places" space (both adopted; both hold no notes today); 10 live places, 9 will move
  into Places, 1 old Home note stays; none in a restricted space.
- **SQL test 28 (18 checks):** one Places per account; adopting "places"; a restricted "Places" left
  alone; the move (top-level and nested spaces in; restricted, Places/Kids, Home, binned and plain
  notes not; only the account's own; no revision; share kept; twice moves nothing); the built-in
  guard; users can't run the move. Tests 16, 17, 21 and 23 updated (five built-in spaces per account;
  test 17 reuses the built-in Places). **Every SQL test passes** (702 checks, local Postgres 16 with
  pgvector). **Dry run 18/18** on a copy without the migration, nothing kept.

**Owner:** merge. **Next:** step 2, the server.

## As built: step 2 (2026-10-28)

Merged (#288), **deployed 2026-10-29: `mcp` v40, `chat` v50, `place-search` v1** (no Google key yet:
it answers `not_set_up`). Server only; the app does not use any of it until step 3. **Evaluation:** run
40892435538 183/185, 0 leaks, $0.12 (the library case's own check was wrong, fixed; `home-no-card-trap`
missed once); rerun 40895916230 of the place cases and that one, twice each: 8/8, under a cent.

- **A place is kept in Places** (`save_item`, `update_item`): saved without a space, it goes to
  Places; asked for in another space ("save it in Restaurants"), it goes to Places, or to the
  sub-space of Places with that name when there is one (Places/Restaurants), and the reply says so.
  Kept where asked: Places and its sub-spaces, a restricted space (rule 3, as in step 1), a space
  someone shared with the user (D32: theirs), and a Home (D36). A place can't be moved out of Places
  (except into a restricted space); a note made a place moves into Places. Without a Places space
  (an older database) nothing changes.
- **Every note in Places is a place (Q3):** a plain note saved or moved there is kept as a place of
  kind "other" (its old fields are kept in its history, rule 7); a task, routine, recipe or drink is
  refused there ("Places holds only places"); a place in Places can be made a plain note only when it
  is moved out at the same time.
- **New kinds (Q5):** park, library, sports, school, health, with everyday words (pool, gym →
  sports; doctor, dentist, pharmacy → health; playground → park). **Cuisine, price and dishes only
  for a restaurant, cafe or bar** (or a place with no kind yet); otherwise left out, and the reply
  says which.
- **Wilma's instructions:** places are any spot, kept in Places; save without a space.
- **Find a place by name (Q9): a new small server function, `place-search`**, for the app only (the
  chat model and the Claude connector never see it). The app sends what the user types; it asks
  Google's Autocomplete (New) and returns up to 5 suggestions: Google's place id, the name, the
  address line and a kind guessed from Google's types (library, park, ...). Only suggestions, never
  Google's place details: the app keeps the id and the confirmed name, and the spot comes from the
  phone's own map lookup of the address (Google's terms let only the id be kept for good). Sign-in
  checked (rule 5; no service-role key); nothing that looks like a password is sent (the same check
  as save_item); nothing typed is logged; every request counted in usage tracking (`google_places`,
  about 0.28 cents each); **at most 100 requests a user a day** (about 20 places), then
  `daily_limit`; without the Google key it answers `not_set_up` and the app offers the address box.
  Deployed with the "deploy chat" workflow (function `place-search`).
- **Evaluation world:** a built-in Places space holding the saved places (as after step 1); the
  Mezyan case now expects Places; two new cases (a library: kind library, no cuisine or price; "add
  the Venetian Pool to my Restaurants space": a sports place, in Places).
- **Tests:** `tests/deno/places_space_test.ts` (13), `tests/deno/place_search_test.ts` (8); two
  older tests updated for the Places space in the pretend world. **690 Deno tests pass.**

**Owner:** switch on Google's place search (below) whenever ready: the app works without it.
**Next:** step 3, the app (mockups first).

**What Google's place search costs (as built: suggestions only, no place details):** $2.83 per 1,000
requests, about 0.28 cents each; about 4-5 requests per place added, so **about 1.1-1.4 cents a
place**. A regular user: about 12-14 cents the first month (10 places), then 3-4 cents a month; the
100-a-day limit caps one user at 28 cents a day. The whole app: the first 10,000 requests a month are
free (about 2,000-2,500 places), so 100 users cost nothing and 1,000 users about $14 a month.

### Owner: switching on Google's place search (about 15 minutes)

Never paste the key into the chat or the repo (rule 6).

1. **Google Cloud console** (console.cloud.google.com) → create a project, e.g. "Wilma".
2. **Billing** → link a billing account (Google asks for a card; the free monthly amounts apply first).
3. **APIs & Services → Library** → search **"Places API (New)"** → **Enable**. (Not the older "Places API".)
4. **APIs & Services → Credentials → Create credentials → API key.** Then **Edit the key**:
   - **API restrictions → Restrict key → Places API (New)** only.
   - Application restrictions: **None** (the key is used by Supabase's servers, whose addresses change;
     the API restriction and the daily limit keep it safe).
   - Name it "Wilma place-search". Copy the key.
5. **Billing → Budgets & alerts → Create budget:** $10 a month, alerts at 50%, 90% and 100% to your email.
6. Optional cap: **APIs & Services → Places API (New) → Quotas** → "Autocomplete requests per day" →
   e.g. 3,000 (a hard stop for the whole app).
7. **Supabase → Project Settings → Edge Functions → Secrets → Add new secret:** name
   `GOOGLE_PLACES_API_KEY`, value: the key. Save. (No redeploy needed for a new secret.)
