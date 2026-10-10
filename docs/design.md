# Digital Assistant — design

Status: phase 1 design, agreed 2026-09-27. Owner: Hassan Wehbe.

## 1. What it is

One assistant, one front door. The owner talks to it in natural language:

- "Store this login for the Gartner sandbox, in my Work space."
- "Save this design: the Teams to Service Cloud routing issue and how we fixed it." (plus a Visio export)
- "Save this recipe in Recipes, tag it weeknight."
- "What was the fix for the Teams routing timeout?"
- "Give me the Gartner sandbox login."

Passwords are one kind of data among many, not a separate app. What differs is
how each kind is stored behind the single interface.

## 2. Architecture

```
 Phone / desktop (Claude app, later Hermes via Telegram, later a web UI)
        │  natural language
        ▼
 Agent (LLM) ── decides intent, space, secure or not
        │  tool calls
        ▼
 MCP server (this repo) ── the product: tools, rules, encryption
        │
        ├── Knowledge path ──► item, item_chunk (pgvector), attachment (Storage)
        └── Vault path ─────► secret (encrypted payload), secret_access_log
```

The agent on top is replaceable. Data, security rules and encryption live in
the MCP server, which the owner controls.

### Phase 1 tools

| Tool | Purpose |
|---|---|
| `list_spaces` | Show the user's spaces (restricted ones marked, never their contents) |
| `create_space` | Create a space, optionally nested and/or restricted |
| `save_item` | Create an item in a space with type, tags, optional attachments |
| `update_item` | Edit an item; writes the old version to `item_revision` first |
| `search_items` | Semantic + keyword + tag search, scoped by space; excludes restricted spaces unless named and unlocked |
| `get_item` | Fetch one item with attachments and links |
| `link_items` | Record `supersedes` / `related` between items |
| `save_secret` | Start storing a typed secret: returns a link where the user types it; encrypted in the browser |
| `find_secret` | Match a secret by name/url/type; returns metadata only |
| `get_secret` | Returns metadata + a short-lived reveal link. **Never the plaintext.** |
| `update_secret` | Rename / change url; optional link to type a new value |
| `delete_secret` | Hard delete (the access log keeps a record) |
| `set_assistant_name` | Change the name the user calls the assistant (default Wilma, D17) |

### Phase 2 tools (attachments step 1, `docs/phase2-attachments-plan.md`)

| Tool | Purpose |
|---|---|
| `attach_file` | Returns a one-time upload link for pictures / Visio; needs an existing item, or a space plus title (creates the item). Takes Claude's description of a picture shown in the chat |
| `get_attachment_link` | Short-lived (10 min) download link for the owner |
| `describe_attachment` | Set or replace a picture's description (re-indexed for search) |
| `delete_attachment` | Delete a file and its search text (after the owner confirms) |

### Deleting (migration `recycle_bin`, owner's decisions 2026-09-30)

| Tool | Purpose |
|---|---|
| `delete_item` | Move an item to the recycle bin (soft delete, rule 8): hidden from search, `get_item` and the app |
| `list_deleted_items` | The recycle bin, most recent first (restricted spaces left out, rule 3) |
| `restore_item` | Bring an item back from the bin |
| `purge_item` | Delete a binned item for good; the server removes its Storage files first, then the rows |
| `delete_space` | Delete an **empty** space only (no items, not even binned; no sub-spaces; no vault secrets). The foreign keys cascade, so this check is what keeps a space delete from taking notes or secrets with it |

## 3. Decisions and reasons

