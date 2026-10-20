# Ages: open Wilma to teens, cocktails at 21, mocktails for everyone else

**Status:** plan, 2026-10-20, waiting for the owner's answers (Questions, below). Nothing built.
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

**Sign-up:** instead of the 18+ box, **Date of birth** (month and year, Q5) and the terms box.
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

**Settings → Account:** the date of birth shown, not editable in the app (Q7: "Wrong date? Contact us").

## How it works

1. **The date of birth** (step 1): `app_user.birth_month` (a date, the first of that month; Q5), set
   once by `set_birth_month(date)` (refused when already set; RLS: own row) and by the sign-up hook
   from the sign-up form. `age_at(day)` and **`is_21()`** in SQL (security definer, the caller's own
   row): 21 from the **first day of the month after** the 21st birthday month, so never early (Q5).
   No date: treated as under 21 for drinks. The sign-up hook checks the minimum age (13, Q1) the same
   way and refuses with a plain message. Revoke anon; grant authenticated only what it needs.
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
   agreement, the lawyer's wording), the privacy page (date of birth: month and year, why, kept with
   the account, deleted with it), Play: **Target audience** 13-15, 16-17 and 18 and over;
   **Content rating** stays "references to alcohol"; **Data safety**: date of birth (Personal info,
   collected, required, App functionality); the legal checklist. **Only then** the sign-up minimum
   changes from 18 to 13 (a one-line setting, Q10).

## Rules check

- Rule 1-2 (secrets): unchanged; a date of birth is not a secret and is never in the vault.
- Rule 3 (restricted spaces): unchanged; the age checks come on top.
- Rule 5 (every row owned): the date lives in the user's own `app_user` row (RLS); `is_21()` reads
  only the caller's own row; nothing about age goes to the AI except "mocktails only" for drinks.
- Rule 9 (security never depends on the model): every drinks rule is in code on the server; the
  model's own knowledge is covered by the prompt and by evaluation traps.
- Data minimisation: month and year only (Q5), never shown to the AI, not in logs.

## Questions (recommendation first)

- **Q1. The minimum age:** **13** (rec.: the usual minimum for apps like this; under 13 needs
  parental consent, later family accounts); or 16; or stay 18 for now and only add the 21 gate.
- **Q2. The age for alcohol:** **21 everywhere** (rec.: simple, and the strictest); or by country
  (18 in most places): more work and the phone's country is easy to change.
- **Q3. Under 21:** **mocktails only** (owner, 2026-10-20).
- **Q4. How the age is asked:** **the date of birth at sign-up, once** (rec.: the usual neutral age
  screen; a box that says "I am 21" invites a tap); or a 21+ box only when opening Cocktails.
- **Q5. What is stored:** **month and year only**, counting 21 from the month after (rec.: stores
  less and is never early, at most a month late); or the full date of birth.
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

1. **The date of birth (strongest model).** Migration: `app_user.birth_month`, `set_birth_month()`,
   `is_21()`, the sign-up hook's date and minimum age (still 18 until step 4); SQL tests and a dry
   run. **Owner:** dry run, OK to apply, merge.
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
