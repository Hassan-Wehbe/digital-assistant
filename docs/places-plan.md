# Places: notes with a location (plan)

Status: **approved by the owner (2026-10-06): Q1-Q8 all as recommended; extended the same day**
("Extension: richer places" below: cuisine, price, occasions, dishes, visits, "save where I am"
and coordinates; Q2 changed). Step 2 (server) is live (2026-10-06: #93, #94, #95; migration place_search, `mcp` v12, `chat` v5, evaluation 67/67). Steps 3, 4, 5a and 5c merged (app parts not built). **Step 5b ("places near me", server) live,
2026-10-06** (#104, `mcp` v13, `chat` v6, evaluation 71/72, 0 leaks): the `find_places` tool, no
migration; see "Near me" below. Next: step 6 (the places build). Comes **before
the company account and before the day planner** (owner, 2026-10-06). Asked by the
owner 2026-10-06: "a note type that allows adding a location, for example for restaurants or
places to visit". Design entry: `docs/design.md` D26. Comes **after A5e** (voice) unless the owner
says otherwise (Q8). Later feeds the day planner (D25, "saved places").

**Which model builds this:** the strongest one for steps 2 and 3 (a change to `save_item` /
`update_item`, the assistant's instructions and the evaluation, and a new form in the app); a
smaller one (Sonnet) for this plan's edits, step 5 (checklist, build, handoff) and docs.

## What the owner will see

1. **Saving a place.** Three ways, all ending in the same kind of note, a **place**:
   - Tell Wilma: "save Tawlet in Mar Mikhael as a restaurant to try" (box or chat). Wilma saves a
     place note in the right space (e.g. *Restaurants*).
   - **New note → Place**: a name, an address (typed or pasted), an optional Google Maps link,
     what kind of place it is (restaurant, café, to visit, ...) and a note ("try the fattoush").
   - **Share from Google Maps** to Wilma (the share sheet you already use for photos and text):
     the place's name and link arrive in a place form, ready to save.
2. **Opening a place.** The note shows the address and an **Open in Maps** button (Google Maps on
   the phone, or the web page in a browser), for directions or to see where it is.
3. **Want to go / been there.** A place is "want to go" until you mark it "been there", with an
   optional rating and a line about the visit. Asking "which restaurants haven't I tried yet?"
   lists the "want to go" ones.
4. **Finding places** works like every note: "restaurants in Beirut", "places to visit in
   Lisbon", "that sushi place" (search reads the name, address, kind and note).
5. **Not in the first version** (Q2): "near me", a map with pins, and "use where I am now".
   Those need the phone's location or a paid map service; they come later, with the day planner.

## Extension: richer places (owner, 2026-10-06)

The owner's example: "I go to a restaurant, I like it, I store the name, the location and the type
of food, so a day planner or a **date planner** can use it later." So a place records what Wilma
needs to *recommend* it, not only to find it:

- **Facts:** name, address, map position (when known), kind, **cuisine** (one or more, e.g.
  Italian, Lebanese, sushi), **price level** ($ to $$$$).
- **The owner's opinion:** rating, **dishes liked** ("carbonara", "fattoush"), **would go back**
  (yes/no), **occasions** (date night, with kids, business lunch, quick lunch, group, special
  occasion) and the note.
- **Visits:** "we went again last Friday with Sarah" adds a visit (date, who with, a line), so
  Wilma knows what has not been done in a while. The latest visit sets `been` and `visited_on`.
- **Ways to save** (in addition to telling Wilma, New note → Place and sharing from Google Maps):
  **"Save where I am"** (one tap at the table: the phone's current location, asked only on that
  tap, then "what's this place?") and a **photo** of the storefront or menu as an attachment
  (attachments already exist).
- **What it unlocks:** questions now ("Italian places we liked for date night", "where haven't we
  been in a while?", "a good business lunch place downtown", "places near here" once coordinates
  exist, by plain distance, no map service); later, with the day planner and the company's Google
  setup: live opening hours, travel times with traffic, and the **date planner** ("plan a date
  night Friday": a favourite tagged date night, not visited recently, open, timed around traffic).
- **Live details are fetched, not stored:** opening hours change, so the planner checks them when
  planning. Google's Maps terms generally allow keeping a place's Google ID but limit storing
  other Google content; Wilma keeps the ID (when known) plus the owner's own notes.

## How it works

- **No new table, probably no migration** (see Search below). An item already has a free `item_type` and a `metadata` field
  (`db/schema.sql:77,81`). A place is `item_type = 'place'` with these metadata fields (all
  optional except the name, which is the title):

  | field | example | notes |
  |---|---|---|
  | `address` | "Armenia St, Mar Mikhael, Beirut" | free text, as typed or shared |
  | `maps_url` | `https://maps.app.goo.gl/...` | only Google Maps / `geo:` links accepted |
  | `kind` | `restaurant` | restaurant, cafe, bar, shop, to-visit, hotel, other |
  | `status` | `want` | `want` (default) or `been` |
  | `rating` | 4 | 1-5, only when `been` |
  | `visited_on` | 2026-10-12 | optional; the latest visit |
  | `cuisine` | `["italian"]` | list, short free words, lower case |
  | `price_level` | 2 | 1-4 ($ to $$$$) |
  | `dishes_liked` | `["carbonara"]` | list, short |
  | `would_return` | true | optional |
  | `occasions` | `["date_night"]` | from a fixed list: date_night, kids, business, quick_lunch, group, special |
  | `visits` | `[{"on":"2026-10-12","with":"Sarah","note":"anniversary"}]` | newest first, at most 50 |
  | `lat`, `lng` | 28.54, -81.38 | only from "save where I am" (or later a map service) |
  | `google_place_id` | | later, with the company's Google setup; the only Google data kept |

  Coordinates are stored only when the owner taps **Save where I am** (Q2, changed).
- **The server checks place fields** (rule 9 spirit: the server, not the model, enforces the
  shape). `save_item` / `update_item` validate `place` metadata (known fields, lengths, link
  domains, rating range) and the credential check already covers every metadata value, so "the
  door code is 1234" in a place note is still refused.
- **Search:** today only the title, summary and body are searched (`itemText` in
  `supabase/functions/mcp/lib/chunk.ts:16`; metadata is not). Step 2 adds a place's address,
  kind and status to that text so ordinary search finds them (**to check:** whether the keyword
  half of `search_items` reads the same text or only the item's columns; if only the columns, a
  migration is needed after all). Restricted spaces stay out, as for every item (rule 3).
- **Open in Maps** builds a Google Maps search link from the address (or uses the saved link):
  `https://www.google.com/maps/search/?api=1&query=<address>` is a public link format that needs
  no API key and costs nothing. The app already may open https links (its manifest has that
  `<queries>` entry).
- **Share from Google Maps:** the share arrives as text. **Checked on the owner's phone
  (2026-10-06):** the text is only the short link (`https://maps.app.goo.gl/...`), with the
  place's name as the title; no address. The app also reads "Name / address / link" lines, which
  other versions send. `shareIntake` recognises a Maps link
  and opens the place form instead of the plain note form. The short link is kept as is: Wilma
  does not follow it to Google to find the address (that would be a call to Google from our
  server; Q3).
- **Wilma (chat and the Claude connector):** the shared instructions
  (`supabase/functions/_shared/assistant_prompt.ts`) learn the place type, and the evaluation gets
  cases: save a restaurant, mark it been with a rating, list "want to go" places, and a trap (a
  place note with a door or Wi-Fi code must be refused and pointed to the vault).
- **Privacy:** the app reads the phone's location **only when the owner taps Save where I am**
  (foreground, one reading, never in the background), and stores it in that place note only. This
  needs the location permission (`ACCESS_FINE_LOCATION`, asked on that first tap), a privacy page
  change and a Play Data safety change ("precise location, optional, stored with your note"),
  each approved by the owner, like the microphone in A5e. Steps 2-4 need none of this; step 5 does.
- **Near me (once coordinates exist):** distance is computed on the server from stored
  coordinates (plain math, no map service, no cost); places without coordinates are listed by
  address. Restricted spaces stay out (rule 3).
  **As built (step 5b):** a separate read-only tool, `find_places`
  (`supabase/functions/mcp/tools/find_places.ts`), rather than a parameter on `search_items`:
  `search_items` ranks by how well the words match and returns at most 50, so sorting its results
  by distance would miss places, and changing its SQL would need another migration. `find_places`
  reads the user's places in searchable spaces (the same `searchable_space_ids()` rule as search,
  then checked again in the code), measures the straight-line ("as the crow flies") distance with
  the haversine formula (`distanceKm` in `mcp/lib/places.ts`) and sorts nearest first. The point
  is `lat`/`lng` the user gave or `near_place`, a saved place with a location (a restricted place
  is "not found"). Filters: space, kind, status, cuisine, occasion, `within_km`. Places without a
  location are only counted, or listed by address with `include_without_location`, never with a
  distance. **No migration.** **Where "here" comes from in chat:** the chat does not know the
  phone's location in this step; for "near me" Wilma asks which saved place the user is near, or
  for a map link with coordinates (owner's question below: should the app send the location?).

## Steps (each a small PR; the owner approves merges, builds and deploys)

1. **Plan** (#84). ~~Owner answers Q1-Q8.~~ Done 2026-10-06, all as recommended.
2. **Server:** place metadata validation in `save_item` / `update_item` (Deno tests), place
   fields in the chunk text, the instructions, evaluation cases (a paid run with the owner's OK),
   then deploy `mcp` and `chat` (the owner approves the deploy). Strongest model.
3. **App:** a Place choice on New note and Edit note, the place view with **Open in Maps**,
   Want to go / Been there with rating, and the kind shown in lists. Tests: link building,
   metadata round trip, the form refuses a non-Maps link. Strongest model. **Merged (#97),
   not built**: ships in the step 6 build; its phone checks go in that checklist.
4. **Share from Google Maps** into the place form (checked: the short link, the name as title). Strongest model (touches the share intake).
5. **Save where I am** (5a app, merged; 5b `find_places`, server, live; 5c privacy, live):
   the location permission (asked on the tap only), one reading, the place
   form with coordinates, `find_places` near a point (server-side distance), privacy page and
   Data safety wording for the owner's approval. Strongest model (permission and privacy).
6. **Ship:** phone checklist (`docs/places-phone-checklist.md`), handoff, "build for Play".
   **Built as versionCode 10 (2026-10-06, from `main` at 537fff2, run 37540216475),
   submitted to internal testing.** Next: the owner runs the phone checklist.
   Sonnet. **This build also carries the mic fix #91** (merged 2026-10-06, held for this build
   by the owner): the phone checklist must include "The first tap" and "Dictating" from
   `docs/phase5-a5e-phone-checklist.md`.
7. **"Near me" in the chat** (Q9, after step 6): a 📍 tap in the chat reads the phone's location
   once (the Save where I am permission, asked only on that tap) and sends it with that one
   message; `chat` passes it to Wilma for `find_places` and never stores or logs it. Needs: the
   app tap, a small `chat` change (the point travels with the message only), Wilma's instructions,
   evaluation cases (a paid run with the owner's OK), one sentence on the privacy page and a check
   of the Data safety answer (owner approves both), then a deploy and the next build. Strongest
   model (location, privacy and the chat loop).
   **Split into small PRs (plan 2026-10-06):**
   - **7a, server** (this PR): `chat` accepts an optional `"here": {"lat", "lng"}` with the
     messages (numbers in range, nothing else in it, else 400 before any model call). It becomes
     one line at the end of that request's instructions (`hereLine` in
     `_shared/assistant_prompt.ts`), never part of the conversation, so the next message does not
     have it. Not stored, not in the log line (codes, ids, counts only), and a classifier body
     carrying a point is refused. Wilma's instructions (`mcp/lib/assistant.ts`, `mcp` 0.7.1): with a
     shared point, "near me / near here" calls `find_places` with exactly it; without one she asks
     (a saved place, or tap 📍 in the app). She does not save the point into a note: saving where
     you are stays **Save where I am**. 4 evaluation cases (a shared point, a restricted bar next
     door, the point not stored, a door-code trap); the case without a point already exists.
     Deno tests. **Evaluation** (owner's OK, 2026-10-06): run 37541617963, Luna, **76/76, 0 leaks,
     0 unsafe**, $0.03. Then a `chat` + `mcp` deploy (owner's OK).
     Deploying first is safe: today's app never sends `here`.
   - **7b, app:** a 📍 button by the chat box. Tap → `whereAmI` (`app/src/lib/location.ts`, the
     same permission as Save where I am, asked only on that tap) → the button shows "📍 location
     on" for the next message; Send carries `here` with that one message, then it is cleared. The
     point is never written to the saved thread (`chatStore`). Refused or off: the same plain
     sentences as Save where I am. Chat only, not the home box (Q10, owner 2026-10-06).
   - **7c, privacy:** one sentence on the privacy page and a check of the Data safety answer
     (`docs/phase4-play-release.md`); the owner approves both before anything is published.
   - **7d, ship:** phone checklist lines, then the next build (owner says "build for Play").

Step 2 covers the extension's fields too (validation of cuisine, price, occasions, dishes,
visits; "add a visit" through `update_item`; evaluation cases such as "Italian date-night places
we liked", "where haven't we been since summer?", and a door code in a visit note, refused).
Step 3 shows them (cuisine chips, price, occasions, dishes, **We went again** adding a visit).

8. **Place cards and asking for the location** (owner's testing, 2026-10-07; Q11-Q14 decided).
   - **Place cards in the chat:** when Wilma's answer is about saved places, cards appear under it:
     name, kind and cuisine, "about N miles" when known, **Open in Maps** (the saved link, else the
     coordinates, else an address search) and **Open note**. Wilma picks which places get a card,
     at most 5 (Q13), through a chat-only action; the server checks each card is the user's own
     place in a searchable space (never a restricted one, rule 3) before the app sees it.
   - **Asking for the location:** for "near me / nearby" without a 📍 point, Wilma's reply comes with
     a **📍 Share where I am** card (Q11). A tap reads the location once (the same permission, asked
     only on a tap) and sends the question again with the point (step 7). The privacy promise is
     unchanged: the location is read only on a tap. The Claude connector has no such card; there
     Wilma still asks which saved place.
   - **Radius:** "nearby" without a distance means within **10 miles** (about 16 km; Q12), nearest
     first; if nothing is that close, Wilma says so and offers the nearest. Places without a
     location are mentioned by address only, never with a distance.
   - **Units:** distances in **miles by default**, with a setting to use km (Q14). One account
     setting read by the server, so Wilma's replies, the cards and "nearby" all agree.
   - **Coordinates from a Google Maps link** (Q15, owner 2026-10-07, after testing: "sushi near me"
     found nothing because both saved places came from a Maps share, link only, no coordinates).
     When a place is saved or edited with a short Maps link (`maps.app.goo.gl`, `goo.gl/maps`),
     the **server** follows that link once, reads the coordinates from the Google Maps address it
     leads to (`@lat,lng` or `!3d…!4d…`), and stores them as the place's `lat`/`lng` (never
     overwriting a location the user set). A one-off pass does the same for places already saved.
     Safety: only those two hosts, https only, at most 5 redirects and every hop must stay on a
     Google Maps host (`google.com/maps`, `maps.google.com`, `maps.app.goo.gl`), a 5-second limit,
     no cookies, the page body is never read or stored; failures leave the place as it is.
     Privacy: one sentence on the privacy page (owner approves): "When you save a place with a
     Google Maps link, Wilma's server opens that link once to read the place's location."
     Data safety unchanged (location stored with the note, already declared). Revises Q3 (which
     kept the link without following it).
     **As built (part 1, in PRs, 2026-10-07):** #124 (`mcp/lib/maps_link.ts`, used by `save_item`
     and `update_item`; also reads coordinates from a long link or a `geo:` link with no request;
     Google's EU consent page is read for its `continue=` address, never requested; country Google
     domains are refused as hops because they cannot be listed strictly; a location the user
     removed is not put back from the same link), #125 (the one-off pass: admin function
     `place-locations`, dry run first, counts only, deleted after), #126 (privacy wording).
     **First live try (2026-10-07):** the owner's app edit logged `no_coordinates` after 2
     requests, last status 200 (#129 added a codes-only log line): Google's current share links
     lead to a place page whose address names the place by id, with no coordinates. **Owner's
     choice (a), 2026-10-07:** read that last page, only when it is an HTML page on a Google Maps
     host, at most 1 MB within the same 5 s, for the coordinates only (in order: the pin
     `!3d!4d`, the preview image `center=lat,lng`, a `/@lat,lng,` address, the map's starting
     view), then drop it; the log line says which pattern matched and how many bytes were read.
     Alternatives turned down: (b) no link following (locations only from Use where I am now or a
     long link), (c) a paid address lookup (shared places have no address).
     **Result of (a), 2026-10-07: wrong, so withdrawn.** `mcp` v18 read the page and found only
     the preview image's centre (`found: page_image`), which put Hinode Sushi (Oviedo, Florida)
     about 800 miles away, in northern Virginia: the page Google sends a server does not hold the
     place's pin. The wrong location was cleared (history kept). **Owner's decision: (b).** The
     server no longer opens any link: only coordinates written in a long Maps link or a `geo:`
     link are read (`mcp` 0.8.5); short share links are kept as they are. A shared place gets its
     location from **Use where I am now**, or by pasting a long Google Maps link (from a
     computer's browser address bar). The one-off `place-locations` function and its code are
     removed; the privacy sentence (#126) was closed unpublished. Q3 stands again: short links are
     not followed.
   - **Honest "nothing near" answers** (Q16, same testing): when matching places have no saved
     location, Wilma names them ("Hinode Sushi might be near, but it has no saved location") and
     offers Open in Maps or to add the location, instead of "nothing close by".
   - **Location by name from an open map** (Q17, owner 2026-10-07, after Q15 (b)): when a place
     arrives from a Google Maps share with no coordinates, Wilma looks its name up in
     OpenStreetMap's place search near where the phone is (or near the user's other places), and
     shows a card "Is this it? <name>, <address>" with Yes / Not this one. Only a Yes stores the
     location; Not this one keeps the place as it is (Use where I am now or a long link still
     work). Free, no Google account, and the result may be stored (OpenStreetMap's licence; credit
     shown on the card). Sent: the place's name and a rough area, nothing else; one new privacy
     sentence (owner approves). Search service and its usage rules (a named app, at most one
     request a second) to be chosen when the step is built. If too many places are not found,
     Google's Places search is the upgrade (paid account; coordinates may be kept only 30 days).
   - **Part 2 build plan (owner, 2026-10-07: all as recommended).** Strongest model for each PR
     except the checklist. In order:
     1. **Server + migration: units, radius, honest answers (Q12, Q14, Q16).** Migration
        `app_user.distance_unit text not null default 'mi' check (in ('mi','km'))`, column grants
        to `authenticated` only, SQL test. `mcp/lib/assistant.ts` loads name and unit (default
        `mi`); `distanceUnit` in `ToolContext` (mcp, chat, eval world). `find_places`: `distance`
        + `unit`, input `within` + `unit` (`within_km` kept as an alias), default 10 mi (16.1 km),
        `nearest_outside` when nothing is within, always `without_location` (at most 10: title,
        space, address, never a distance; searchable spaces only). Instructions: the user's unit,
        nearby = 10 mi, say so and offer the nearest, name places with no location and offer to
        add one; fix "tap 📍" to "＋ → 📍 Send where I am". Eval cases: default radius (a place
        about 20 miles away added to the world), nothing within offers nearest, names unlocated,
        miles, km; update the step 5b/7 cases. Owner applies the migration.
        **As built (PR 1):** migration `20261008120000_distance_unit.sql` (dry run on the live
        database: 9/9 checks, rolled back; `tests/sql/12_distance_unit.sql`). `loadUserSettings`
        reads the name and the unit and, if the unit column cannot be read (migration not yet
        applied), still reads the name. `find_places` returns `within`, `results[].distance` +
        `unit`, `nearest_outside`, `without_location` (≤10, then `without_location_more`); the
        `include_without_location` input is gone. `mcp` 0.9.0. Eval cases: `place-nearby-default-
        radius`, `place-nothing-within-offers-nearest`, `place-near-names-unlocated`,
        `place-distance-in-miles`, `place-distance-in-km` (77 cases). The step 5b/7 cases needed no
        change. Deploy waits for PR 2 (one evaluation run, one deploy).
     2. **Server: chat-only actions (Q11, Q13)** in a new `chat/actions.ts` shared with
        `tests/eval/harness.ts` (the Claude connector never sees them): `show_places({item_ids
        ≤5, near_place_id?})` checks each id as the user (place, not deleted, searchable space;
        the same "not found" for any failure, rule 3) and emits `{"type":"places","cards":[...]}`
        with distances computed by the server from this message's point or `near_place_id`,
        never from the model; `ask_for_location()` emits `{"type":"location_request"}` only
        without a point. Instructions for them in `systemPrompt` (chat only). Logs: action names
        only. Eval cases: cards for an answer, never a restricted place, near me asks for the
        location, at most 5, no ask when a point is there. **One paid evaluation run and one
        deploy (`mcp` + `chat`) for PRs 1 and 2 together** (owner's OK).
        **As built (PR 2):** `chat/actions.ts` (`ACTION_SPECS`, `ChatActions`, one per message),
        used by `chat.ts` and `tests/eval/harness.ts`; the MCP tool list is unchanged (the
        connector's `tools/list` test still lists exactly 24 tools). Ids are checked by
        `visiblePlaces` in `mcp/lib/places.ts`, next to `placeScope` (the searchable-spaces check
        moved there from `find_places`; `inUnit` and `KM_PER_MILE` too, so a card and
        `find_places` give the same number). Any refused id (restricted, someone else's, deleted,
        not a place, unknown) gets the same "not found"; ids already shown are skipped; at most 5
        cards per message, further ones refused with a note to the model. Card distance: from
        `near_place_id` when given (none if that place has no location), else this message's
        `here`, else none; anything the model passes is ignored. `ask_for_location` with `here`
        emits nothing and tells the model to use the point; asked twice, one card. Instructions:
        `CHAT_ACTIONS` in `_shared/assistant_prompt.ts`. Log: action names only. `mcp` 0.9.1
        (refactor only, no behaviour change). Eval cases: `place-cards-for-an-answer`,
        `place-cards-never-restricted`, `place-near-me-asks-location`, `place-cards-at-most-five`,
        `place-no-ask-when-shared` (91 cases, 22 traps).
     3. **App: Distances Miles / km** on Settings (`lib/units.ts`, reads and updates
        `app_user.distance_unit`).
        **As built (PR 3):** Settings → **Distances**: Miles / Kilometres rows (✓ on the chosen
        one, read out as radio buttons; `GroupRow` gained `checked`). A tap saves at once as the
        user (`saveDistanceUnit`: counts only when the database returns the new value); a failed
        save puts the old choice back and says "That wasn't saved". Unreadable (offline): "Your
        setting cannot be read right now", rows not tappable. Miles when nothing usable is stored.
        `distanceText` ("about 0.5 miles", "about 1 mile", "about 0.8 km") is ready for PR 4's cards.
        No server change (the column and its grants came with PR 1). Ships with the next Play build.
     4. **App: the cards** on the ChatCard shell: place card (📍, name, kind and cuisine, "about
        N miles", Open in Maps via `mapsLink`, Open note) and the Share where I am card (Not now /
        📍 Share where I am: one reading on the tap, then the last question again with the
        point). Older app versions drop unknown events safely; Wilma's text names the places
        anyway. The saved thread keeps no distances or coordinates.
        **As built (PR 4):** `chatStream.ts` reads `places` (each card copied field by field, at
        most 5, a position or distance only when valid) and `location_request`. The thread gets a
        `places` entry (📍 card: name; kind and cuisine with "about N miles" from `distanceText`;
        address; Open in Maps via `mapsLink`, Google Maps or `geo:` links only; Open note) and a
        `location` entry (Not now / 📍 Share where I am, once per answer, holding the question it
        answers). The tap (`shareFromCard` in `chatHere.ts`): one reading with `whereAmI` (the
        permission asked only then), then that question goes to Wilma again with the point, for
        that message only; refused or location off: the reason on the card, nothing sent; a message
        sent meanwhile wins (the card becomes "Location not shared"). Saved thread
        (`chatStore.ts`): place cards keep name, kind, cuisine, address and Maps link only, never a
        position or distance; a 📍 card keeps its question and state. Ships with the next Play build.
     5. **Docs and privacy for Q17:** privacy sentence (owner approves): "When you tap *Find on
        the map* on a place, Wilma's server sends the place's name and your approximate area (to
        about 10 km) to OpenStreetMap's search service (Nominatim, run by the OpenStreetMap
        Foundation). Nothing else about you is sent, and a location is saved only if you confirm
        it." OpenStreetMap in the list of services; the Data safety question in
        `docs/legal-review-checklist.md`.
     6. **Server: the lookup** as a `{"place_lookup": {...}}` body of `chat` (like `classify`):
        Nominatim, one identifying User-Agent (`NOMINATIM_CONTACT` in Supabase secrets, name in
        `.env.example`), a tap only, at most 1 request a second, 5 s, up to 3 candidates, the
        credit "© OpenStreetMap contributors". Sent: the name (≤100 characters) and the area:
        the phone's location rounded to 1 decimal (about 10 km) on that tap, else a typed city;
        the server rounds again. No model change, no evaluation run; deploy `chat` (owner's OK).
     7. **App: 🔎 Find on the map** in `PlaceFields` (share form, New and Edit note) and on a
        place note without a location: "Is this it? <name>, <address>", Yes / Not this one; only
        Yes saves the location, marked `location_source: "osm"` (small `normalizePlace` change).
     **PRs 5-7 on hold (owner, 2026-10-07): skip the lookup for now.** The coverage check failed:
     the owner could not find Hinode Sushi or Lemongrass Thai Kitchen (Oviedo, FL) on
     openstreetmap.org, and Photon would not help (it searches the same OpenStreetMap data). So no
     new outside service and no privacy change: a shared place gets its location as before (Use
     where I am now at the place, or a long Maps link with coordinates). PR 5's draft (#148, the
     privacy sentence the owner approved) is closed unmerged; its branch
     `places-part2-pr5-osm-privacy` keeps the text. Revisit with the day planner, when the company
     Google account exists (Google's place search, Q17's upgrade, or OpenStreetMap if coverage
     improves).
     8. **Phone checklist** (Sonnet), then the Play build carrying the UI tidy-up and places.
        **As built:** `docs/versioncode12-phone-checklist.md`, one list with the UI tidy-up's and
        the owner's parked to-dos (it also replaces the unrecorded versionCode 10 and 11 lists).
     Decided with it: distances on cards only from a shared point or a named place; no
     distances or coordinates in the saved thread; the lookup runs on the server; Nominatim;
     the area from a rounded tap or a typed city; `location_source` stored; no lookup from the
     chat for now (Open note leads to the button); the unit changes on Settings only, not by
     chat; nearby is 16 km for km users. **Before PR 6: the coverage check** (does
     OpenStreetMap know Hinode Sushi and Lemongrass Thai Kitchen near Oviedo, FL?): this
     sandbox's network blocks `nominatim.openstreetmap.org`, so the owner checks on
     openstreetmap.org or allows the host in the environment's network settings. If they are
     missing, Photon or Google's Places search (Q17's upgrade) is the fallback to decide then.

Later, not in this plan: a map with pins, live opening hours and travel times (Google, with the
company account and the day planner), the **date planner**, geocoding typed addresses, reminders when near a saved place, places in the day planner's
travel times (D25 step 3), sharing a list of places with family (item sharing, D-roadmap).

## Decisions

**Owner's answers (2026-10-06): all as recommended,** then **Q2 changed the same day**: coordinates
from **Save where I am** are in (step 5), with the location permission asked only on that tap; no
geocoding service and no background location. Original answers: Q1 a real `place` type; Q2 no coordinates
or "near me" now; Q3 short Maps links kept, not followed; Q4 a short fixed list of kinds; Q5 want to
go / been there with a 1-5 rating; Q6 in the spaces you choose; Q7 share from Google Maps as step 4;
Q8 after A5e.

- **Q1. A new type, or a template on a normal note?** *Recommend:* **a real type** (`place`, with
  fields), so "want to go" lists, ratings and Open in Maps work reliably, and the day planner can
  use them later. Alternative: a normal note with the address in the text (nothing to build, but
  no lists or buttons).
- **Q2. Coordinates and "near me" now?** *Recommend:* **not now.** Store the address and the Maps
  link only. Coordinates need either the phone's location (a new permission, privacy and Play
  changes) or a geocoding service (sends the address to Google or another company, costs money
  past a free tier). Revisit with the day planner, which needs a map service anyway.
  Alternative: add "use where I am now" (location permission, asked only on that tap).
- **Q3. Expand Google Maps short links?** *Recommend:* **no** in the first version: keep the link,
  ask for the address in the form (or let the person paste it). Following the link means our
  server calls Google with it. Alternative: the server follows the redirect once to read the
  name and coordinates (more automatic; a Google request per shared place).
- **Q4. Kinds of place:** *Recommend:* a short fixed list (restaurant, café, bar, shop, to visit,
  hotel, other), so lists and filters stay clean. Alternative: free text.
- **Q5. Want to go / been there, with a rating?** *Recommend:* **yes**, `status` plus an optional
  1-5 rating and visit date. Alternative: no status (simpler; no "haven't tried yet" list).
- **Q6. Where do places live?** *Recommend:* in the spaces you choose, like every note (e.g. a
  *Restaurants* space, or *Trips/Lisbon*); Wilma suggests the space. Alternative: one fixed
  "Places" space.
- **Q7. Share from Google Maps in the first version?** *Recommend:* **yes, as step 4**: it is the
  fastest way to save a place you are looking at. Alternative: later.
- **Q8. When?** *Recommend:* **after A5e** (voice), which is half done; then this before the day
  planner. Alternative: pause A5e after step 3 and do places first.

## What the owner does

- ~~Answer Q1-Q8.~~ Done 2026-10-06, all as recommended.
- Approve the merges, the server deploy (step 2), the evaluation run and the Play build.
- On the phone: check what Google Maps shares (step 4), then run the phone checklist.
- **Step 5b:** done (evaluation, merge and deploy approved 2026-10-06).
  **Q9, decided (owner, 2026-10-06: as recommended):** should "near me" in the chat use the
  phone's location? **Yes, later, as a small app step (step 7):** a "📍 near me" tap in the chat reads the location once (the same
  permission as Save where I am, asked only on that tap) and sends it with that one message; it
  is never stored or kept. The privacy page would need one more sentence (owner approves).
  Until then Wilma asks which saved place you are near.
- **Q10, decided (owner, 2026-10-06: chat only, as recommended):** should the **home box** get the 📍 button too, or only the chat?
  *Recommend:* **chat only, for now.** The home box first asks the classifier whether a short
  message is a search; with a point attached the app would have to skip that and go straight to
  Wilma, which is a second path to build and test. In the chat the point simply rides with the
  message. Alternative: both (the home box sends a 📍 message straight to the chat).
- **Q11-Q14, decided (owner, 2026-10-07, step 8):** Q11 Wilma asks for the location with a
  "📍 Share where I am" card (not by reading it automatically on "near me"); Q12 "nearby" means
  within 10 miles; Q13 Wilma picks which places get a card (at most 5); Q14 distances in miles by
  default, with a setting for km.
- **Q15, decided (owner, 2026-10-07, step 8):** places saved from a Google Maps short link get
  their coordinates by the server following that link once (option A; option B, geocoding the
  address through a paid service, stays for the day planner). Revises Q3. Existing places get a
  one-off pass. **Q16:** Wilma names matching places that have no location instead of saying
  nothing is near.
- **Q17, decided (owner, 2026-10-07, step 8):** a place shared from Google Maps gets its location
  from a name lookup in OpenStreetMap near the user, confirmed by the user on a card (option 1 of
  five: also considered Google's Places search, the phone opening the short link, sharing from
  another maps app, and a one-off Google Takeout import). Short links are still not followed (Q3).
