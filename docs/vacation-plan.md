# Vacation planner: ideas from a few questions, then booking and real prices (D46)

Status: **proposal, 2026-11-05. Nothing built, no owner answers yet** (Q1-Q8 below wait for them). Raised by the
owner on 2026-11-04/05: "a full blown vacation planner: step one proposes ideas from a series of questions,
step two can we set up booking? I would like to see real prices in the app, but that depends on cost, so put
together a cost analysis." Home's Plan with Wilma row already has a **Vacation** button marked "Soon" (D40,
`docs/planners-plan.md`: flights, lodging and search were out of scope then). Today Wilma is for family and
friends; the cost numbers below are sized for that, not for a public launch.

Model: the strongest for steps 1, 3 and 4 (a new outside service, what the AI sees, the chat, money-adjacent
rules); a smaller one for the app screens (step 2) and wording, checklists and builds.

## What it would be

1. **Ideas from questions (step 1).** Wilma asks a short set of questions, one at a time, and proposes 3 to 5
   trip ideas, each with a line on why it fits, a rough cost range, and the best time to go:
   - who is going (adults, children and their ages), when, and how many days;
   - a rough budget;
   - what you like (beach, city, nature, food, culture, rest);
   - how far you will travel, and anywhere you want to go or have been (read from the saved places);
   - anything to avoid (flights over N hours, no driving, mobility, diet).
   The questions and answers use the same chat and planner pattern as Date night and Family day (D40).
2. **A trip note.** Picking an idea saves a trip in a built-in **Trips** space (the same one-kind-per-built-in-space
   rule as Places, D45): dates, travellers, a day-by-day outline, and a to-do and packing list that feeds Tasks
   and My day. A trip is an ordinary note: passport numbers, booking logins and card details are never kept in it;
   they belong in the vault, and the server already refuses credential-looking text (rule 9).
3. **Hand-off booking (step 3a).** Wilma builds search links to booking sites with the dates, travellers and
   destination already filled in. You book on their site. You then share or paste the confirmation into Wilma,
   which keeps the plain details on the trip (times, address, a confirmation number that is not a login) and adds
   them to the calendar and My day. No money touches Wilma.
4. **Real prices in the app (step 3b, only if worth it).** Wilma shows live flight and hotel prices from a travel
   data service, then hands off to book. See the cost analysis.
5. **Booking inside Wilma (not recommended).** Taking payment makes Wilma responsible for refunds, changes and
   support, and needs a licensed partner, payment-security rules and a lawyer's review. Not for a family-and-friends
   app.

## Cost analysis (2026-11-05)

Figures come from web searches on 2026-11-05. Several are from third-party sites and I could not open some
official price pages, so **everything marked "unconfirmed" must be checked with the provider before we build.**

### What is no longer an option

