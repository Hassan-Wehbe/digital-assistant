# Places: notes with a location (plan)

Status: **approved by the owner (2026-10-06): Q1-Q8 all as recommended; extended the same day**
("Extension: richer places" below: cuisine, price, occasions, dishes, visits, "save where I am"
and coordinates; Q2 changed). Step 2 (server) is live (2026-10-06: #93, #94, #95; migration place_search, `mcp` v12, `chat` v5, evaluation 67/67). Next: step 3 (app). Comes **before
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
- **Share from Google Maps:** the share arrives as text (usually the place name and a short
  `maps.app.goo.gl` link; **to check** on the owner's phone). `shareIntake` recognises a Maps link
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

## Steps (each a small PR; the owner approves merges, builds and deploys)

1. **Plan** (#84). ~~Owner answers Q1-Q8.~~ Done 2026-10-06, all as recommended.
2. **Server:** place metadata validation in `save_item` / `update_item` (Deno tests), place
   fields in the chunk text, the instructions, evaluation cases (a paid run with the owner's OK),
   then deploy `mcp` and `chat` (the owner approves the deploy). Strongest model.
3. **App:** a Place choice on New note and Edit note, the place view with **Open in Maps**,
   Want to go / Been there with rating, and the kind shown in lists. Tests: link building,
   metadata round trip, the form refuses a non-Maps link. Strongest model.
4. **Share from Google Maps** into the place form (check first what Google Maps shares on the
   owner's phone). Strongest model (touches the share intake).
5. **Save where I am:** the location permission (asked on the tap only), one reading, the place
   form with coordinates, `find_places` near a point (server-side distance), privacy page and
   Data safety wording for the owner's approval. Strongest model (permission and privacy).
6. **Ship:** phone checklist (`docs/places-phone-checklist.md`), handoff, "build for Play".
   Sonnet. **This build also carries the mic fix #91** (merged 2026-10-06, held for this build
   by the owner): the phone checklist must include "The first tap" and "Dictating" from
   `docs/phase5-a5e-phone-checklist.md`.

Step 2 covers the extension's fields too (validation of cuisine, price, occasions, dishes,
visits; "add a visit" through `update_item`; evaluation cases such as "Italian date-night places
we liked", "where haven't we been since summer?", and a door code in a visit note, refused).
Step 3 shows them (cuisine chips, price, occasions, dishes, **We went again** adding a visit).

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
