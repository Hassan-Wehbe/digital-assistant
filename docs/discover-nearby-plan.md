# Discover nearby: restaurants, cafés, things to do and cinemas from a places service

Status: plan, 2026-10-19. **Owner's answers given the same day: all as recommended (Q1-Q9).** Next:
step 0 (the owner's Google Cloud key; see "Step 0, for the owner"). Design: D42 (builds on D26,
places, and D40, the planners). Model: the strongest for
steps 1 and 3 (a new outside service, what the AI sees, the chat); a smaller one for steps 2 and 5.

## Why

The owner (2026-10-19), after trying the planners: "is there an option to populate data from
google or bing or another services from restaurants/activities/movie theatres in the area?" Today
Wilma only knows the places the user saved (D26), so a new user, or someone in a new
neighbourhood, gets "save a few places first". A places service fills that gap: what is near home
(or near me now), with ratings, price and opening hours, to look at, save, and later plan with.

## What exists today

- **Saved places** (D26): notes of type `place` with kind, cuisine, price, rating, occasions,
  visits and a location. `find_places` ("near me") searches only these.
- **Mapbox** for drive times (server side, `MAPBOX_TOKEN`), **the phone's own map lookup** for
  addresses, **NWS** for weather. All named on the privacy page.
- **Pro and fair use** (`use_day_plan`, `my_ai_allowance`): the pattern for anything that costs
  money per request.
- D26 already foresaw this: "Live opening hours, travel times and the date planner come later …
  under the company's Google setup; then only the Google place ID is kept, details are fetched when
  planning."

## The services (checked 2026-10-19; prices change, so the owner checks the official pages)

| Service | What it gives | Cost (as published by third parties; confirm) | Keeping results |
|---|---|---|---|
| **Google Places API (New)** | The richest: name, kind, rating, price level, opening hours, photos, cinemas, worldwide (Beirut and the US alike) | Nearby/Text Search Pro about **$32 per 1,000** with **5,000 free a month**; asking for rating or hours moves a search to Enterprise, about **$35 per 1,000 with 1,000 free** | Only the **place ID** may be kept; latitude/longitude up to 30 days; other details are fetched again each time (Google's Places API Policies, to confirm in step 0) |
| **Mapbox Search Box** (category search) | Cafés, restaurants, cinemas by category; name, address, location; **no ratings, price or hours** | Billed per request; about **$1-1.70 per 1,000** after a free allowance of 25,000-50,000 | "Temporary use" only (no keeping) |
| **Foursquare Places** | Good venue data, categories, some ratings and tips | **500 free calls**, then about **$15 per 1,000** (Pro endpoints) | Its own terms |
| **OpenStreetMap** (Overpass) | Free, open data; names, kinds, often hours; **no ratings or price** | Free (fair use of public servers) | Open licence (attribution) |
| **Bing** | Not available: Microsoft retired the Bing Search APIs in 2025 | | |
| **Movie showtimes** | None of the above has them; showtime data is sold by specialist providers at business prices | | Link out to the cinema's page or Google instead |

**Recommendation: Google Places.** It is the only one with ratings, price and hours everywhere the
owner and testers live, and those are what make a suggestion worth trusting. The free allowance
easily covers the owner and a handful of testers. Its strict "keep only the ID" rule fits Wilma's
habit of not storing what a service returns (Mapbox drive times already work that way).

## What the owner will see

- **Discover nearby** (from Places & Homes and from ＋): chips **Restaurants · Cafés · Bars · Things
  to do · For kids · Cinemas**, **Near home** (default) or **Near me** (one location reading, on the
  tap, as Save where I am), and a list: name, kind, ★ rating, $$, "Open now" or the next opening,
  distance. Each with **Open in Maps** and **Save** (it becomes one of your places, so it shows in
  "near me", the planners and the chat). "Powered by Google" at the foot, as Google requires.
- **The chat:** "find a good café near me" or "any cinemas near home?" shows the same list as a
  card. Wilma says how many she found and what kinds; the card holds the details.
- **Cinemas:** the list and Open in Maps / the cinema's website for showtimes (no showtimes in Wilma).
- **Later (step 4, only after the legal check):** a date's "Somewhere new" may include one nearby
  suggestion you haven't saved, marked as new.

## How it works

1. The app asks the `chat` function (`{"mode":"nearby", "category", "near": "home" | point}`), as
   the planners do. Pro, counted (a small daily cap per user, Q8).
2. The server calls Google's Nearby Search with the category's place types, a radius, and a field
   mask with only what the list shows (name, types, rating, price level, opening hours, location,
   Google Maps link). The search centre is the home or the phone's reading, **rounded to about 100
   m**; nothing else about the user is sent.
3. The results go back to the app and are **never stored** on the server; the log line has counts
   and codes only. The phone keeps them in memory while the screen is open.
4. **Save** makes an ordinary place note: the place ID, a Google Maps link, the name as the user
   confirms it, and the address and location from the phone's own map lookup (as for a typed
   address), so nothing Google returned is kept beyond its ID (Q6, a lawyer item).
