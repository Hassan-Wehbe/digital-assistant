# Registration: invite-only sign-up and in-app account deletion (plan, stage 1)

Status: **plan, approved** (owner, 2026-10-07: Q1-Q8 all as recommended; see Decisions). Not built.
**Order (owner, 2026-10-07): after day planner step 1, the phone's calendar**
(`docs/phase6-day-planner-step1-plan.md`); until then the owner creates testers' accounts by hand. Design entry:
`docs/design.md` D29. Nothing is built. Stage 2 (open sign-up, Google and Apple sign-in) is
at the end and waits for the company account and the legal review (D27).

**Which model builds this:** the strongest one for steps 1-3 (auth, a database hook, deleting
accounts); a smaller one (Sonnet) for step 4's copy, step 5 and docs.

## Today

- Sign-ups are closed; the owner creates each tester's account in Supabase.
- New sign-ins get an `app_user` row from the trigger `on_auth_user_created`
  (`20260928120100_knowledge_path.sql`), with the default AI allowance (D22).
- Account deletion is by email (`docs/legal/delete-account.html`); there is no in-app way yet.

## What the owner and testers will see

1. **Sign-in screen → "Have an invite? Create account."**
2. **Create account:** invite code, email, password (twice), a checkbox "I am 18 or older and
   agree to the Privacy policy and Testing terms" (links), **Create account**.
3. An email "Confirm your Wilma account". Tapping the link opens the app (or a confirmation page
   on the web) and signs the tester in.
4. **Welcome** (first sign-in only): what Wilma does in three lines, "What should I call your
   assistant?" (default Wilma, `set_assistant_name`), and **Set up your vault** (the existing
   vault setup; can be skipped and done later).
5. **Account screen → Delete account:** explains what is deleted (notes, files, spaces, vault,
   usage), asks for the password again and for typing DELETE, then deletes everything and signs
   out. The web page stays as a second way (Google requires a web link too).
6. **Owner:** makes invite codes (Supabase Table editor until there is an admin screen), each
   with a number of uses and an end date, and sees who used which code. A code is either a
   **normal** code (the account starts on Free) or a **Pro tester** code (the account starts on
   Pro, so the tester can use the day planner; owner, 2026-10-08).

## How it works

- **Invite codes, checked before the account exists.** Supabase's sign-ups are switched on, and a
  **before-user-created auth hook** (a Postgres function Supabase calls on every sign-up) accepts
  the sign-up only if the invite code sent with it is valid, unused up to its limit and not
  expired; otherwise the sign-up is refused and no account is created. (If the hook is not
  available on the project's plan, a small `signup` Edge Function does the same check and creates
  the user; to confirm in step 1.)
- **`invite_code` table:** `code_hash` (SHA-256 of the code, never the code itself), `note`
  ("for Sarah"), `max_uses`, `uses`, `expires_at`, `created_at`, `grants_plan` (`free` or `pro`,
  default `free`); `invite_use` (code, user, when). The hook sets the new account's
  `app_user.plan` from the code it used (`pro` for a Pro tester code), so no tester is switched
  to Pro by hand. `app_user.plan` itself comes with day planner step 2
  (`docs/phase6-day-planner-step2-plan.md`, "Premium"); if sign-up is built first, it adds the
  column the same way (users can read it, only the server and the admin set it).
  No access for `anon` or `authenticated`; only the hook and the admin.
- **Terms acceptance recorded:** `app_user.terms_version`, `terms_accepted_at`, `age_confirmed`
  (from the sign-up, written by the trigger). A new terms version can later ask again.
- **Email confirmation:** Supabase's built-in email is fine for a handful of testers but is
  rate-limited (a few emails an hour); stage 2 moves to an email service on the company's domain.
  The confirmation link points to a page on the existing site that opens the app.
- **Abuse and cost:** invite codes are the main protection in stage 1, plus Supabase's sign-up
  rate limits and email confirmation. Each account starts with the default monthly allowance
  ($1, D22) and nothing else costs money.
