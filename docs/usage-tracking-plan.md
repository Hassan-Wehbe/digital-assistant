# Usage tracking and the admin page (D34)

Status: plan, 2026-10-22; **owner's answers the same day: all as recommended** (Q1-Q8 below).
**Step 1 merged (#275); migration applied 2026-10-25:** see "As built: step 1". **Step 2 merged
(#277) and deployed 2026-10-25:** see "As built: step 2". **Step 3 merged (#280), layout B (tabs):** see
"As built: step 3". **Step 4 merged (#281):** see "As built: step 4". **Step 5 written 2026-10-25,
branch `claude/usage-step5-checklist`, not merged:** see "As built: step 5". Design: D34 (decided
2026-10-10: what is counted, never content; the admin page on GitHub Pages, not in the app; the
analysis it shows). Model: the strongest for steps 1-2 (a new table every request writes to, admin
functions, RLS, the chat loop); a smaller one for the page itself (steps 3-4) and step 5.

## Why

Today Wilma counts only **AI cost and requests per user per month** (`ai_usage`) and two daily
fair-use counters (`day_plan_usage`, `recipe_suggestion_usage`). Mapbox and weather calls, tokens,
models, which feature cost what, errors and who is active live only in log lines that expire after
a few days. Real numbers per user per day are what set the Pro price and show what a power user
costs (D34), and they are wanted before anything new that costs money per use (Discover nearby,
D42, uses Google Places).

## What exists today

- `ai_usage` (user, month, cost_cents, requests), written by `record_ai_usage` (counts a request)
  and `record_ai_cost` (cost only: search-box sorting, memory noticing); `my_ai_allowance()`;
  `admin_ai_overview()` (this month, every account, email and numbers), behind `require_admin()`
  and `app_user.is_admin`.
- Each edge function already builds one structured log line per request: `chat` (model calls,
  tools, cost, outcome, code), `day` (events, drives, Mapbox and weather requests and failures),
  `classify`, `memory`, `outing`, `recipe_suggest`, `recipe_from_text`, `find_places`; `mcp` logs
  per tool. Counts only, never text (rule 1). Tokens and the model name are known when a model
  answers (`StreamEvent` usage) but not kept in the log line yet.
- The vault pages on GitHub Pages (`docs/vault/`) already sign in with a Wilma account using a copy
  of supabase-js kept in the repo, under a strict Content-Security-Policy. The admin page follows
  the same pattern.

## What the owner will see

**An admin page** at `https://hassan-wehbe.github.io/digital-assistant/admin/` (D34: not in the
phone app). Sign in with your Wilma account; anyone not on the admin list sees "Not available" and
gets no numbers (the database refuses them, not the page). Light and dark, works on the phone's
browser. Mockups first (step 3), on the design canvas.

- **Tiles:** users, active users (today, 7 days, 30 days), cost this month, cost per active user,
  projected month and year.
- **Over time:** daily cost by source (chat, plan my day, search-box sorting, memory noticing,
  outings, recipe suggestions, reading recipes, Mapbox, weather), requests and errors; 30 days,
  90 days, 12 months.
- **The spread:** cost per user this month, bottom half, middle, top 10%, top 1%; power users vs
  the rest; Free vs Pro side by side.
- **Per user** (Q2): a table to sort and filter: active days, requests by feature, AI cost, Mapbox
  and weather calls, fair-use hits, errors, Free or Pro, notes, memories and storage (monthly
  snapshot). Never a note, message, memory or place.
- **Pro price explorer:** type a price and a number of users; see margin per user and per month,
  from the real cost spread.
- **Reports:** this month's summary to print or save as PDF; CSV downloads of each table.

**In the app:** nothing changes. **Privacy page:** one sentence (usage counts per day, kept about 13
months, deleted with the account; never content).

## How it works

1. **One table, counts only** (step 1): `usage_day` (user, day, kind, model, plus numbers: count,
   model_calls, input / cached / output tokens, cost_cents, failures). `kind` is one of a fixed list
   (Q-list below); `model` is the model's name for AI kinds, empty otherwise. One row per user,
   day, kind and model, added to. RLS: a user reads only their own rows; nobody writes directly.
   Free or Pro and "active" per day come from `usage_day` itself (any row that day) and
   `app_user.plan` at the time of writing (kept in a small `user_day` row: user, day, plan).
2. **One writing function:** `record_usage(p_rows jsonb)`, the caller's own rows only, each row
   checked (a known kind, counts and tokens within a cap per call, cost at most 5 cents per row as
   `record_ai_cost`), the day is the server's (Q1). Called once per request by `chat` and `mcp`
   **after** the answer is sent (`EdgeRuntime.waitUntil`), so it never slows or breaks a reply; a
   failed write is logged and dropped. The existing `ai_usage` and fair-use counters stay as they
   are (they decide limits; this only observes).
3. **Where the numbers come from** (step 2): a small `_shared/usage.ts` turns each request's log line
   into rows (the log lines already hold the counts; tokens and the model are added to them). So
   what is logged and what is counted can never disagree, and nothing new reads content.
   - AI kinds: `chat`, `day_plan` (from My day / from the chat), `classify` (search-box sorting),
     `memory` (noticing), `outing`, `recipe_suggest`, `recipe_import` (text / picture).
   - Outside services: `mapbox` (requests, failures), `weather` (requests, failures); later
     `google_places` (D42).
   - Features: `message`, `save`, `search`, `memory_kept`, `fair_use_hit` (by feature), `error`
     (by code: timeout, step limit, connection), `mcp_call` (the Claude connector, by tool).
4. **Admin functions** (step 1): `admin_usage_*` (tiles, daily series, spread, per user, CSV rows),
   each starting with `require_admin()`; aggregates and per-user counts only; a user id, and an email
   only if Q2 says so. Monthly snapshot of notes, memories and storage per user (Q4).
5. **Keeping it 13 months** (Q3): rows older than 13 months are deleted; deleted with the account
   (`on delete cascade`, as `ai_usage`).

## Rules check

- **No content anywhere** (rules 1, 5): counts, tokens, costs, model names, error codes. The
  writing function takes numbers and fixed names only; a test checks no text field can carry
  anything else. Secrets and the vault are never touched (rules 1-2, 4).
- **Restricted spaces** (rule 3): counts never say which space; the monthly snapshot counts notes
  without splitting restricted ones out.
- **Every row owned, RLS on** (rule 5): users add only to their own rows; the admin functions are
  security definer behind `require_admin()`; anon gets nothing; no service-role key in a request.
- **No new AI cost**, no change to what the model sees.

## Answers (owner, 2026-10-22): all as recommended

Q1 UTC days; Q2 a short user id, the email on tap; Q3 rows older than 13 months deleted when the
admin page is opened; Q4 a monthly snapshot plus today's numbers; Q5 Mapbox in dollars with an
editable price, the free tier first; Q6 one small charts library copied into the repo; Q7 the
months already in `ai_usage` shown, daily detail from deploy; Q8 the owner's account only, set by
one SQL line.

## Questions as asked (recommendation first)

- **Q1. A "day":** **UTC, as the monthly allowance** (rec.: one clock for everyone, simple charts);
  or each user's own time zone.
- **Q2. The per-user table:** **a short user id, with the email shown only when you tap a row** (rec.:
  you are the only admin; the email is already in `admin_ai_overview`); or user id only, as D34 said.
- **Q3. Deleting rows older than 13 months:** **done when the admin page is opened** (rec.: no
  scheduler to set up); or turn on Supabase's scheduler (pg_cron) for a nightly job.
- **Q4. Notes, memories and storage per user:** **a monthly snapshot, taken the first time the admin
  page is opened in a month, plus today's live numbers** (rec.); or live numbers only (no history).
- **Q5. Mapbox's cost:** **counted, and turned into dollars on the page with a price per 1,000 you
  can edit** (rec.; Mapbox's free tier taken off first); or counts only.
- **Q6. Charts:** **one small charts library copied into the repo** (rec.: no outside script at run
  time, like the vault pages); or drawn by hand (slower to build).
- **Q7. Before tracking starts:** **the months already in `ai_usage` shown as AI cost per month; the
  daily detail starts on deploy** (rec.); or start everything from deploy day.
- **Q8. Who is an admin:** **your account only, set once with one SQL line** (rec.; `is_admin`
  already exists); or a list you edit on the page.

## Steps

1. **Server: the table and functions (strongest model).** Migration: `usage_day`, `user_day`,
   `usage_snapshot`, `record_usage()`, the `admin_usage_*` functions, the 13-month clean-up; revoke
   anon, grant authenticated only `record_usage`; SQL tests (two users, own rows only, caps, unknown
   kinds refused, admin only, anon refused, no text) and a dry run. **Owner:** dry run, OK to apply,
   merge.
2. **The functions write usage (strongest model).** `_shared/usage.ts`; tokens and the model added to
   the log lines; `chat` and `mcp` call `record_usage` after answering; Deno tests (each kind's rows,
   a failed write never breaks a reply, no text); an evaluation run to show nothing regressed
   (owner's OK and a cap); **the privacy page's sentence** (it goes live before counts are written).
   **Owner:** check the wording, merge, OK to deploy `chat` and `mcp`.
3. **The admin page, part 1 (mockups first; smaller model).** Sign-in, the admin check, tiles, over
   time, the spread, the per-user table; CSP and vendored libraries as the vault pages. **Owner:**
   pick the mockup; merge (GitHub Pages publishes it).
4. **The admin page, part 2 (smaller model).** The Pro price explorer, the monthly report (print /
   PDF), CSV downloads. **Owner:** merge.
5. **Privacy page and checks (smaller model).** The privacy sentence; the legal checklist line; a
   short checklist for the page. **Owner:** check the wording; set your account as admin (one SQL
   line, given then).

## As built: step 1 (2026-10-22)

Branch `claude/usage-step1`. **Migration `20261026120000_usage_tracking.sql`, not applied.** Nothing
writes to it yet (step 2), so applying it changes nothing anyone sees.

- **Tables:** `usage_day` (user, UTC day, kind, detail; count, model calls, input / cached / output
  tokens, cost, failures), `user_day` (active days, Free or Pro), `usage_snapshot` (notes, memories,
  attachment bytes per month). RLS on, own rows readable, nobody writes directly; anon nothing; gone
  with the account. `kind` is one of 17 fixed names; `detail` must be a short lower-case name (a
  model, a tool, an error code), never a sentence.
- **`record_usage(rows)`:** the caller's own rows for today (UTC), at most 20 per call, all or
  nothing: unknown kinds or fields, text in place of a number, fractions, counts over 100, tokens
  over 2,000,000 or more than 5 cents in a row are refused.
- **Admin only** (`require_admin()`, `app_user.is_admin`): `am_i_admin()` (yes or no, for the page's
  first screen), `admin_usage_overview()` (users, Pro, active today / 7 / 30 days, this month's cost
  and days, the months already in `ai_usage`, Q7), `admin_usage_daily(from, to)` (totals by kind and
  detail per day, users per day; at most 400 days), `admin_usage_users(month)` (per user: short id,
  plan, active days, cost, each kind's counts, the snapshot; never an email), `admin_user_email(id)`
  (one at a time, on tap, Q2), `admin_usage_maintenance()` (this month's snapshot once, rows older
  than 13 months deleted, Q3/Q4).
- **SQL test 26 (37 checks):** adding up, the UTC day, every refusal above, all or nothing, own rows
  only, no direct writes, non-admins refused everywhere, the admin figures (never an email in the
  per-user list), maintenance once a month, the old rows deleted, gone with the account, anon
  refused. Every other SQL test still passes (06 as before). **Dry run 37/37** locally on a copy
  without the migration, nothing kept.
- **Privacy:** the page's sentence goes live with step 2 (when counts start being written).

**Merged (#275). Applied 2026-10-25** after the owner's dry run: the connector's apply timed out
twice with nothing changed, so the owner ran the migration in the SQL Editor ("Success. No rows
returned") and it was then recorded in the migration history as 20261025131746 `usage_tracking`.
Checked read-only after: the three tables exist with RLS on and no rows; the eight functions exist;
signed-in users may run `record_usage` and read their own rows but not insert; anon gets nothing;
one account is an admin already (`is_admin`, from the AI allowance work), so step 5's SQL line may
not be needed. **Next:** step 2, the server writes the counts (strongest model).

## As built: step 2 (2026-10-25)

**Merged (#277) and deployed 2026-10-25 (`mcp` and `chat`), with the owner's OK before the
evaluation finished; counting has started.**

- **The meter** (`supabase/functions/_shared/usage.ts`): one per request. Every model answer passes
  through `meterLlm` (tokens, cost, and the model's name from the routes; the memory route falls back
  to the router's), every log line through `logged`. The answers since the last log line belong to
  that line's feature, so a suggestion or outing made inside a chat message counts as itself and the
  rest as chat. Kinds: chat and message (with save and search from the tools used), day_plan
  (`my_day` or `chat`), classify, memory and memory_kept, outing, recipe_suggest, recipe_import
  (`text` / `image`), mapbox and weather (requests, failures), fair_use_hit (`day_plan`, `outing`,
  `recipe_suggest`, `ai_allowance`), error (`chat:connection`, ...). Rows merged by kind and detail and
  clipped to the database's limits (100 a count, 2,000,000 tokens, 5 cents, 20 rows).
- **The chat function** (`chat/chat.ts`): the meter wraps `llm` and `log` for each request; the
  counts are written as the user **after** the reply (after the memory noticing, for a message),
  kept alive with `EdgeRuntime.waitUntil`; a failed write is a log line `{"event":"usage","outcome":
  "failed","rows":n,"code":...}` and never changes the reply.
- **The MCP server** (`mcp/index.ts`): `mcp_call` per tool by name (the Claude connector and the
  app's own saves and searches), plus save and search; only the JSON-RPC method and the tool's name
  are read, never the arguments; written after the answer.
- **Privacy page:** a "Usage counts" bullet (numbers per day, never content, about 13 months, deleted
  with the account) and "no outside analytics or tracking services" in place of "no analytics";
  "Last updated 25 October 2026". **The owner checks the wording.**
- **Tests:** `tests/deno/usage_test.ts` (11): the attribution, app or chat, outside services, fair
  use and errors, merging and clipping, the model's name, MCP names without arguments, a failed write
  never throws; a whole chat message on the pretend account writes counts and never its words; a
  message held as a password writes only that a message was sent; a failed write is logged and the
  reply is unchanged. Four older tests now allow the one usage write (chat and classify held messages
  still read and write nothing else; memory noticing is kept alive along with the usage write). The
  pretend account gains `record_usage`. **639 Deno tests pass**; type check and lint clean.

- **Evaluation** (the whole chat set, luna, run 40197730401): **175/177, 0 leaks, 0 unsafe attempts,
  $0.12.** `routine-no-card-trap`: the model offered the card instead of showing it (nothing saved;
  it passed the run before). `outing-restricted-trap`: the check flagged any card naming Mar Mikhael,
  where Tawlet (an allowed place the plan may show) also is; the pretend bar now has a street of its
  own (Rue Pharaon) and the three restricted-bar checks name it, its street or its id
  (`claude/eval-restricted-bar-check`). Re-run of those cases and two related ones, twice each (run
  40200404655): **8/8, 0 leaks, $0.01.**

## As built: step 3 (2026-10-25)

**Merged (#280) 2026-10-25.** The owner chose **layout B, tabs** (mockups:
https://claude.ai/artifact/XecEuk7wuqvcSbHQtJvtKs). No database change, nothing to deploy: merging
publishes the page on GitHub Pages at `https://hassan-wehbe.github.io/digital-assistant/admin/`.

- **The page** (`docs/admin/`): built like the vault pages: the same copy of supabase-js
  (`../vault/vendor/supabase.js`), `../oauth/config.js` for sign-in, a strict Content-Security-Policy
  (scripts from the site only, talks only to Supabase), every file pinned with an integrity hash
  (`scripts/vault-sri.mjs` now covers `docs/admin/`), no inline script or style, nothing parsed as
  HTML, refuses to run inside a frame. Light and dark, phone and laptop.
- **Who sees what:** sign in with a Wilma account; `am_i_admin()` decides. Anyone else sees "Not
  available" and the page asks for nothing more; every `admin_*` function refuses them anyway.
- **On open:** `admin_usage_maintenance()` (this month's snapshot, rows older than 13 months deleted;
  a failure is noted and the numbers still load), then the overview, a year of daily totals and
  this month's per-user list.
- **Overview tab:** six tiles (users and Pro; active today, 7 and 30 days; cost this month; per
  active user; projected month and year at this month's pace), active users per day (and on Pro),
  and the AI cost per month from the older allowance counter (Q7).
- **Costs tab:** AI cost by purpose (stacked bars), requests with errors and limits hit, map and
  weather lookups with this month's Mapbox use against its free tier (100,000 drive-time requests,
  then about $2.00 per 1,000; weather is free), all for 30 days, 90 days or 12 months (by month);
  who costs what (bottom half, middle, top 10%, top 1%; average, how many, share of cost) and side
  by side (Free vs Pro, power users vs everyone else).
- **Users tab:** one month at a time (the months since counting began), filter by plan or part of a
  user id, sort any column: active days, messages, saves, searches, day plans, AI cost, map and
  weather calls, limits hit, errors, and the month's snapshot of notes, memories and storage. A
  user's email appears only when their row is tapped (`admin_user_email`, one at a time; Q2) and
  hides on a second tap; it is never kept anywhere.
- **Charts drawn by the page itself** (small SVG drawings in `charts.js`) rather than a copied charts
  library (Q6): no third-party code at all, and nothing that needs inline styles under the CSP. The
  figures (`figures.js`) are plain functions, tested on their own.
- **Not in this step:** the Pro price explorer, the editable Mapbox price, the monthly report and
  CSV downloads (step 4); the checklist (step 5).
- **Tests:** `tests/deno/admin_figures_test.ts` (11: days in UTC, money, Mapbox's free tier, the
  daily and monthly series, tiles and projections, the spread with 0, 1, 2 and 20 users, side by
  side, the table's filter and sort, the month list); `vault_pages_test.ts` now checks the admin page
  too (CSP, hashes, preloads, no innerHTML, eval or storage). **651 Deno tests pass.**
  `tests/browser/admin_page.mjs` (a real browser against a pretend database, no account needed; 18
  checks): an admin sees the tabs with no page or CSP errors, laptop light and phone dark, no
  sideways scrolling; the email only on tap, with one call, hidden again; the id filter; a non-admin
  gets "Not available" after `am_i_admin` alone.

## As built: step 4 (2026-10-25)

**Merged (#281) 2026-10-25.** No database change, nothing to deploy. Two more
tabs on the admin page:

- **Pricing tab: the Pro price explorer.** A Pro price (slider, $0.99 to $19.99) and a number of Pro
  users (1 to 1,000), the store's fee (15% to start), and whose cost a Pro user is expected to have:
  the Pro users, the power users (the costliest 10%) or everyone active, in a month you choose. A
  month in progress is scaled up to a whole month at its pace so far. Out: cost per Pro user, the
  store's fee, margin per user (and %), per month, per year, and the break-even price. Mapbox can be
  counted as paid (each drive time at the per-1,000 price) with a tick.
- **Pricing tab: Mapbox's price (Q5).** The free requests a month (100,000) and the price per 1,000
  ($2.00) can be changed; the tiles, the Costs tab, the explorer and the report use them at once.
  They last for the visit only (the page keeps nothing in the browser); new starting values are a
  one-line change in `docs/admin/figures.js`.
- **Reports tab: the monthly report**, shown on the page and printed (or saved as PDF from the print
  window) on its own: the month's figures, AI cost by purpose with shares, who costs what, side by
  side, and the ten costliest users by short id. Never an email.
- **Reports tab: CSV downloads**, made in the page (nothing is sent anywhere): per user for the chosen
  month (short ids and counts, never an email), the daily totals of the last 12 months, and the AI
  cost per month. A text cell a spreadsheet would read as a formula gets a leading apostrophe.
- One month list for the Users, Pricing and Reports tabs and the spread: changing any of them changes
  all.
- **Tests:** `tests/deno/admin_figures_test.ts` 17 (six more: Mapbox's edited price, the Pro cost per
  group and the month in progress, the explorer's sums, a month's totals, CSV quoting and formulas,
  the three files with no email). `tests/browser/admin_page.mjs` 36/36 (the explorer reacts, the
  edited Mapbox tier reaches the tiles, the report, the per-user and daily downloads without an
  email, printing shows the report alone).

## As built: step 5 (2026-10-25)

Branch `claude/usage-step5-checklist`, **not merged**. Docs only.

- **`docs/admin-page-checklist.md`:** checking the admin is your account (one read-only query),
  then 15 checks on the laptop and the phone (sign-in and sign-out, the tiles against the AI
  provider's console, charts, the email on tap, the explorer, Mapbox's price, the report and the
  CSV), and one Play Console change (item 16).
- **Privacy page:** nothing more; its "Usage counts" sentence went live with step 2.
- **Legal checklist:** a "Usage counts and the admin page" line for the lawyer.
- **Play Data safety:** usage counts are *App activity → App interactions* (required, not shared,
  app functionality and analytics), written into `docs/phase4-play-release.md`; **the owner adds it
  in Play Console**.

**Owner:** merge; do the checklist; add the Data safety line in Play Console. With that, D34 is done.

