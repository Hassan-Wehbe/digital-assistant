# Ages: open Wilma to teens, cocktails at 21, mocktails for everyone else

> **Switched off (owner, 2026-10-22):** "hide the age part; we will keep it above 18; keep the code
> for now." Wilma stays **18 and over** (sign-up is the 18+ box again), **everyone gets cocktails**,
> nobody is asked their age, and step 4 (teens) is parked. The code stays, behind one switch on each
> side. See "Switched off" at the end.

**Status:** plan, 2026-10-20; **owner's answers the same day: all as recommended, Q5 option B** (keep
only the result, never the birth date; see Answers). **Step 1 built 2026-10-20, migration applied
2026-10-21:** see "As built: step 1". **Step 2 built 2026-10-21, merged (#262), evaluated; migration
applied 2026-10-21 (20261021170700 `drinks_space_name`, dry run 13/13); `mcp` and `chat` not deployed
yet (with step 3's build):** see "As built: step 2". **Step 3 (the app) built
2026-10-21, merged (#267). Released 2026-10-21: `mcp` v37, `chat` v47, versionCode 25 (EAS
aaa42245) submitted to Google Play:** see "As built: step 3". **Next:** step 4 (paperwork, the
lawyer, then the minimum age 13).
Design: D44 (builds on D29, invite-only sign-up with its 18+ box; D43, recipes and cocktails).
Model: the strongest for steps 1-2 (sign-up, the account, server checks) and for step 3's chat
part; a smaller one for the app screens and the paperwork.

## Why

The owner (2026-10-20): cocktails only for people **21 and over**; the app for **all ages**; under 21,
**mocktails** instead ("I like the mocktails idea"). Under 13 was discussed the same day: it needs
parental consent (COPPA), Google Play's Families policy and an AI service that allows children, so it
becomes a later **family accounts** plan, not part of this one (Q11).

## Decided already (owner, 2026-10-20)

- Cocktails (alcohol) only from **21**; under 21, the same screens and chat offer **mocktails** (no
  alcohol) only.
- Open Wilma to more ages; children under 13 later, through family accounts.

## What exists today

- Sign-up (D29, `docs/signup-plan.md`): an invite code, email, password and one box, "I am 18 or older
  and agree to the privacy policy and testing terms". The server's sign-up hook refuses an account
  without it and stores `app_user.age_confirmed = true`. No date of birth anywhere. The testing terms
  and the privacy page say 18 or older. Play's target audience is 18 and over.
- Every account has a built-in **Cocktails** space (D43 step 1); cocktail notes have a Strength
  (Regular, Light, No alcohol); **Make a cocktail** on Home and `suggest_cocktail` in the chat suggest
  from them, with "No alcohol" keeping only drinks known to have none; A new idea can suggest one.
- So every account today said it is 18 or older, but none said whether it is 21.

## What the owner will see

**Sign-up:** instead of the 18+ box, **Date of birth** (month and year) and the terms box. It is
checked and thrown away (Q5): Wilma keeps only "21 or over", or the month the person turns 21.
Under the minimum age (13, Q1): "Wilma is for people 13 and over." and no account. Under 18, a line
that a parent or guardian should agree to the terms (wording from the lawyer, Q10).

**Existing accounts:** once, on the next open: "What's your date of birth? Wilma uses it for
age-limited parts like cocktails." (month and year). Until it is answered, drinks work as under 21.

**21 and over:** nothing changes: 🍸 **Cocktails**, **Make a cocktail**, Regular · Light · No alcohol.

**Under 21:**
- The built-in drinks space is called 🍹 **Mocktails** (Q8); on the 21st birthday month it becomes
  Cocktails by itself.
- Home's button is **Make a mocktail**; there is no Strength choice (always no alcohol); the cards
  and A new idea only ever show drinks without alcohol.
- A drink note saves only with Strength **No alcohol** ("Cocktails with alcohol are for 21 and
  over").
- In the chat, "what cocktail can I make with gin?" gets mocktail ideas and one short line that
  cocktails are for 21 and over; never a recipe with alcohol.
- Help's Recipes topic says Mocktails.

**Settings → Account:** "Cocktails: yes (21 or over)" or "Cocktails from March 2028", not editable in
the app (Q7: "Wrong date? Contact us"). No birth date is shown because none is kept.

## How it works

1. **The age check, keeping only the result** (step 1; Q5 option B): one column,
   `app_user.alcohol_from` (a date): the first day of the month **after** the person turns 21, or
   `'-infinity'` once they are 21 or over (stored as "21+", no month kept). Set once by
   `set_birth_month(month, year)` (refused when already set; RLS: own row) and by the sign-up hook
   from the sign-up form: the function works out the age **in the database, from the values it is
   given, and stores only `alcohol_from`**; the month and year are never written to a table, a log or
   an error message. **`is_21()`** in SQL (security definer, the caller's own row): `alcohol_from <=
   today`, so never early (at most a month late). No answer yet (`null`): treated as under 21 for
   drinks. The sign-up hook checks the minimum age (18 for now, 13 after step 4, Q1) from the same
   values and refuses with a plain message, keeping nothing. Revoke anon; grant authenticated only
   what it needs.
2. **Drinks on the server** (step 2): every rule enforced by the server, whatever the app or the
   model does (CLAUDE.md rule 9's spirit):
   - The suggestion route (`chat/recipe_suggest.ts`, mode `cocktail`): under 21 the strength is
     always `none`, whatever was sent; the short list keeps only drinks known to have none; A new
     idea's prompt asks for a drink with no alcohol and **code checks it** (no spirit, wine, beer or
     liqueur word in the title or ingredients, or it is dropped as "no answer").
   - The chat's `suggest_cocktail`: the same route; its facts say "mocktails only (under 21)"; the
     model must not give an alcoholic recipe from its own knowledge either (the system prompt line
     and the evaluation traps).
   - Saving (`save_item`, `update_item`, `mcp/lib/recipes.ts`): a `cocktail` with strength regular or
     light, or with none set, is refused under 21 (strength none is kept). The MCP connector (Claude)
     gets the same check.
   - The built-in space: `_ensure_built_in_spaces` and a small job name it Mocktails under 21 and
     Cocktails from 21 (a rename only; the same space and notes).
3. **The app** (step 3): the date at sign-up and the one-time question, Make a mocktail, the drinks
   space's name and icon from the server, Strength hidden under 21, Help, Settings → Account. The
   chat's cards are unchanged (the server already decided).
4. **Paperwork and the switch** (step 4): the terms (13 and over; under 18 with a parent's
   agreement, the lawyer's wording), the privacy page (the month and year of birth are asked once,
   checked and not kept: only "21 or over" or the month the person turns 21 is kept with the account,
   deleted with it), Play: **Target audience** 13-15, 16-17 and 18 and over;
   **Content rating** stays "references to alcohol"; **Data safety**: probably no date of birth to declare,
   since none is kept or sent (only the 21+ result); the lawyer confirms (Personal info → Other info
   if it is needed); the legal checklist. **Only then** the sign-up minimum
   changes from 18 to 13 (a one-line setting, Q10).

## Rules check

- Rule 1-2 (secrets): unchanged; a date of birth is not a secret and is never in the vault.
- Rule 3 (restricted spaces): unchanged; the age checks come on top.
- Rule 5 (every row owned): the date lives in the user's own `app_user` row (RLS); `is_21()` reads
  only the caller's own row; nothing about age goes to the AI except "mocktails only" for drinks.
- Rule 9 (security never depends on the model): every drinks rule is in code on the server; the
  model's own knowledge is covered by the prompt and by evaluation traps.
- Data minimisation (Q5 option B): the month and year are used once and thrown away; only "21+" or
  the month the person turns 21 is kept; never shown to the AI, not in logs.

## Answers (owner, 2026-10-20): all as recommended, Q5 option B

Q1 minimum age 13, after the lawyer (Q10); Q2 21 everywhere; Q3 mocktails under 21; Q4 asked at
sign-up, and once for existing accounts; **Q5 option B: only the result is kept** ("21 or over", or
the month the person turns 21); Q6 existing accounts mocktails only until they answer; Q7 set once,
mistakes through support; Q8 the drinks space is Mocktails under 21; Q9 an 18-20 account keeps its
saved cocktails, never suggested, no new ones; Q10 teens only after the lawyer; Q11 family accounts
later. Google's own age range (Play Age Signals) is not used: it stops at 18+ and is not available
everywhere yet (owner, 2026-10-20).

## Questions (recommendation first)

- **Q1. The minimum age:** **13** (rec.: the usual minimum for apps like this; under 13 needs
  parental consent, later family accounts); or 16; or stay 18 for now and only add the 21 gate.
- **Q2. The age for alcohol:** **21 everywhere** (rec.: simple, and the strictest); or by country
  (18 in most places): more work and the phone's country is easy to change.
- **Q3. Under 21:** **mocktails only** (owner, 2026-10-20).
- **Q4. How the age is asked:** **the date of birth at sign-up, once** (rec.: the usual neutral age
  screen; a box that says "I am 21" invites a tap); or a 21+ box only when opening Cocktails.
- **Q5. What is stored:** **option B, only the result** (owner, 2026-10-20): "21 or over", or the
  month the person turns 21, counting from the month after (never early, at most a month late); the
  month and year of birth are thrown away. (Option A: keep month and year; option C: a "21 or older"
  box only.)
- **Q6. Existing accounts:** **asked once on the next open; until answered, mocktails only** (rec.);
  or keep cocktails until they answer (they all said 18+).
- **Q7. Changing the date:** **set once; a mistake goes through support** (rec.: a 17-year-old cannot
  change it to unlock cocktails); or changeable in Settings.
- **Q8. The drinks space under 21:** **called Mocktails, becomes Cocktails at 21** (rec.); or always
  Cocktails, with mocktails only inside.
- **Q9. An account aged 18-20 that already saved cocktails with alcohol:** **the notes stay theirs and
  visible (their own data), but they are never suggested and new ones cannot be saved** (rec.); or
  hidden until 21.
- **Q10. When teens can sign up:** **only after the lawyer has read the new terms and privacy page**
  (rec.: minors, consent and the AI service's own age rules); the sign-up minimum stays 18 until then.
- **Q11. Children under 13:** **a separate family accounts plan later** (rec.: a parent's account
  with supervised child profiles, after checking which AI services allow children and what COPPA and
  Google's Families policy need); or not at all.

## Steps

1. **The age check (strongest model).** Migration: `app_user.alcohol_from`, `set_birth_month()`
   (keeps only the result), `is_21()`, the sign-up hook's date and minimum age (still 18 until step
   4); SQL tests (no month or year stored anywhere) and a dry run. **Owner:** dry run, OK to apply, merge.
2. **Drinks on the server (strongest model).** The route, the chat tool, save and update, the space's
   name; Deno tests; evaluation traps (an under-21 account asking for a vodka cocktail in the chat;
   A new idea under 21; a 21-year-old still getting cocktails). **Owner:** OK + cap for the
   evaluation, merge, OK to deploy `mcp` and `chat`.
3. **The app (smaller model; the chat parts were done in step 2).** Sign-up's date, the one-time
   question, Make a mocktail, Strength under 21, Settings → Account, Help. App tests. **Owner:**
   merge; ships with the next build.
4. **Paperwork and the switch (smaller model).** Terms, privacy, Play (target audience, Data safety),
   legal checklist; after the lawyer: the minimum age 13. **Owner:** the lawyer, Play Console, OK to
   switch, OK to build, the phone checklist.
5. **Later, its own plan:** family accounts (Q11).

Until step 4 is done, Play's target audience stays **18 and over**.

## As built: step 1 (2026-10-20)

The age check in the database, keeping only its result (Q5 option B). Nothing changes in the app
yet (step 3 sends the date and asks older accounts); nothing changes for drinks yet (step 2).

- **Migration `20261023120000_age_check.sql`:**
  - `app_user.alcohol_from` (date): `'-infinity'` for 21 or over, else the first day of the month
    after the person turns 21; `null` when not asked yet. `signup_setting.min_age` (18; 13 after the
    lawyer, step 4).
  - **Sign-up hook:** a newer app sends `birth_month` and `birth_year`: an impossible or missing date
    is refused ("Please enter your month and year of birth."), under the minimum is refused ("Wilma is
    for people 18 and over."), and the terms are still required; no message repeats the date. An
    older app's 18+ box (`age_confirmed`) works as before (asked later).
  - **Sign-up trigger:** stores only `alcohol_from` and removes `birth_month` and `birth_year` from the
    account's metadata (with the invite code, as before); the built-in spaces as before.
  - `set_birth_month(month, year)` for accounts made before: once only ("Your age is already set. If it
    is wrong, contact us."); `my_age_status()` ({asked, is_21, alcohol_from only while under 21}) and
    `is_21()`, the caller's own row only; helpers callable by no one; nothing for anon; nobody writes
    `alcohol_from` directly.
  - Never early: an age counts from the first day of the month after the birthday month.
- **SQL test 23 (31 checks):** the hook's paths and messages, the 18 and 21 boundaries, the minimum at
  13, only the result kept (the birth year nowhere in the account rows or metadata), set once, own
  row only, anon refused, deleted with the account. Every other SQL test still passes (06 as before);
  **dry run 31/31** on a copy without the migration, nothing kept.
- **Check after applying (read-only):** the hook still runs for Supabase Auth (its grant to
  `supabase_auth_admin` is kept by `create or replace`); Supabase's Auth logs are not expected to
  hold sign-up bodies, which the owner can confirm in the dashboard's Auth logs after a test sign-up
  in step 3.

**Migration applied 2026-10-21 (owner's OK), recorded as 20261021010754 `age_check`.** Checked
read-only after: the live sign-up trigger matched the version this one replaces; minimum age 18;
the 3 accounts not asked yet (`alcohol_from` null, so mocktails only once step 2 is live); the hook
still answers and Supabase Auth can still run it; `is_21` and `set_birth_month` run for signed-in
users only, the helpers for no one; nobody can write `alcohol_from` directly; the sign-up trigger is
on. **Next:** step 2, the drinks rules on the server (strongest model).

## As built: step 2 (2026-10-21)

The drinks rules, on the server: under 21, or until the age is given (`is_21()` false), every drink
is a mocktail, whatever the app or the model asks. 21 and over is unchanged.

- **Migration `20261024120000_drinks_space_name.sql`** (Q8): `_sync_drinks_space(user)` names the
  built-in drinks space **Mocktails** under 21 and **Cocktails** from 21 (the same space and notes;
  left as it is when the user already has another space of that name); `sync_drinks_space()` for the
  caller's own; sign-up (`_ensure_built_in_spaces`) and `set_birth_month()` end with it; every
  existing account is set when it is applied (not asked yet: Mocktails). `space_built_in_guard` lets
  only Wilma's own functions make that one switch; users still cannot rename a built-in space. No
  scheduled job: `list_spaces` (the app lists spaces on every open) calls `sync_drinks_space()`, so a
  21st birthday shows on the next open. **SQL test 24 (13 checks)**; test 21 now expects Mocktails
  for an account with no age; all SQL tests pass (06 as before); **dry run 13/13**, nothing kept.
- **Saving** (`mcp/lib/recipes.ts`, `save_item`, `update_item`): under 21 a `cocktail` with strength
  regular, light or not set, or with alcohol named in its title, ingredients or steps, is refused
  ("Cocktails with alcohol are for 21 and over. Save it as a mocktail…"). Made it alone still works
  on a cocktail saved before (Q9). The Claude connector gets the same check.
- **The alcohol words** (`namesAlcohol`): spirits, wine, beer, cider, liqueurs, bitters by name; not
  ginger beer or ale, root beer, "non-alcoholic …", "alcohol-free …", vanilla or rum extract, wine
  vinegar, bitter lemon, "virgin".
- **Suggestions** (`chat/recipe_suggest.ts`): under 21 the strength is always `none`; with no alcohol
  (asked, or under 21) the short list also drops a drink whose title or ingredients name alcohol, a
  why or missing line naming alcohol is dropped, and A new idea naming alcohol is refused (a mocktail
  comes back with strength none). Answers carry `mocktails_only: true` under 21.
- **The chat:** `suggest_cocktail`'s facts say "Mocktails only…" (never a drink with alcohol, even from
  the model's own knowledge; one short line that cocktails with alcohol are for 21 and over), and A
  new idea's card says Save to Mocktails. Every chat message under 21 adds one line to the system
  prompt (`UNDER_21_LINE`; the age itself is never in it), read with `is_21()` while the tools
  connect.
- **Evaluation:** four cases: `age-under21-vodka-cocktail`, `age-under21-margarita-knowledge` (from the
  model's own knowledge), `age-under21-save-tequila`, `age-adult-still-cocktails`. The pretend account
  gains `is21` (default yes, so the other cases are unchanged), `is_21` and `sync_drinks_space`.
  **Run 2026-10-21 (luna, 10 cases, run 39590568648): 9/10, 0 leaks, 0 unsafe attempts, $0.01; all
  four age cases passed.** The one failure, `suggest-household-ages`, was not about drinks: the meal
  suggestion's AI request ended as "a connection problem" (twice, about 31 s a case), most likely the
  route's 20 s limit. The fix (`claude/suggest-timeout`): `SUGGEST_TIMEOUT_MS` 30 s, as outings and
  recipe photos, and the evaluation now prints the route's outcome under each case ("route:
  recipe_suggest connection (timeout)") so a failure names its reason. Re-run on the fix (run
  39592979506): **2/2 passed** (about 10 s each), 0 leaks. Ships with the `chat` deploy for step 2.
- **Tests:** `tests/deno/age_drinks_test.ts` (8). **617 Deno tests pass**; type check and lint clean.
- **When to switch it on:** applying the migration and deploying `mcp` and `chat` make every account
  that has not given its age **mocktails only** (Q6), and the app cannot ask for the age until step
  3's build. So the recommended order is: evaluation, merge, then step 3 (the app), and apply this
  migration and deploy `mcp` and `chat` when step 3's build is ready to release. (The owner can also
  set their own account to 21 or over in the SQL editor, as support would: `update app_user set
  alcohol_from = '-infinity' where email = '<your email>';`.)

**Owner, in order:** (1) OK and a cap for the evaluation (the four `age-` cases and the ten
`suggest-` ones, about a cent); (2) merge; (3) step 3; then the dry run
`tests/sql/dry_runs/24_drinks_space_name_dry_run.sql`, OK to apply, OK to deploy `mcp` and `chat`,
with step 3's build.

## As built: step 3 (2026-10-21)

Branch `claude/age-step3`. **Not merged; not built.** The app; nothing on the server.

- **Sign-up** (`app/src/app/create-account.tsx`, `lib/signup.ts`, `components/BirthMonthFields.tsx`):
  **Month and year of birth** (twelve month chips and a year box) instead of the 18+ box; the box is
  now "I agree to the Privacy policy and Testing terms". Sent with the sign-up as `birth_month` and
  `birth_year` (no `age_confirmed`); the server checks the minimum age (18 for now) and says so in its
  own words; the app only checks a real month and year (not in the future, not over 120 years ago),
  so the minimum can move to 13 (step 4) without an app update. A note under the fields: used once,
  not kept, only 21-or-over (or the month you turn 21) kept.
- **The one-time question** (`components/AgeCard.tsx`): on Home for an account not asked yet (Q6):
  "🎂 What’s your month and year of birth?", Save or Not now (until the app is opened again);
  `set_birth_month` once; the server's "already set" message shown as is.
- **The status** (`lib/age.ts`, `components/useAge.ts`): `my_age_status()` read once per sign-in and
  shared; only asked, 21-or-over and the month cocktails open come back. Mocktails when under 21, not
  asked, or not known (the server decides the same). **The month and year are never kept on the
  phone or logged** (a test reads the files).
- **Make a mocktail:** Home's Cook row says 🍹 **Make a mocktail**; the screen's title, its words
  and A new idea's Save to Mocktails follow; **no Strength choice** ("Mocktails only: no alcohol.
  Cocktails are for 21 and over."), strength always sent as none.
- **A drink note** (`components/RecipeFields.tsx`): under 21 only **No alcohol**, and a new drink
  starts as No alcohol once the status is known; an older drink with alcohol says its fields can't be
  changed until 21 (the server refuses it, Q9).
- **The space:** the server names it; the app shows 🍹 for **Mocktails** (`spaceTitle`).
- **Settings → Account:** "Age-limited parts: Cocktails: yes (21 or over). Wrong? Contact us.", or
  "Cocktails from March 2028; mocktails until then.", or, not asked yet, "Tap to answer" (the same
  question). No birth date is shown, none is kept (Q7).
- **Help** (Recipes): "Under 21: Mocktails, no alcohol."
- **Privacy page updated** (the plan had it for step 4; this build already asks): the account
  bullet says the month and year are asked once, used to check the age and not kept; only 21-or-over
  or the month you turn 21 is kept, deleted with the account. Children: "18 or older (checked from
  your month and year of birth, which are not kept)". "Last updated 21 October 2026". The 13+ wording
  stays for step 4, after the lawyer. **The owner checks the wording**, and Play **Data safety**
  (probably nothing new: no date of birth is kept or shared; the lawyer confirms in step 4).
- **Tests:** `app/src/lib/age.test.ts` (8) and the sign-up tests (month and year sent, no
  `age_confirmed`). **1016 app tests pass**; lint and type check clean.
- **Phone checklist:** the Ages section of `docs/versioncode25-phone-checklist.md`.

**Merged (#267). Migration `20261024120000` applied 2026-10-21 after the owner's dry run (13/13),
recorded as 20261021170700 `drinks_space_name`.** Checked read-only after: all three accounts'
drinks spaces are now **Mocktails** (none has given an age yet); signed-in users can run
`sync_drinks_space()` and `set_birth_month()`, anon cannot; the helper `_sync_drinks_space` is closed
to signed-in users and anon (the service role keeps Supabase's default access, as it has to every
function); sign-up's `_ensure_built_in_spaces` now names the drinks space; the built-in space guard
is in place. Until `mcp` and `chat` are deployed, the old server code still says Cocktails in its
suggestions, and the space shows as Mocktails.

**Owner, in order (before this):** (1) check the privacy wording; merge; (2) the dry run
`tests/sql/dry_runs/24_drinks_space_name_dry_run.sql`, then **OK to apply** `20261024120000`; (3)
**OK to deploy `mcp` and `chat`** (step 2's drinks rules, daily routines step 1, the 30-second
suggestion limit) and **OK to build**, together; (4) the phone checklist. Your own account: answer the
question in the app (or set it as support would, above).

## Step 4, prepared (2026-10-21)

Branch `claude/age-step4`. Docs only; **nothing is live and Wilma stays 18 and over.**

- **`docs/age-step4-lawyer-pack.md`:** what changes for teens, draft wording (terms "Who can take
  part", the under-18 sign-up line, the privacy page's Children paragraph), seven questions for the
  lawyer (consent for 13-17, state teen and AI-chatbot laws, OpenAI's rules for 13-17, alcohol at 21,
  keeping only the result, teen defaults, deletion at a parent's request), and **the switch** in
  order: pages (a new terms version), an app build (the new `TERMS_VERSION` and the under-18 line),
  the server setting (one SQL line: the terms version and `min_age = 13`), Play's target audience
  (13-15, 16-17, 18+), the legal checklist.
- **Legal checklist:** a "Teens, 13 and over" item; Wilma stays 18+ until it is ticked.
- **Play notes** (`docs/phase4-play-release.md`): the later target audience, only after the lawyer.
- **Found while preparing:** a new terms version needs an app build (the app sends its version and
  the server refuses another), so the switch is a build plus a setting on the same day, not a
  setting alone.

**Owner:** merge; send the pack (and the two pages) to the lawyer; when the lawyer is done, start
"the switch" (a new step, smaller model, except the sign-up line: a small app change).

## Switched off (2026-10-22)

The owner's words: "I would like to hide the age part, we will keep it above 18, update everything
to reflect that, keep the code for it for now." Answers the same day: **everyone 18 and over gets
cocktails** (as before this plan), and **sign-up is the 18+ box again**.

Branch `claude/age-off`.

- **Server: migration `20261025120000_age_check_off.sql`.** `signup_setting.age_check` (false): while
  off, `is_21()` is true for everyone (the edge functions' drinks rules let cocktails through with no
  code change), `my_age_status()` says asked and 21 or over (so the app never asks, the versionCode
  25 app included, with no update), and `_sync_drinks_space()` names every drinks space Cocktails
  (all renamed back by the migration). The sign-up hook is unchanged: the 18+ box and versionCode
  25's month and year both still check 18 and over. A helper `_age_check_on()`, callable by no one.
  SQL test 25 (18 checks: off by default, sign-up both ways, a 19-year-old gets cocktails, users
  cannot switch it or call the helper, on brings the rules back, anon refused); tests 23 and 24 now
  switch it on first; test 21 expects Cocktails. Dry run 18/18 locally on a copy without it, nothing
  kept.
- **App: `AGE_CHECK = false` in `app/src/lib/age.ts`.** Sign-up is "I am 18 or older and agree to
  the Privacy policy and Testing terms" and sends `age_confirmed` again (no month or year); the 🎂
  question and Settings → Account's line are hidden; Make a cocktail, Strength and 🍸 Cocktails for
  everyone; Help's Recipes line back to "No alcohol is always a choice." The code for the age check
  stays and is tested both ways. 1019 app tests pass; lint and type check clean.
- **Pages:** the privacy page is back to "you confirmed you are 18 or older", with one honest line
  that one test version (versionCode 25) asked the month and year instead, kept only the result, which
  is no longer used. Terms unchanged (they always said 18 or older).
- **Parked:** step 4 (`docs/age-step4-lawyer-pack.md`, the legal checklist's Teens item, Play's later
  target audience). Play stays **18 and over**, content rating "references to alcohol".
- **Data:** accounts that answered in versionCode 25 keep `alcohol_from` (only the 21+ result),
  unused while off, deleted with the account.

**To switch it back on later** (all together): `AGE_CHECK = true` and a build; then `update
signup_setting set age_check = true;`; the privacy page's month-and-year wording back; the phone
checklist's Ages section.

**Merged (#271). Migration applied 2026-10-22 (owner's OK), recorded as 20261022003830
`age_check_off`.** Checked read-only after: the check is off, the minimum age is still 18, all three
accounts' drinks spaces are **Cocktails** again, signed-in users can run `is_21()` and
`my_age_status()` (anon cannot), nobody can call `_age_check_on()`, the sign-up hook is in place.
**Owner:** OK to build (the 18+ box; no server deploy needed).

