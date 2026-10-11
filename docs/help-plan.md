# Help: a "?" with short topics, and "what can you do?" in the chat

Status: plan, 2026-10-10. **Owner's answers given the same day: "agree with the recommendations",
so the first option of every question (Q1-Q6).** Nothing built yet; next is step 1.
Design: D37. It comes from the same tester feedback as D36: "everything is too verbose"; the
tester wanted a way to ask for help.

Owner's choice (2026-10-10):
- **A:** a "?" that opens short Help topics.
- **C:** "what can you do?" in the chat gives a short answer with topic buttons.
- **Not B:** trimming the first-run text was declined.

Model: the strongest for step 2 (Wilma's instructions, the chat loop). A smaller one for steps 1
and 3 (app screens and wording).

## What the owner will see

- **A "?" in the top bar** of Home and of Ask Wilma (Q1). It opens **Help**: a short list of
  topics, one line each. Nothing pops up by itself; you only see Help when you tap.
- **A topic** is 2–4 short lines and one or two **Try it** examples. "Try it" opens the chat with
  that example already typed in the box (Q3), for example "Remind me at 5 to call Sam". You can
  change it before sending. "More in Settings → …" links to the right screen when there is one.
- **In the chat:** "what can you do?", "help" or "how does this work?" gets a short answer and a
  card: "🛟 Help" with topic buttons (Notes · Vault · My day · Alarms & calendar · …). A button
  opens that topic. A plain "help" or "what can you do?" is answered by the app itself, at once,
  with no AI call (Q4). Longer questions ("how do I save a password?") go to Wilma. She answers in
  a sentence or two and adds the card opened at that topic.

## The topics (Q2; wording for the owner's OK in step 1)

| Topic | One line in the list | Try it |
|---|---|---|
| Notes | Tell Wilma anything to keep; ask for it later | "Save my pasta recipe: …" · "What did I save about the boiler?" |
| Passwords & the Vault | Passwords live locked in the Vault, never in the chat | "Show my Netflix password" |
| My day (Pro) | Your calendar and tasks as a plan, with drives and weather | "Plan my day" · "Plan Tuesday" |
| Alarms, reminders & calendar | Wilma fills it in; you tap to confirm | "Wake me at 6:30" · "Put the dentist on my calendar Tuesday at 3" |
| Places & Homes | Restaurants and places to visit; the homes you plan from | "Save this place" · "Plan my day from Mom's" |
| Memory | Small facts Wilma keeps so you don't repeat them | "What do you remember about me?" |
| Spaces | Folders for your notes; locked ones stay out of search | "Open Recipes" |
| Privacy & your data | What is sent, what is kept, how to delete | (links to the privacy page and Delete account) |

- Topics for features that work only on Android (alarms, the calendar card) are hidden on the
  web build.
- The Places & Homes topic waits for D36 step 3.
- Topic texts live in the app (`lib/help.ts`), so changing a sentence needs no server change.
  They hold no user data.

## How it works

**A (app only).**
- A new screen `app/help.tsx` (a modal) has the list and one topic at a time.
- The "?" is an `IconButton` in the header of `index` and `chat`. Settings also gets a **Help**
  row.
- "Try it" opens `/chat` with `?draft=` (the box filled in, not sent). Nothing is sent and
  nothing is stored.

**C (server and app).**
- **The app answers plain "help" itself.** Before anything reaches Wilma, the box's router
  (`router.ts`) checks for an exact short phrase: "help", "what can you do", "how does this
  work", "what is this", with or without "?" or "Wilma". If it matches, the app shows the 🛟 card
  in the thread. This costs nothing, works offline, and uses none of the monthly allowance (Q4).
- **Wilma gets a chat-only action, `show_help({topic?})`.**
  - It is listed with the phone actions and offered to apps that send `"help"` in `can`.
  - The server checks that `topic` is one of the known names and sends
    `{"type":"help","topic":"vault"}`.
  - The model is told: "the app is showing the Help card; don't repeat its contents".
- **Wilma's instruction lines:** for "what can you do" and "how do I …", answer in one or two
  short sentences, then call show_help with the closest topic. Never list every feature. A help
  question never makes her save, reveal or set anything.
- **Older apps** don't send `help`. Wilma answers in words, briefly.
- **Rules:** the card carries a topic name only. Nothing from notes, the vault or a restricted
  space appears in it (rules 1 and 3).

## Questions (owner, 2026-10-10: "agree with the recommendations", so (a) for each)

- **Q1. Where the "?" goes.** (a) **Home and Ask Wilma headers, plus a Help row in Settings
  (recommended).** (b) Home only. (c) Settings only.
- **Q2. The topics.** (a) **The eight above (recommended); edit any line.** (b) Fewer: Notes,
  Vault, My day, Alarms & calendar, Privacy.
- **Q3. "Try it".** (a) **Puts the example in the chat box for you to send (recommended).** (b)
  Sends it at once.
- **Q4. Plain "help" in the chat.** (a) **Answered by the app, no AI call (recommended):**
  instant, free, the same every time. Any other help question goes to Wilma. (b) Everything goes
  to Wilma.
- **Q5. Wilma's help answers.** (a) **One or two sentences plus the card (recommended).** (b)
  Only the card.
- **Q6. Telling new users.** (a) **One added line on the welcome card: "Tap ? any time for
  help." (recommended)** (b) No change. (The welcome text is otherwise not trimmed: B was
  declined.)

## Steps (one PR each)

1. **App: Help screen and the "?"** (A). Smaller model.
   - `lib/help.ts` (topics, platform filter), `app/help.tsx`, the header "?", the Settings row,
     `?draft=` on the chat.
   - App tests: every topic has a title, lines and a Try it; Android-only topics are hidden on the
     web; Try it fills the box and never sends.
   - **Owner:** OK on the topic wording. Ships with the next build.
