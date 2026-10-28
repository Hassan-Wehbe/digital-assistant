# A Places space, and Wilma's spaces on Home (D45)

Status: plan, 2026-10-28. **Owner's answers (2026-10-28): Q1 yes, an existing "Places" space becomes
the built-in one; Q2 every note marked as a place moves into Places; Q3-Q9 all as recommended ("I
want to see it in action").** **Step 1 built 2026-10-28, branch `claude/places-step1`, not merged,
migration not applied:** see "As built: step 1". Raised by the owner
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

## As built: step 1 (2026-10-28)

Branch `claude/places-step1`. **Migration `20261028120000_places_builtin_space.sql`, not applied.**

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

**Owner:** dry run, OK to apply. **Next:** step 2, the server.