5. In the chat, `find_nearby` shows the card; the model gets the number found and the kinds only
   (Q7), so Google's details do not pass through the AI provider.

## Rules check

- **Secrets (rules 1, 2, 9):** nothing secret is involved; the search takes a category and a point.
  A name the user confirms on Save goes through the usual credential check.
- **Restricted spaces (rule 3):** discovered places are not the user's notes; once saved, a place
  follows its space's rules. Discover never lists or hints at a saved place in a locked space.
- **Every row owned (rule 5):** no new table (a saved place is an `item`). If Q8's cap needs a
  counter, it uses the existing `use_day_plan` style RPC (RLS, no `anon`).
- **Privacy:** a rounded point and a category go to Google (a new service provider); the privacy
  page, the legal checklist and Play's Data safety are updated in step 5.
- **Cost:** per request; Pro only, a daily cap per user, and a budget alert in Google Cloud.
- **Terms:** Google's attribution, its storage rule, and whether its content may go to another AI
  provider: checked before step 3 and before step 4.

## Answers (owner, 2026-10-19): all as recommended

Q1 Google Places. Q2 a Discover nearby screen and the chat. Q3 near home by default, Near me on a
tap. Q4 Restaurants, Cafés, Bars, Things to do, For kids, Cinemas. Q5 showtimes by link only. Q6
on Save keep only Google's place ID and a Maps link, the name the user confirms, the address from
the phone's map lookup. Q7 the AI sees only how many and what kinds; the card shows the rest. Q8
Pro only, 20 searches a day per user, a $10 monthly budget alert. Q9 the planners later, after the
legal check.

## Questions (recommendation first)

- **Q1. Which service:** **Google Places** (rec.: ratings, price, hours, cinemas, worldwide; free
  allowance covers early use); or Mapbox (already a provider, cheap, but no ratings or hours); or
  Foursquare; or OpenStreetMap (free, thinnest).
- **Q2. Where you discover:** **a Discover nearby screen and the chat** (rec.); or the chat only.
- **Q3. Around where:** **near home by default, Near me on a tap** (rec.: one reading, never
  stored); or home only.
- **Q4. Categories:** **Restaurants, Cafés, Bars, Things to do, For kids, Cinemas** (rec.); add or
  remove any.
- **Q5. Movie showtimes:** **link out** (the cinema's site or Google) (rec.); or look for a paid
  showtimes provider later (business pricing).
- **Q6. Saving a discovered place:** **keep only Google's place ID and a Maps link, with the name
  you confirm and the address from the phone's map lookup** (rec.: fits "keep only the ID"; the
  lawyer confirms); or keep Google's details too (simpler, but likely against Google's terms).
