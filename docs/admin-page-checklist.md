# Admin page checklist (usage tracking step 5, D34)

For the owner, after steps 3 and 4 are merged (#280, #281). The page:
**https://hassan-wehbe.github.io/digital-assistant/admin/**. About 15 minutes. Do it once on the
laptop and once on the phone's browser. Daily counts started on 25 October 2026, so the charts fill
in over the following days.

## Before you start: is your account the admin?

Supabase → SQL Editor → New query → paste → Run:

```sql
select email, is_admin from app_user where is_admin;
```

**Good result:** one row, your own email, `is_admin` true. **Anything else** (no row, or someone
else's email): stop and tell Claude; do not change it by hand. (Q8: the admin list is your account
only, set with one SQL line; it was set before step 2.)

## Signing in

- [ ] (1) Open the page in a **private window** (so no earlier sign-in is reused): it asks you to
  sign in. Sign in with your Wilma account: after a moment the Overview tab shows six tiles.
- [ ] (2) The grey line under the title says "Figures to <today> (UTC), counting since Oct 25" and,
  the first time each month, "this month's snapshot taken for N accounts" (N = how many accounts
  Wilma has).
- [ ] (3) **Sign out** (top right): the numbers disappear and the sign-in form comes back.
- [ ] (4) Optional, if you have a tester account you can sign in with: it gets **"Not available"**
  and no numbers.

## Overview and Costs

- [ ] (5) **Users** matches how many accounts Wilma has; **Active · 30 days** is about right.
- [ ] (6) **Cost this month** is close to the AI cost you see in the AI provider's console for the
  days since 25 October (the page counts from then; small differences are normal).
- [ ] (7) 30 days / 90 days / 12 months change the charts; hovering (laptop) or long-pressing a bar
  shows its numbers.
- [ ] (8) Costs → **Map and weather lookups**: after you plan a day with drive times, Mapbox goes up
  the next time you open the page.

## Users

- [ ] (9) One row per account, short ids only. **Tap a row: that account's email appears; tap again:
  it hides.** Sorting by AI cost puts the costliest first.
- [ ] (10) Notes, memories and storage are filled in (the month's snapshot).

## Pricing

- [ ] (11) Move the Pro price slider: the margins change; a price below the break-even shows a red
  (negative) margin.
- [ ] (12) "A Pro user costs what": try Pro users, Power users and Everyone active; the note under
  the results says which users and month it used.
- [ ] (13) Mapbox's price: set the free requests to 0 and go to Overview: "Cost this month" now
  shows a maps part. Reload the page: back to 100,000 (it is kept for the visit only).

## Reports

- [ ] (14) The monthly report shows this month; **Print or save as PDF** → the print window shows
  only the report → Save as PDF works.
- [ ] (15) **Per user (month)** downloads `wilma-users-2026-10.csv`; it opens in a spreadsheet with
  one row per account and **no email anywhere**.

## Play Console: Data safety (one change)

Usage counts (step 2) are a new kind of data Wilma collects, so the Data safety form needs one more
line (`docs/phase4-play-release.md`, "Data types"). **Owner, in Play Console** → App content → Data
safety → Edit:

- [ ] (16) Data types → **App activity → App interactions**: Collected **Yes**; Shared **No**;
  Processed ephemerally **No**; **Required** (counted for every account); Purposes: **App
  functionality** and **Analytics**. Save, then submit the form (it goes for review with the next
  release or on its own).

## Done

- [ ] Tell Claude what to change on the page, if anything. Tick D34's step 5 as done in
  `docs/usage-tracking-plan.md`.
