# Home clean-up and favourite spaces

Status: plan, 2026-10-18. **Owner's decisions given the same day** (after the mockups): Home shows
the owner's **favourite** spaces, with a way to choose them; the order is this clean-up first, then
routines (D39), then the date night and family day planners (D40) with a Vacation placeholder, then
the rest of D30. Design: D38. Model: the strongest for step 1 (a new table, RLS, restricted spaces);
a smaller one is fine for step 2 (app layout) and step 3 (checklist and build).

Mockups: the owner's private canvas "Wilma Home and Planners" (screens 1 and 2 for this plan;
3-7 are for D39 and D40).

## Why

Tester and owner feedback: the spaces part of Home is too overwhelming. Today Home lists the five
spaces opened most recently on this phone, each with its description, then "See all spaces".
Five tiles sit under the box (Chat, Save here, Vault, Tasks, My day). There is no place yet for the
planners the owner wants (date night, family day, later vacation).

## What the owner will see

**Home, top to bottom:**

1. The Wilma box, as today (＋, mic, Send).
2. Four tiles: **Chat**, **My day** (PRO badge as today), **Tasks**, **Vault**. **Save here** moves
   into the ＋ menu as "📍 Save where I am" (it still reads the location only after that tap).
3. The welcome, memory and morning cards, as today (the morning card unchanged in this step).
4. **Plan with Wilma**: My day, and three placeholders marked **Soon**: Date night, Family day,
   Vacation. Tapping a placeholder shows one line ("Coming soon. For now, ask Wilma: 'plan a date
   night Friday'.") and makes no AI request.
5. **Favourites**: up to **6** favourite spaces in a 3-column grid (a coloured initial and the
   name, no descriptions), then **All spaces (N) ›**.
   - No favourites yet: the spaces opened most recently, as today, with one line: "Tap ☆ on a space
     to keep it here."

**Choosing favourites:**

- A **☆ / ★ Favourite** button on each space's screen (top bar).
- **All spaces** screen: a **Favourites** section with **Edit** (remove, move up or down), then all
  other spaces as compact chips, then **Locked** spaces at the bottom (restricted, each with
  Unlock; never a count of what is inside).
- Not in the chat in this plan (no tool change). "Wilma, make Recipes a favourite" can come later
  with one small tool and an evaluation run.

## Rules check

- **Restricted spaces never become favourites** (rule 3: Home never hints at them). The database
  refuses a restricted space, and a space nested anywhere under a restricted one. If a favourite is
  later restricted or moved under a restricted space, it simply stops being shown and is dropped
  (the list is read through `searchable_space_ids()`).
- **The built-in Tasks space is not a favourite** (the Tasks tile is the way to tasks).
- **Every row is owned** (rule 5): RLS, own rows only; `anon` gets nothing; `authenticated` may read
  its own rows, and changes go only through one function, so a stray write can never favourite
  someone else's space or a restricted one.
- No secrets, no search, no embeddings touched (rules 1, 2, 4). No AI cost. No Mapbox calls.
- Privacy page and Play Data safety: **no change** (a favourite is a preference about the user's
  own spaces, kept with the spaces themselves).

## Steps

1. **Server: favourites (strongest model).** Migration `space_favourite` (user, space, position
   1-6, cascade with the space or account), RLS own rows, `set_favourite_spaces(uuid[])` replaces the
   whole ordered list in one call (refuses restricted, nested-under-restricted, Tasks, someone
   else's space, duplicates, more than 6), `my_favourite_spaces()` returns the ids in order, only
   those still searchable. SQL test (two users, restricted, nested, Tasks, limit, cascade) and a dry
   run for the owner. No `mcp` or `chat` change, no evaluation run. **Owner:** run the dry run,
   then OK to apply.
2. **App: the new Home and All spaces (smaller model is fine).** The layout above; ☆ on the space
   screen; Edit on All spaces; Save here into the ＋ menu; Plan with Wilma with the placeholders.
   App tests for the Home lists (favourites first, fallback to recent, never restricted or Tasks).
   Ships with the next build after versionCode 20.
3. **Checklist and build.** Phone checks in the build's checklist; Help topic text updated if a
   topic mentions "Save here" or "See all spaces".

## Not in this plan

- Routines (weekly and monthly task groups): D39, its own plan, next.
- The date night and family day planners: D40, after routines. Vacation stays a placeholder.
- Pinning or favourites synced from the chat; colours or icons per space.
