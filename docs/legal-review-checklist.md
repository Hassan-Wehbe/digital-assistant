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
- [ ] **Alarms, reminders and calendar entries** (D31, `docs/alarms-calendar-plan.md`): Wilma
      adds events to the user's calendar (only on a tap, create only) and sets reminders that can
      show on the lock screen. Check the wording (the calendar permission text, Settings → Calendars,
      the privacy paragraphs); responsibility when an added event or a reminder is wrong (AI answers
      can be wrong; the card shows everything before the tap); calendars shared with other people
      (an added event is visible to them).
- [ ] **Homes** (D36, `docs/my-places-plan.md`): home addresses and points stored with the
      account (not notes, never shared; a deleted home is gone for good, no revision); "Notice which
      home I'm at when I plan" (off until turned on) reads the location in the foreground while
      planning and compares it on the phone only. Check the consent wording (Settings → Homes, the
      privacy paragraph); Wilma never sends the reading, though the phone's own location service
      (Google's on most Android phones) may use the network to work it out, as for every reading.
- [ ] **AI**: disclosure that answers come from AI providers, provider data terms (no training on
      API data), any AI-disclosure laws in force at launch.
- [ ] **Voice** (A5e) and the future **wearable**: recording consent. Florida requires the consent
      of everyone being recorded, so anything that records conversations needs care.
- [ ] **Mapbox terms and the morning briefing** (day planner step 4): a leave-by alert keeps a time
      worked out from Mapbox's drive times in the phone's notification schedule until it is shown
      (a day at most), and the Your morning card asks for a plan when the user opens Wilma. Mapbox
      is never asked on a schedule. Confirm this fits Mapbox's terms on storing Directions results.
- [ ] **Automatic memory** (D24, `docs/memory-plan.md`): Wilma keeps facts from the chat by
      itself (off by default, shown with Undo, listed in the Memories space). Check the consent
      wording (Settings → Memory, the Home card, the privacy paragraph); that health and other
      sensitive topics kept only when the user says "remember" is enough (state privacy laws on
      health data, e.g. Washington's My Health My Data Act, and on sensitive data); facts about
      other people the user mentions; and whether Play's Data safety form needs "Health info"
      when a user asks Wilma to remember a health detail (today: covered by "Other user-generated
      content").
- [ ] **Get title on shared links** (D41): on the user's tap, the phone reads a shared page's
      own title (YouTube through its public oEmbed address; other sites' og:title or title), with
      no cookies or sign-in. Check this fits YouTube's API terms and the sites' terms of use, and
      that the privacy page needs no line for it (nothing reaches Wilma's server until the user
      saves the note).
- [ ] **Children's details in the household** (D40, `docs/planners-plan.md`): a parent may add
      their children to Settings → Household (a label they choose, and a birth year if they give
      one) so Wilma can plan family days. Only the children's ages go to the AI provider (OpenAI),
      for that one plan; never the label, never to Mapbox or the weather service, never stored with
      a plan; removed with the person or the account. The account holder is always an adult (18+).
      Check: that this is not "collecting from children" under COPPA and fits state children's and
      privacy laws; the privacy page's household line and its Children section; and that Play's
      Data safety answer ("Other user-generated content", not shared) and the Families policy need
      nothing more (the app is not aimed at children).
- [ ] **Recipes and cocktails** (D43, `docs/recipes-plan.md`): (1) **alcohol**: cocktail recipes
      in a built-in space and Make a cocktail; the content rating answer (references to alcohol),
      the 18-and-over target audience, and whether any country needs an age check (Wilma asks
      none, Q11; "No alcohol" is always offered); (2) **importing**: the phone fetching a recipe
      page the user picked, and TikTok's public oEmbed address for a caption (TikTok's developer
      terms), with a copyright note that a saved recipe is for the user's own use; (3) **pictures
      to the AI**: a screenshot the user picks is sent to OpenAI to read the recipe (smaller copy,
      no location), not kept; the privacy wording; (4) **AI suggestions**: A new idea is marked
      new and not tested; whether the terms need a line on following AI recipes (allergies, food
      safety).
- [ ] **Teens, 13 and over, and the age check** (D44, `docs/age-plan.md`; the pack with draft
      wording and questions: `docs/age-step4-lawyer-pack.md`): sign-up opens to 13-17 with a
      parent's or guardian's agreement; the month and year of birth are asked and not kept (only
      "21 or over" or the month the person turns 21); cocktails at 21, mocktails before. Check: the
      consent wording, state teen and AI-chatbot laws, OpenAI's rules for 13-17, alcohol at 21 for a
      13+ audience, Data safety. **Wilma stays 18 and over until this is ticked.** **Parked (owner,
      2026-10-22):** the age part is switched off and Wilma stays 18+; nothing to review for now.
- [ ] **Usage counts and the admin page** (D34, `docs/usage-tracking-plan.md`): per account and
      UTC day, counts only (messages, saves, searches, day plans, the AI's cost and tokens per
      feature, map and weather lookups, errors), never content; kept about 13 months, deleted with
      the account; read only by the owner on an admin page that shows short ids and one email at a
      time on a tap. Check: the privacy page's "Usage counts" wording (live since 25 October 2026),
      whether "used to run Wilma and set its prices" is enough notice, and the Play Data safety line
      (App interactions: app functionality and analytics).
- [ ] **Data breach**: notification duties (Florida and other states where users live).
- [ ] **Brand**: the name "Wilma" and the mascot (trademark search and registration), app name in
      the stores.
- [ ] **Company**: entity type, who signs the store and Google agreements, insurance (cyber
      liability) given the data held.

## Outcome

- [ ] Lawyer's changes applied to the pages and store forms.
- [ ] Date of review and reviewer recorded here.