- **Account deletion (`delete-account` Edge Function):** the user's sign-in proves who they are
  (rule 5); the function deletes the user's files in Storage, then the auth user, which removes
  `app_user` and every owned row (the schema's `on delete cascade`). Later steps add: revoke the
  Google token (D25), credits (D28). The vault is deleted with the account; the app explains that
  this cannot be undone and that Wilma cannot recover it.

## Data (one migration)

`invite_code`, `invite_use`, the `signup_mode` setting (Q8), the hook function, the three `app_user` columns, an update to
`handle_new_auth_user` to copy terms acceptance; revokes for `anon` and `authenticated`.

## Tests to write

- SQL: a sign-up without a code, with a wrong, used-up or expired code is refused; a valid code
  counts one use; codes are stored hashed; `invite_code` unreadable by users; terms fields set.
- Deno: `delete-account` deletes only the caller's data (two-user test), refuses without sign-in
  or with a wrong password, removes Storage files.
- App: form validation (code, email, password match, checkbox), error messages, deep link.

## Steps (each a small PR; the owner approves merges, migrations and deploys)

1. Migration (codes, hook, terms fields) with a rolled-back dry run and SQL tests.
   **As built (2026-10-09, PR open):** `20261011120000_invite_signup.sql`. The Before User Created
   hook is available on the Free plan, so no `signup` Edge Function. `hook_before_user_created`
   refuses a sign-up without a valid code (wrong, expired, used up) or without `age_confirmed`
   true and the current `terms_version` (`signup_setting`, `2026-10-09`); the app sends
   `invite_code`, `age_confirmed`, `terms_version` as sign-up metadata. The sign-up trigger counts
   the use under a row lock (two sign-ups at once cannot both take the last use), sets the plan,
   records the terms and drops the code from the account's metadata. Codes read
   `WILMA-XXXX-XXXX` (8 characters, no 0/O/1/I/L), made in the SQL editor with
   `select create_invite_code('for Sarah', 1, 14, 'pro');` (note, uses, days, plan), shown once.
   `signup_mode()` is the one function anon can call. SQL test 15 (33 checks) and its dry run.
   **Owner, in this order:** dry run, apply the migration, then Authentication > Hooks > Before
   User Created > Postgres > `public.hook_before_user_created`. Sign-ups stay switched off until
   step 5 (switching them on before the hook is on would open sign-up to anyone).
2. App: Create account screen, confirmation deep link, welcome flow. Preview build.
   **As built (2026-10-09, PR #186):** no deep link: the email's link opens
   `docs/legal/email-confirmed.html`, which says to sign in in the app (the Check your email card
   sends the person to sign in with the email filled in). Welcome is a card on Home, once per
   account on this phone, for accounts whose sign-up carried the terms: what Wilma does, the vault
   (Set up your vault), and "say call yourself … in the chat" for her name. No preview build: it
   rides versionCode 17.
3. In-app account deletion: `delete-account` function, Account screen button, web page updated.
   **As built (2026-10-09, PR #186):** Settings → Delete account. The function checks the
   sign-in, the password again and DELETE, removes the caller's Storage folder, then deletes the
   auth user (cascades remove everything else); logs carry no email, password or file name.
4. Testing terms (short, plain; drafted for the owner, reviewed by the lawyer later, D27) and the
   privacy page's sign-up section; Play Data safety ("account creation").
   **As built (2026-10-09, PR #186):** `docs/legal/testing-terms.html` (version 2026-10-09, the
   owner to read and change), privacy page (account section, 18+), deletion page (in-app path).
   Owner: Play Data safety.
5. Owner switches it on (below), makes the first codes, phone checklist
   (`docs/signup-phone-checklist.md`), "build for Play".

## Stage 2 (later, at the public launch)

Open sign-up (no code), CAPTCHA, **Sign in with Google** (company's Google Cloud project) and
**Sign in with Apple** (with the iOS app), email from the company's domain through an email
service, final terms of service after the legal review (D27).

## Decisions (recommendations first)

- **Q1 Invite codes:** yes, required in stage 1. Alternative: open sign-up now (cheaper to build,
  no control over who signs up or the AI cost).
- **Q2 Code format:** short and readable (e.g. `WILMA-7K3Q`), each with a number of uses (1 for a
  person, more for a group) and an end date.
- **Q3 Email confirmation:** required before first use.
- **Q4 Age:** 18+ confirmation checkbox (matches the Play target audience).
- **Q5 Welcome:** name the assistant and offer vault setup, both skippable.
- **Q6 Account deletion:** password again plus typing DELETE; immediate, no grace period (simpler
  and clearer for testers). Alternative: 30-day grace period.
- **Q7 New users' allowance:** the default ($1/month) like everyone; invite codes can later carry
  a bonus.
- **Q9 Pro tester codes (owner, 2026-10-08: yes):** a code can grant Pro (`grants_plan = pro`),
  for testers of the day planner. Pro from a code lasts until the owner changes it; when Pro
  purchases arrive, testers keep it until the owner decides.
- **Q8 Switching to open sign-up later:** one server setting, `signup_mode` = `invite` or `open`
  (in a small settings table the hook reads; owner or admin changes it). The app asks the server
  which mode is on and hides the invite-code field when it is `open`, so going open (or back to
  invite-only, e.g. during spam) needs **no new app build**. Built in stage 1, set to `invite`.
  Before switching to `open` (stage 2): CAPTCHA, the legal review (D27), the company account
  (Google and Apple sign-in, email from the company's domain), Play production track.

**Owner's answers (2026-10-07): Q1-Q8 all as recommended.**

## What the owner does

- ~~Answer Q1-Q8~~ (done 2026-10-07, all as recommended). Approve merges, the migration and deploys.
- When step 5 comes: Supabase → Authentication → **allow new sign-ups**, enable the
  **before-user-created hook** (the function from step 1), set the **Site URL / redirect URLs**
  for the confirmation link, adjust the confirmation email's wording; then create invite codes.