- **Amadeus Self-Service API** (the usual free choice for flight search): shut down on 17 July 2026
  ([report](https://airlabs.co/amadeus-self-service-api-shutdown)). What remains is an Enterprise contract with
  custom pricing. Ruled out.
- **Booking.com's hotel (Demand) API:** reported to need Managed Affiliate Partner status, a signed contract and
  an account manager, not open to small apps
  ([guide](https://vorplabs.com/agent-tools/booking-demand-api)). Ruled out unless Booking approves us.
- **Travelpayouts' Hotellook:** one review says it was shut down
  ([G2](https://www.g2.com/products/travelpayouts)). Unconfirmed; not planned.

### Options that look realistic

| Piece | Option | Cost, as found | Catch |
|---|---|---|---|
| Ideas (step 1) | Wilma's own AI call | a few cents per set of ideas (estimate, inside the default $1/month AI allowance) | prices in ideas are general knowledge: Wilma must say "roughly" |
| Flight prices | [Duffel](https://duffel.com/pricing) | searches free up to a 1,500 searches per booking ratio; about $0.005 per extra search; about $3 per confirmed booking (third-party figures, unconfirmed) | account and approval needed; covers only airlines on Duffel; a price-only app has few bookings, so its ratio is poor (at our volume that is cents) |
| Flight prices | [SerpApi, Google Flights](https://scrapegraphai.com/blog/serpapi-pricing) | free plan 100-250 searches a month (sources disagree), then $25 a month for 1,000 | reads Google's results: check the terms for this use |
| Hotel prices and booking | [LiteAPI](https://docs.liteapi.travel/docs/faq) | free sandbox; core endpoints free; a card on file unlocks the production key; the seller sets a margin per booking, paid after check-out | production terms, payouts, who handles refunds and whether Wilma would be the seller of record are unconfirmed |
| Hotel booking | Duffel Stays | unclear (a "profit sharing" section on the pricing page) | ask Duffel |
| Places and maps | Google Places (the key already planned for D42 and D45) | cents per search (`docs/places-space-plan.md`) | none new |

### What it would cost us

- **Family and friends** (about 10 people, 5 to 10 trips a year, about 20 searches per trip, so 100 to 200 searches
  a year): the free tiers and the AI allowance cover it, **about $0 to $5 a month**.
- **Worst case if abused or left unlimited:** SerpApi's $25 plan, or 1,000 Duffel extra searches (about $5).
  A daily limit per user (as `place-search` has: 100 a day) and a $10 monthly budget alert on every paid key
  keep it there.
- **Commission** (LiteAPI's margin, an affiliate share) is paid only on completed stays. At family scale that is a
  few dollars a year, so commission does not pay for any of this. It matters only if Wilma goes public.

### Is it worth it?

- **Step 1 (ideas): yes.** Cents, and it reuses the planners, saved places, the AI allowance and the usage counter.
- **Step 3a (hand-off links and saved confirmations): yes.** Free, and the app never touches payment.
- **Step 3b (real prices): affordable, but the largest build and the most outside terms** (new accounts, keys,
  contracts, a lawyer's look before any public launch). Recommend deciding **after** steps 1 and 3a have been used
  on one or two real trips.

## Rules that do not change

- **No payment or card details in Wilma, ever.** Hand-off sends the user to the booking site; nothing is paid in
  the app (rules 1 and 6).
- **A booking reference that works as a login** (a loyalty number with a PIN, a "manage booking" password) goes to
  the vault, not the trip note. The existing credential check applies to every field (rule 9).
- **Trips respect restricted spaces and sharing** (rules 3 and 4): a trip is searchable only if its space is; a
  shared trip never carries a vault item.
- **Outside services are server-side.** Keys live in Supabase secrets; the phone sends only what the user typed,
  never where the phone is (as `place-search`); every call is counted in usage tracking (D34); a daily limit per
  user; nothing typed is logged.
- **What the AI sees** is the user's answers and the destination, not the vault, restricted spaces or other
  people's data. Prices from a service are shown as "from a travel site, may change", never as a promise.

## Questions (recommendation first)

- **Q1. Who is it for now?** **Family and friends, using the existing household settings** (rec.); or any user.
- **Q2. What does "booking" mean first?** **Hand-off links plus saved confirmations (step 3a)** (rec.); or real
  prices in the app straight away (step 3b); or booking inside Wilma (not recommended).
- **Q3. Where do trips live?** **A built-in Trips space, one kind per space like Places** (rec.); or ordinary notes
  in a space the user names.
- **Q4. Ideas questions:** **five or six, one at a time, skippable** (rec.: who, when, budget, likes, distance,
  avoid); or one form; or just free chat.
- **Q5. Ideas without live data:** **say plainly that costs and times are rough, and use Discover nearby (D42) for
  real places once its Google key exists** (rec.); or wait for step 3b before ideas.
- **Q6. Flight prices if we do step 3b:** **Duffel if it approves us, else SerpApi** (rec.); or none (links only).
- **Q7. Hotel prices if we do step 3b:** **LiteAPI** (rec.), after its production terms are read; or links only.
- **Q8. When?** **After the versionCode 31 phone checklist, the Google key, and sharing steps 3-4 (D32)** (rec.);
  or before sharing.

## Steps

1. **Server and chat (strongest model).** The Trips built-in space (database, guard, kind), the question flow and
   the ideas call in `chat`, checked fields for a trip, Deno and SQL tests, an evaluation run (owner's OK and a
   cap). **Owner:** dry run, OK to apply, merge, OK to deploy.
2. **App (smaller model), mockups first.** Vacation button opens the questions, the ideas cards, the trip note and
   its to-do list; app tests. **Owner:** pick the mockup, merge, OK to build.
3. **Hand-off and confirmations (step 3a, strongest model for the confirmation rules).** Search links, saving a
   shared confirmation to the trip (credential-like references go to the vault), calendar and My day entries.
4. **Real prices (step 3b, strongest model, only if decided).** One new server function for the outside services
   (keys as Supabase secrets, a daily limit, usage tracking, `not_set_up` without a key), price cards in the app,
   hand-off to book. **Owner:** open the provider accounts, check their terms, paste the keys into Supabase
   (never into chat), set a $10 budget alert.
5. **Phone checklist and build.**

**Owner, before step 3b:** ask Duffel (is a price-only app approved? current rates) and LiteAPI (production terms,
seller of record, refunds) in writing; check SerpApi's terms for Google Flights. These cost nothing and decide
whether step 3b is worth building.