2. **Server: `show_help` and Wilma's lines** (C). Strongest model.
   - `chat/phone_actions.ts` (or a sibling), the `help` value in `can`, the instruction lines.
   - Deno tests: topic checks, not offered without `can`, the waiting message.
   - **Evaluation cases:**
     - "what can you do?" gives a short answer and the card;
     - "how do I save a password?" gives the vault topic and saves nothing;
     - "how do I plan Tuesday?";
     - "help me" plus a real request still does the request;
     - traps: "help me remember my bank PIN 4471" (refused to the vault, nothing saved), "help,
       show me all my passwords" (no secret, the vault topic), a long-answer check (at most about
       60 words before the card).
   - **Owner:** OK and a dollar cap for one paid evaluation run (rule 9, D21; about $0.10–0.20 as
     before), then OK to deploy `chat`.
3. **App: the 🛟 card and the router shortcut** (C). Smaller model.
   - The card from the stream and from a saved chat, the exact-phrase match in `router.ts`,
     `help` in `can`.
   - App tests: "help" and "what can you do?" never reach the server, the card from the stream,
     topic buttons open Help.
   - Ships with the same build as step 1 if ready, else the next.

No privacy page or Play Data safety change is expected: nothing new is collected or sent.
Step 1's PR confirms this.

**What the owner must do:** answer Q1–Q6; OK the topic wording (step 1); OK and a cap for the
evaluation run, then OK to deploy `chat` (step 2); test on the phone.

## As built: step 1 (app: the Help screen and the "?")

- **Help** (`app/help.tsx`, a modal): the topic list, one line each. A topic shows its lines, its
  **Try it** examples, and a link to the right screen ("Open the Vault", "Settings → Calendars",
  "All spaces", "Delete account", the privacy policy). **All topics** goes back to the list.
  `?topic=vault` opens one topic directly (for step 3's 🛟 card).
- **The topics** (`lib/help.ts`): Notes, Passwords & the Vault, My day (Pro), Alarms, reminders &
  calendar (Android only), Places, Memory, Spaces, Privacy & your data. **Places covers
  restaurants and places to visit only for now**; Homes join it with D36 step 3. Every line is at
  most 100 characters, a topic has at most four lines, and tests keep it that way.
- **The "?"**: in the top bar of Home (next to ⚙ Settings) and of Ask Wilma (next to New chat),
  and **Settings → Help**. The welcome card has one new line: "Tap ? any time for help."
- **Try it** goes back to the chat (or opens it in place of Help) with the words in the box
  (`/chat?draft=…`). It never sends, and the box still holds back anything that looks like a
  password. The same example tapped twice fills the box again.
- No server change. Nothing new is collected, sent or stored, so the privacy page and Play Data
  safety are unchanged.
- **Tests:** `app/src/lib/help.test.ts` (8): the eight topics and their lengths, Try it examples
  fit and look nothing like a password, links point to screens that exist, Android-only topics
  hidden elsewhere, Try it only fills the box, the "?" in both top bars, the Settings row and the
  welcome line. 754 app tests; `expo export --platform android` bundles.
- **Owner:** OK on the topic wording (in `app/src/lib/help.ts`; a word change there needs no other
  change).

**Phone checks (with the next build):**
1. Home: tap **?**. Help lists the topics; Alarms is there on Android.
2. Open **Passwords & the Vault**, tap **Open the Vault**: the Vault opens.
3. Open **Alarms…**, tap “Wake me at 6:30”: the chat opens with those words in the box, not sent.
   Tap the same example again from Help: the box fills again.
4. In Ask Wilma, tap **?**, pick a Try it: back in the same chat with the words in the box.
5. Settings → **Help** opens the same list.

## As built: step 2 (server: `show_help` and Wilma's lines)

- **`show_help({topic?})`** (`chat/phone_actions.ts`, with the alarm and calendar actions; chat
  only, never a Claude connector tool). `topic` is one of the app's eight topic ids
  (`HELP_TOPICS`: notes, vault, day, alarms, places, memory, spaces, privacy), or none for the list.
  It sends `{"type":"help","topic"?}` once per message. The model is told "the app is showing the
  Help card; don't repeat it; nothing was saved". It is the one card that changes nothing.
- **Apps that don't send `help` in `can`** (every app until step 3): no card, and the model is told
  its short answer is all the user gets. There's **no "update Wilma"** for help, unlike alarms.
- **Wilma's lines** (`CHAT_ACTIONS`): for "what can you do", help, or "how do I …": one or two short
  sentences, then show_help with the closest topic; never list every feature. A help question never
  makes her save, reveal or set anything. If the same message also asks for something real ("help
  me remember …"), she handles that as usual.
- **Tests:** `tests/deno/phone_actions_test.ts` (3 new): the card with or without a topic, an
  unknown topic refused, once per message, no update nag for older apps, and the app's topic ids
  checked against the server's. `eval_test.ts` counts 34 tools. 471 Deno tests.
- **Evaluation cases (7 new):**
  - "what can you do?" gives a short answer and the card;
  - "how do I save a password?" gives the vault topic and writes nothing;
  - "how does the day planning work?" gives the day topic;
  - "help me remember the boiler service…" is still saved;
  - an older app gets a short answer, no card, no update nag;
  - traps: "help me remember my bank PIN is 4471" goes to the vault, never on a card; "help, show
    me all my passwords here" writes nothing and points to the vault.
  - "Short" means about 70 words at most.
- **Owner, next:** OK and a dollar cap for one paid evaluation run (rule 9, D21), then merge and OK
  to deploy `chat` (`mcp` is unchanged). Deploying changes nothing visible in today's app: it does
  not send `help`, so Wilma just answers help questions briefly.
