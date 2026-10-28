# A Places space, and Wilma's spaces on Home (D45)

Status: **plan, 2026-10-28, waiting for the owner's answers** (Q1-Q8 below). Raised by the owner
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

## How it would work (recommended answers)

- **The Places space** (built-in `places`): made for every account, like Recipes (an existing
  top-level space named "Places" is adopted, as Recipes adopted an existing "Recipes"; Denisse's
  becomes the built-in one, her notes in it included). It can't be deleted, renamed, moved or
  restricted, like the other built-in spaces. Sub-spaces are allowed (Places/Restaurants,
  Places/Kids).
- **A note in Places is a place:** New note opened from Places starts as a 📍 Place; a plain note
  saved there (by the app, the chat or the Claude connector) is kept as a place of kind "other",
  so it is never invisible again. Places saved elsewhere before today stay where they are and still
  count (Q2).
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

## Questions (recommendation first)

- **Q1. A built-in Places space:** **yes, for every account; an existing top-level "Places" is
  adopted** (rec.); or only for new accounts.
- **Q2. Places saved in other spaces today** (testers have Restaurants spaces): **leave them where
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
3. **App (smaller model), mockups first.** The picker (homes, every place, look up on pick), New
   note in Places, the place form's kinds and eatery-only fields, Home's "Your spaces" row; app
   tests. **Owner:** pick the mockup, merge, OK to build.
4. **Phone checklist.** Denisse's case first: a place in Places, with an address only, picked for a
   task.

**Right away, before any of this (no build):** Denisse can open her place, tap Edit, choose the
📍 Place kind if it is a plain note, and add a Google Maps link (Share → Copy link in Google Maps)
or tap Save where I am while there; it then shows in the picker.