- **Q7. What the AI sees in the chat:** **only how many were found and their kinds; the card shows
  the rest** (rec.: Google's details never pass to the AI provider); or names and ratings too
  (Wilma can talk about them, "the closest is Kalei, 4.6 stars", after the terms check).
- **Q8. Limits:** **Pro only, 20 searches a day per user, and a $10 monthly budget alert in Google
  Cloud** (rec.); or another cap.
- **Q9. In the planners:** **later, after the legal check: "Somewhere new" may add one
  discovered place** (rec.); or never (planners stay on saved places only).

## Steps

0. **Owner, before any code:** create a Google Cloud project (personal account is fine for
   testing), turn on **Places API (New)**, make an **API key restricted to Places API** and add it
   as a Supabase secret `GOOGLE_PLACES_KEY` (Claude never sees it; the steps will be written out),
   set a **budget alert**. Claude: read Google's Places API Policies and attribution rules (blocked
   from the build environment) and record them here; a legal checklist item.
1. **The server (strongest model).** `{"mode":"nearby"}` in `chat`: Pro, the daily cap, the Google
   request with a field mask, the rounded point, nothing stored; Deno tests with a fake Google
   (the field mask, the rounding, nothing stored, not Pro, the cap). **Owner:** merge, OK to deploy.
2. **The app (smaller model).** Discover nearby: the chips, Near home / Near me, the list, Open in
   Maps, Save (the phone's map lookup for the address), "Powered by Google". App tests.
3. **The chat (strongest model).** `find_nearby` and its card; evaluation cases (a restricted
   trap, a password trap, not Pro, the card only). **Owner:** OK + cap for an evaluation run, merge,
   OK to deploy.
4. **The planners (strongest model, optional, after the legal check).** One discovered place in
   "Somewhere new".
5. **Help, privacy, checklist, build (smaller model).** Help lines, the privacy page (Google as a
   provider), the legal item, Play Data safety, the phone checklist, then the build.

## Step 0, for the owner

Do these yourself; Claude never sees the key. About 15 minutes.

1. Go to **console.cloud.google.com** and sign in with your Google account. Create a project
   (top bar → project picker → **New project**), name it "Wilma".
2. **Billing:** Google asks for a billing account (a card) even for the free allowance. Link one to
   the project.
3. **APIs & Services → Library**: search **"Places API (New)"** and press **Enable**. (Not the
   older "Places API".)
4. **APIs & Services → Credentials → Create credentials → API key.** Then **Edit** the key:
   - **API restrictions:** Restrict key → tick only **Places API (New)**.
   - **Application restrictions:** None (the key is used only by Wilma's server, never in the app).
   - Save. Copy the key; it is shown on that page whenever you need it again.
5. **Supabase:** your project → **Edge Functions → Secrets → Add new secret**: name
   `GOOGLE_PLACES_KEY`, value: the key. Save. Do **not** paste the key into this chat, an issue, or
   a file in the repo (if it ever is, delete it in Google Cloud and make a new one).
6. **Budget alert:** Google Cloud → **Billing → Budgets & alerts → Create budget**: the Wilma
   project, **$10 a month**, alerts at 50%, 90% and 100% to your email. (An alert does not stop
   spending by itself; the 20-a-day cap in step 1 does that.)
7. Tell Claude "the Places key is set". Claude then checks Google's Places API Policies and
   attribution rules (or asks you to paste their text if the pages stay blocked), records them here,
   adds the lawyer's item, and starts step 1.

## Sources (checked 2026-10-19)

- Google Places API pricing (third-party summaries of Google's price list):
  [openplacesapi.com](https://openplacesapi.com/blog/google-places-api-pricing),
  [bizcollect.dev](https://bizcollect.dev/blog/google-places-api-pricing),
  [basedonb.com](https://www.basedonb.com/en/blog/google-places-api-pricing)
- Google Maps Platform service terms (place ID caching, 30-day lat/lng):
  [cloud.google.com, 2025-05-01](https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250501),
  [openplacesapi.com on caching](https://openplacesapi.com/blog/can-you-store-places-api-results)
- Mapbox Search Box: [docs.mapbox.com](https://docs.mapbox.com/api/search/search-box/),
  [mapbox.com/search-box](https://mapbox.com/search-box),
  [pricingsaas.com](https://pricingsaas.com/companies/mapbox/diffs/2026W40)
- Foursquare: [foursquare.com pricing](https://foursquare.com/products/pricing/)