| # | Decision | Reason |
|---|---|---|
| D1 | Single assistant for all data types, including credentials | The owner does not want to switch apps. |
| D2 | Credentials take a separate vault path: encrypted, never embedded, never shown to the model | RAG pipelines copy text into prompts, logs and third-party context. Keeping secrets out removes that exposure and makes prompt-injection extraction impossible. |
| D3 | Organizing unit is called **Space** (renamed from "compartment") | Natural to say out loud ("save this in my Gartner space"); avoids clashing with vector-DB "collection" and LLM "context". |
| D4 | Spaces nest (`parent_id`) and can be restricted | Work → Gartner → Teams Swarming; extra unlock for sensitive spaces. |
| D5 | One `item` table for all content types, with `item_type` + `metadata jsonb` | New content types need no schema change. |
| D6 | Tags are global per user (cut across spaces) via `tag` + `item_tag` | "Everything tagged salesforce" regardless of space. |
| D7 | Restricted spaces are **left out** of general and tag searches, with no hint | Owner's explicit choice. Enforced in search logic and RLS, not by tag structure. |
| D8 | `item_link` for supersedes / related | Assistant returns the current design and knows older ones exist. |
| D9 | Keep full edit history in `item_revision`; only current version is chunked | "What did this look like before?" without polluting search. |
| D10 | Secrets are typed (`secret_type`) with one encrypted JSON `payload_enc` | Covers logins, API keys, Wi-Fi, recovery codes, secure notes without schema churn. `expires_at` enables rotation reminders later. |
| D11 | Multi-user from day one (`app_user`, owner on every space) | Possible commercialization later. |
| D12 | Spaces are not shared between users | Owner does not want shared spaces, especially for secrets. |
| D13 | **Emergency access** for a trusted person (e.g. spouse): dormant grant, request starts a waiting period (`wait_days`), owner can deny, auto-grants after the wait | Access to accounts and funds if something happens to the owner, without day-to-day visibility. Modeled on Bitwarden emergency access. |
| D14 | **Item sharing** (`item_share`) with view/edit and optional expiry; structurally cannot reference secrets. **Before the build that ships sharing** (or D25's task assignment between users): redo Play's **content rating** questionnaire ("users can interact or exchange content": Yes) and re-check **Data safety** (owner, 2026-10-06: today's answer is No, as no user can see another's content yet) | Share a recipe or design with someone without granting space access. Play's forms describe the app as built, so they change with the build that adds user-to-user content. |
| D15 | Supabase free tier for phase 1, all in the cloud | No local setup; one account gives Postgres + pgvector, Storage and Auth. Open source, so self-hosting stays possible. Free projects pause after 7 days of inactivity; Pro ($25/mo) removes that. |
| D16 | Build with Claude Code on the web against this GitHub repo | Owner prefers cloud setup; repo is the single source of truth. |
| D17 | The assistant has an **invocation name**, default **Wilma** (`app_user.assistant_name`); the product, connector and MCP server stay "Digital Assistant" | The name is how the owner calls it: "Wilma, save this recipe" in any chat app, "Hey Wilma" by voice. No MCP server can force a tool call, so the name goes where every client's model looks: the server instructions and the descriptions of the main tools (save, search, save/get secret). Only a message *addressed* to the name counts, not a mention in content. One stored value serves every front end (chat, Telegram, voice wake word). Kept to a plain name (letters, spaces, `' . -`, 1-30 chars) because it is copied into text the model reads. |
| D18 | **One Wilma, no modes** (owner, 2026-09-30): every front end offers one box (and voice) for everything; an invisible router picks instant search, a model answer or an action, preferring the model when unsure (which model and provider: D21); destructive actions confirm; a monthly AI budget caps cost | The value of an assistant is that the user never has to decide *how* to ask. Search stays as the instant, free first layer; the router is only a speed and cost optimisation. Design and pieces: `docs/phase3-mobile-app-plan.md` ("The experience", A5). |
| D19 | **Vault import** from password-manager exports (Chrome/Google, Apple Passwords/iCloud Keychain, Bitwarden, 1Password, LastPass CSV/JSON). Parsed and encrypted **on the user's device** (vault page, same zero-knowledge path as manual entry); the export file is never uploaded and **never passed through the AI**. Imports are unlimited and do not count against any usage quota | New users arrive with hundreds of passwords. Bulk entry through chat would send every password to the model (violates rule 1), exhaust the quota on day one and cost money. Device-side import costs ~$0, keeps the vault zero-knowledge, and is a selling point. Remind the user to delete the export file afterwards. |
| D20 | **Product = the owner's own phone app with the AI built in** (iPhone and Android, one Expo/React Native codebase). The app's backend runs the conversation through a model API and calls the existing tools; the Claude-app connector stays as a second front end | The owner wants to open an app, ask, and go. Users' Claude/ChatGPT subscriptions cannot power a third-party app, so a model API is used and its cost is included in the app subscription. WhatsApp was rejected: Meta bans general-purpose AI assistants on the Business API (Jan 2026). |
| D21 | **Provider-neutral model layer; the model is chosen by evaluation, not up front.** All model calls go through one internal module (`llm`) with Anthropic and OpenAI adapters from day one (tool-calling formats differ); model and provider per route are configuration. Default/escalation split: a cheap model for everyday saves and lookups, a stronger one for long write-ups, images and multi-step requests. **Leading candidate:** OpenAI Luna by default + Claude Sonnet 5.5 for escalation; fallback: Claude Haiku 4.5 by default. Decided by a ~50-request evaluation set (tool choice, correct space and fields, **zero secret leaks**, including deliberate traps such as casually phrased passwords and restricted-space requests) run on Luna, Gemini Flash-Lite, Haiku and Sonnet. No free API tiers for user data | Sept 30 2026 estimate per 1,000 requests (retrieval-heavy, cached prefix): Luna $0.52, Flash-Lite $2.74, Haiku $5.18, Sonnet 5.5 $10.35; Luna/Sonnet hybrid $1.99 vs Haiku/Sonnet $5.95. On the $4.99 plan that is ~12% vs ~35% of revenue at full use. Switching cost is lowest before the chat endpoint exists. Verify model IDs and prices in each account before launch. |
| D22 | **Pricing: subscription with a monthly AI budget**, shown to users as "requests", tracked internally in cents (not tokens) because model costs differ. When the budget runs low, drop to Haiku-only before stopping. **Password retrieval never counts against the limit** | Predictable margins; no user is ever locked out of their own passwords. Working sketch: Free (~30 AI requests), Personal ~$4.99 (~300), Pro ~$12.99 (~1,000, diagrams, transcription). Validate against competitor prices and app-store fees (15-30%). |
| D23 | **No search bar.** The app is an assistant, not a search tool; everything, including lookups, goes through asking. Simple lookups are kept cheap instead: when a secret is found the app shows the Face ID reveal card directly, with no second model call | Protects the value proposition ("an assistant with a memory") while keeping the most common request inexpensive. |
| D24 | **Memory is explicit for now** (saves only when told). **Automatic memory is the next headline feature:** a background pass after each conversation (Haiku, batch pricing) proposes what to remember, files it in the right space, and shows the user an editable list; nothing sensitive is kept without the user choosing it, and passwords enter only through the vault. Long-term vision: a wearable that captures on the fly | Explicit memory ships on what exists today. Automatic memory is what turns "a memory you manage" into "an assistant that remembers" and is the main differentiator. |
| D25 | **Day planner** (owner, 2026-10-05). Wilma builds a plan for the day from Google Calendar, tasks, saved places and memory: prioritizes, proposes start/end times, adds traffic-aware drive times and weather alerts, and shows a timeline. **The calendar is read on the phone** (changed by the owner 2026-10-07): the app reads the phone's own calendar (Android calendar provider, iPhone EventKit; covers Google, Outlook/Exchange and iCloud calendars added to the phone) with the standard calendar permission, only the calendars the user ticks, only the requested days, private events as "Busy", nothing stored; the chat asks the app to read it (an app-run tool), so no Google token exists on the server and no Google verification or company account is needed. A **Google connection comes later and only for what the phone cannot do** (Google Tasks, the Claude connector, server-sent briefings), starting with the least access (free/busy first; `docs/day-planner-google-connection-plan.md`). Writing the plan back to the calendar later as an opt-in. **Tasks from two sources, each with its own job.** Google Tasks (with the later Google connection; on iPhone, Apple Reminders can be read on the phone) are read-only inputs to the plan, like the calendar: not imported or copied; missing details (duration, location, needs the car) are estimated by Wilma or asked, and can be remembered per Google task id as small planning hints. Wilma's own tasks (new item type with due date, priority, estimated duration, location) add **assignment**: a user can assign a task to another Wilma user (e.g. spouse, colleague), who sees it in their own Wilma and their day plan; assigner sees status (open, accepted, done). Assigned tasks never carry secrets (same rule as item sharing). **The model judges, code calculates:** the model ranks and explains; deterministic code computes free slots, travel times and buffers. **Day planning is a Pro feature** (mapping APIs cost per request; **before the build that sells Pro**: Play's "purchase digital goods" answer becomes Yes, the sale goes through Google Play Billing, and Data safety and the privacy page get re-checked; owner, 2026-10-06: today's answer is No). Steps: (1) phone calendar + "what's on my day" (`docs/phase6-day-planner-step1-plan.md`); (2) Google Tasks read + Wilma tasks + day plan; assignment to other users after the day plan works; (3) traffic (routing API with departure time) and weather/alerts (US National Weather Service, free); (4) proactive: morning briefing, leave-by push notifications, optional write-back. Outlook and Apple Calendar later. **Changed (owner, 2026-10-08):** old steps 2 and 3 are built together as step 2 (`docs/phase6-day-planner-step2-plan.md`: My day timeline, Wilma tasks, Mapbox drive times with traffic, NWS weather), before invite-only sign-up | First feature where Wilma acts on what she knows, not just stores it. Many users already keep tasks in Google; reading them avoids any sync conflicts, and Google Tasks has no way to assign work to another person, which Wilma tasks add. Google OAuth tokens must be usable by the server, so they are stored encrypted server-side (not in the zero-knowledge vault) and the privacy policy says so. Calendar and Tasks scopes are sensitive: Google verifies the app before public launch; until then up to 100 test users. Only the fields a plan needs are sent to the model. |
| D26 | **Places** (owner, 2026-10-06; plan `docs/places-plan.md`, approved 2026-10-06 and extended the same day; built after A5e, **before the company account and before the day planner**). A note type `place` for restaurants and places to visit, rich enough for Wilma to *recommend* them: name, address, Google Maps link, kind, cuisine, price level, want to go / been there with a rating, dishes liked, would go back, occasions (date night, kids, business, quick lunch, group, special) and visits (date, who with, a line). **Open in Maps** from the note. Saved by telling Wilma, from New note, shared from Google Maps, or **Save where I am** (one location reading, asked only on that tap, stored in that note), plus a photo as an attachment. Stored as `item_type = 'place'` with validated `metadata`, no new table. "Near me" by plain distance from stored coordinates (`find_places`, live 2026-10-06); later the chat's "near me" may send the phone's location once with that one message, never stored (Q9, owner 2026-10-06, places step 7). Live opening hours, travel times and the **date planner** come later with the day planner (D25) under the company's Google setup; then only the Google place ID is kept, details are fetched when planning. | Places are memories the owner already keeps, and the day and date planners need them with cuisine, occasions and history to choose well. Text, links and an on-tap location need no paid map service; the location permission is asked only when used, with privacy page and Play Data safety changes approved by the owner. |
| D27 | **Legal review by a lawyer is the last step before the public launch** (owner, 2026-10-06). Nothing ships to the public (Play production, App Store, paid plans) until a lawyer has reviewed every legal text and the claims the product makes; checklist in `docs/legal-review-checklist.md`, kept up to date as features land. Internal and closed testing may continue before it | Wilma holds passwords, personal notes, places, calendars and other people's details, takes payments and uses AI providers; the privacy policy, terms and store forms are promises the company is bound by. Drafts written with Claude are a starting point, not legal advice. |
| D28 | **Usage meter and top-ups** (owner, 2026-10-06). (1) **Meter, soon:** users see this month's allowance in the app (Settings and a small line under the box when it runs low): a bar, **about how many requests are left** and the reset date ("about 120 requests left, resets Nov 1"), from the existing `my_ai_allowance()`; a heads-up at 80%. Shown as requests, not tokens or dollars (D22: tracked internally in cents). Lookups that use no AI stay free and are never counted. (2) **Top-ups, after the company account:** "Add more" sells one-time packs (e.g. about 300 extra requests) through **Google Play Billing** (and Apple in-app purchase later), as consumable products; the server verifies each purchase with Google before crediting it (an `ai_credit` table: cents bought, used, source purchase id), and the allowance check uses the monthly allowance first, then credits. Credits roll over until used (owner to confirm). Pack prices keep AI cost at about a third of the price after the store's fee. A billing service such as RevenueCat may simplify Play/Apple receipts later | People should never be surprised by "allowance used"; a meter shows value and invites upgrading. Digital add-ons bought in the app must use the stores' billing, which needs the company's merchant account, so top-ups wait for the company. Server-side verification means a user can never grant themselves credit. |
| D29 | **Registration in two stages** (owner, 2026-10-06; plan `docs/signup-plan.md`). **Stage 1, soon (no company needed): invite-only sign-up** in the app: email, password, email confirmation, agreeing to the privacy policy and testing terms and confirming 18+, and an **invite code** the owner hands out (checked by the server before the account exists); new accounts get the default allowance and a short welcome (name, vault). **In-app account deletion** ships with it (both stores require it once people can sign up). **Stage 2, at the public launch** (after the legal review, D27): open sign-up, CAPTCHA, **Sign in with Google** and **Sign in with Apple** (Google needs the company's Cloud project; Apple expects its option when other social logins exist), and email sent from the company's domain. Going from invite-only to open is one server setting (`signup_mode`), no new app build (Q8, owner 2026-10-07; Q1-Q8 as recommended) | Creating testers by hand does not scale to a 12-tester closed test; invite codes let testers sign up themselves while keeping costs and abuse in check (every account spends real AI money). Open sign-up needs final legal texts and the company. |
| D30 | **Next features, in order** (owner, 2026-10-10, after the morning briefing): (1) **automatic memory** (D24); (2) **alarms and calendar entries** (D31); (3) **usage tracking and an admin page** (D34); (4) **sharing spaces and notes** (D32), with **sharing secrets** a separate, later decision (D33) | Memory makes every later feature smarter; alarms and calendar entries are small and act on what Wilma already knows; sharing is the first time two accounts touch the same data, so it gets its own careful design. |
| D31 | **Alarms and calendar entries** (owner, 2026-10-10; plan to come). "Wake me at 6:30", "remind me at 5 to call Sam": the app sets an alarm in the phone's own Clock app (Android's set-alarm intent, opened with the time filled in; the user sees it) or a Wilma notification (the briefing's notification code). "Put the dentist on my calendar Tuesday at 3": the app adds an event to a calendar the user picks, **only after the user confirms it on screen**, never silently, and never edits or deletes events it did not make. This ends "Wilma never changes your calendar": the calendar permission text, Settings → Calendars, the privacy page and D25 change with that build (Android already grants read and write together). Done on the phone (an app-run tool, like reading the calendar); nothing about the event is kept on the server. | Acting on what the user says is the natural next step after planning; the phone's own Clock and calendar keep working without Wilma, and on-screen confirmation keeps the model from changing anything by itself (rule 9's spirit). |
| D32 | **Sharing spaces and notes** (owner, 2026-10-10; plan to come; builds on D14 `item_share`). Share a note or a whole space with another Wilma user, view or edit, optional expiry; they see it in their Wilma, search finds it for them; the owner can stop sharing at any time. Restricted spaces cannot be shared (rule 3). Secrets never travel through it (rule 4). **Before that build:** Play's content rating ("users can interact or exchange content": Yes) and Data safety are redone, the privacy page changes, and the lawyer's checklist gets the item (D14, D27). RLS tests for the sharer, the receiver and a third user. | The family and team case (a shared Recipes space, a shared house space) without giving anyone your account. |
| D33 | **Sharing a secret: open, not decided** (owner raised it, 2026-10-10). It is against rule 4 as written. If wanted, it would be its own design, like emergency access (D13): the secret encrypted on the sharer's phone for the receiver's public key, the server never able to read it, every share and reveal in `secret_access_log`, and never through `item_share`. Needs the owner's explicit decision to change rule 4 first. | Sharing the Wi-Fi or a streaming password with family is a real need, but it must not weaken the vault's zero-knowledge promise. |
| D34 | **Usage tracking and an admin page** (owner, 2026-10-10; plan to come; after alarms and calendar entries, before sharing). **Tracked per user per day, counts only, never content:** AI by purpose (chat, plan my day, search-box sorting, memory noticing) with model calls, input / cached / output tokens, cost and model; Mapbox and weather requests and failures; feature use (messages, saves, searches, day plans from My day and from the chat, memories kept, fair-use hits); `chat` and `mcp` invocations; errors, timeouts and step-limit answers; Free or Pro that day; active days. Monthly snapshots of notes, memories and attachment storage. One table and one function the server calls after each request (as `record_ai_cost`: a user adds only to their own row, capped per call); deleted with the account; kept about 13 months; the privacy page says so. **Admin page on GitHub Pages from the start** (owner, 2026-10-10: not in the phone app, no saved-report stage first): the owner signs in with their Wilma account; the numbers come from database functions that answer only for accounts on an admin list the owner controls; a polished analysis UI (owner, 2026-10-10: "a nice slick UI can help me analyze things"): headline tiles (users, active users, cost this month, cost per active user, projected month and year), charts over time by cost source (AI by purpose, Mapbox, weather), the spread across users (bottom half, middle, top 10%, top 1%) with power users vs others and Free vs Pro side by side, a per-user table to sort and filter (by user id, never content), a Pro price explorer (a price and a user count in, margin per user and per month out), and reports: a monthly summary to print or save as PDF and CSV downloads of the tables. Light and dark, works on the phone's browser. Aggregates and per-user-id counts only, never a note, message or memory (rule 5). | The allowance counts only AI cost and requests; Mapbox and weather calls live only in log lines that expire. Real per-user numbers set the Pro price and show what a power user costs. Kept out of the app so no admin code ships to every phone and a new chart needs no store build; GitHub Pages already hosts the legal pages and costs nothing. |

## 4. Data model

See `db/schema.sql`. Groups:

- **People and access:** `app_user`, `emergency_access`, `item_share`
- **Organization:** `space`, `tag`, `item_tag`, `item_link`
- **Knowledge and RAG:** `item`, `item_revision`, `item_chunk`, `attachment`
- **Vault:** `secret`, `secret_access_log`

Deviation from the reviewed ERD: `app_user.id` is the Supabase Auth user id
(`auth.users.id`) instead of a separate `auth_subject` column, so Row Level
Security can use `auth.uid()` directly.

Embeddings: `vector(384)` assumes Supabase's built-in `gte-small` model (free,
runs in Edge Functions). If a different model is chosen, change the dimension
in a migration before any data is loaded.

## 5. Encryption

**Target design (zero-knowledge):** each user has a key pair. Their secrets are
encrypted with a per-user data key; the private key is stored only wrapped by a
key derived from the user's unlock passphrase (`wrapped_private_key`), so the
operator cannot read secrets. Emergency access stores the data key wrapped with
the trusted person's public key (`emergency_access.wrapped_key`), usable only
once access is granted. Reveal happens client-side on the reveal page.

**Phase 1: option B was chosen and built (milestone 2, 2026-09-28).** Details
and as-built notes: `docs/phase1-m2-vault-plan.md`. The options as considered:

- Option A — server-side envelope encryption: per-user data key, wrapped by a
  master key held in Supabase secrets. Simpler; the operator could technically
  decrypt. Acceptable for a single-owner deployment.
- Option B — go straight to the target design. More work up front, no migration later.

Either way: libsodium / Web Crypto primitives only, no home-grown crypto,
`key_version` on every secret for rotation.

## 6. Roadmap

1. **Phase 1:** schema in Supabase, MCP server with the tools above (typed input
   only), connected to the Claude app. Knowledge path first, vault second.
2. **Phase 2:** attachments (step 1 built: pictures and Visio, descriptions written in the
   chat, `docs/phase2-attachments-plan.md`; later TIFF, transcripts, automatic vision descriptions), reveal page with passphrase unlock, emergency access flow.
3. **Phase 3:** own app first (`docs/phase3-mobile-app-plan.md`: Expo/React Native, Android
   then iOS from one codebase, PC/Mac as a web page, optional desktop app later), voice input,
   Hermes on a small cloud server for Telegram/WhatsApp access, reminders (`expires_at`,
   follow-ups), item sharing UI. Product decisions for the app: D20-D23 (built-in model via a
   provider-neutral `llm` layer, usage budget, Face ID reveal card, vault import D19).
4. **Automatic memory (D24):** background extraction with an editable
   "what I remembered" list; proactive reminders.
5. **Places (D26):** a `place` note type with cuisine, price, occasions, dishes, visits and
   "save where I am", after A5e and before the company account and the day planner; live hours,
   travel times and the date planner later with the day planner. Plan: `docs/places-plan.md`.
6. **Day planner (D25):** the phone's calendar (Android and iPhone, read on the device), Wilma tasks
   with assignment, prioritized timed plan with traffic and weather, then morning briefing and
   leave-by alerts; a **date planner** built on saved places (D26). Step 1 (phone calendar) starts
   after Places and the UI tidy-up (`docs/ui-review.md`) and needs no company account; Google Tasks, traffic/hours and Google services come
   with the company account.
   Voice listens for a wake word built from `assistant_name` ("Hey Wilma"), e.g. a
   custom openWakeWord model; renaming the assistant means training a new wake word.
6b. **Usage meter (D28):** "about N requests left, resets on ..." in the app, soon (no company needed);
   **top-ups** (paid packs through Google Play Billing, verified on the server) after the company
   account, alongside subscriptions.
6c. **Registration (D29):** invite-only sign-up and in-app account deletion soon; open sign-up
   with Google and Apple sign-in at the public launch. Plan: `docs/signup-plan.md`.
6d. **Next, in order (D30, owner 2026-10-10):** automatic memory (step 4 above), then alarms and
   calendar entries (D31), then usage tracking and the admin page on GitHub Pages (D34), then
   sharing spaces and notes (D32); sharing a secret is a separate, later decision (D33).
7. **Legal review (D27), last step before the public launch:** a lawyer reviews the privacy
   policy, terms, account deletion page, store privacy forms, subscription terms and the
   product's security claims (`docs/legal-review-checklist.md`), with the company in place.

## 7. Open questions

- ~~Encryption phase 1~~: option B, zero-knowledge, with a separate unlock passphrase and a recovery key (decided 2026-09-28, see `docs/phase1-m2-vault-plan.md`).
- ~~Where the MCP server is hosted~~: Supabase Edge Functions (decided 2026-09-28, see `docs/phase1-m1-plan.md`).
- ~~Embedding model~~: built-in `gte-small`, 384 dimensions (decided 2026-09-28).
