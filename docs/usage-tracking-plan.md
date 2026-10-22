# Usage tracking and the admin page (D34)

Status: plan, 2026-10-22; **owner's answers the same day: all as recommended** (Q1-Q8 below).
**Step 1 built 2026-10-22, branch `claude/usage-step1`, not merged, migration not applied:** see
"As built: step 1". Design: D34 (decided
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

**Owner, in order:** (1) merge; (2) the dry run
`tests/sql/dry_runs/26_usage_tracking_dry_run.sql`, then OK to apply. **Next:** step 2, the server
writes the counts (strongest model).

