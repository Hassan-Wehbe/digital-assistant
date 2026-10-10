# Legal review checklist (D27)

Last step before the public launch: Google Play production, the App Store and paid plans.
Internal and closed testing can continue before it. A lawyer reviews everything below, with
the company (D-U-N-S, domain, Google Workspace) in place. Add to this list whenever a feature
changes what Wilma collects, shares or promises. Everything here was drafted with Claude's help
and is a starting point, not legal advice.

## Documents to review

- [ ] **Privacy policy** (`docs/legal/privacy.html`): what is collected (account, notes, files,
      places and on-tap location, calendar and tasks, voice), why, how long it is kept, where it
      is stored (Supabase region), who processes it (Supabase, the AI providers such as OpenAI and
      Anthropic, Expo, Google), users' rights and how to use them, children (18+).
- [ ] **Terms of service** (not written yet): acceptable use, accounts, AI answers can be wrong,
      limits of liability, termination, governing law (Florida), changes to the terms.
- [ ] **Subscriptions and billing terms**: monthly AI allowance, auto-renewal and cancellation
      (state auto-renewal laws, Google Play and Apple rules), refunds, price changes, free trial.
- [ ] **Top-ups** (D28): one-time packs of extra requests; whether they expire, refunds, what
      happens to unused credit when an account is deleted, store refund rules.
- [ ] **Account deletion page** (`docs/legal/delete-account.html`) and what deletion really
      removes (backups, logs, revoked Google tokens).
- [ ] **Google Play Data safety form** and, later, **Apple privacy labels**: match the privacy
      policy exactly.
- [ ] **Google API Services User Data Policy / Limited Use** statement (calendar and tasks, D25).

## Product claims and features to check

- [ ] **Security claims**: "zero-knowledge vault", "Wilma cannot read your passwords",
      "passwords never reach the AI": accurate as worded, and what happens if the recovery key
      is lost.
- [ ] **Vault import** (D19): users upload exports from other password managers; on-device only.
- [ ] **Emergency access** (D13): letting a trusted person (e.g. a spouse) into accounts and funds
      after a waiting period; consent wording, incapacity or death, estate questions.
- [ ] **Item sharing and task assignment** (D14, D25): users store and share details about other
      people (names, visits "with Sarah"); responsibilities in the terms.
- [ ] **Calendar** (D25): read on the phone, chosen calendars only, needed lines sent to the AI
      provider, nothing stored; later Google connection under Google's Limited Use policy.
- [ ] **Location** (D26 "Save where I am"): on-tap only, stored in the note; consent wording.
- [ ] **AI**: disclosure that answers come from AI providers, provider data terms (no training on
      API data), any AI-disclosure laws in force at launch.
- [ ] **Voice** (A5e) and the future **wearable**: recording consent. Florida requires the consent
      of everyone being recorded, so anything that records conversations needs care.
- [ ] **Mapbox terms and the morning briefing** (day planner step 4): a leave-by alert keeps a time
      worked out from Mapbox's drive times in the phone's notification schedule until it is shown
      (a day at most), and the Your morning card asks for a plan when the user opens Wilma. Mapbox
      is never asked on a schedule. Confirm this fits Mapbox's terms on storing Directions results.
- [ ] **Data breach**: notification duties (Florida and other states where users live).
- [ ] **Brand**: the name "Wilma" and the mascot (trademark search and registration), app name in
      the stores.
- [ ] **Company**: entity type, who signs the store and Google agreements, insurance (cyber
      liability) given the data held.

## Outcome

- [ ] Lawyer's changes applied to the pages and store forms.
- [ ] Date of review and reviewer recorded here.
