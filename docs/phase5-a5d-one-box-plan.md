# A5d: the one box (plan)

Status: **owner answered "yes to all" (2026-10-04)**: D1-D6 and Q1-Q7 below are all decided as
recommended (Q4: the classifier is built last, only if still wanted). Plan merged (#63).
**Step 2 built:** `app/src/lib/router.ts` and `router.test.ts` (22 tests), not called by the app
yet. One addition to step A: a message that gives a value ("is/was/are/were" not straight after
what/where/which, or any `:` or `=`) goes to Wilma, so words like "wifi hunter2" never reach the
vault search (merged, #64).
**Step 3 built:** `chatThread.ts` gains a `lookup` action (the message, a short assistant line
and, for a secret, the usual vault card with id, name and kind only; no model call) and
`canLookup` (lookups also work when the allowance is used up; `canSend`, the Wilma path, still
stops). The saved thread needs no change (same entry kinds). 9 new tests (merged, #65).
**Step 4 built:** `chatRoute.ts` (`routeMessage`) and the provider's `send` route every message;
the chat screen follows the outcome (opens a space, shows a secret's card, keeps the text when
the allowance is used up and shows why under the box). Two changes from the plan: the space list
is read with the secrets, per short message, instead of being kept in memory (simpler, never
stale; sentences make no read at all); and step A also sends question words (how, why, when, who,
did, do, does, much, many, should, will) to Wilma before any read (merged, #66).
**Step 5 built:** the home screen's one box with Send, and two small links under it: **Search**
(the old note search on the box's text, D3) and **Conversation** (back to the thread without
sending; added because the Ask Wilma button is gone). The old search field and the Ask Wilma button
are removed (merged, #67). **Step 6 deferred** (Q4: after the owner has used the box).
**Step 7:** phone checklist `docs/phase5-a5d-phone-checklist.md` (with the #60/#61 layout
re-checks) and handoff updated; built as Play versionCode 6 (2026-10-05) and **the owner's phone
checklist passed in full** (2026-10-05). A5d is done; deleting the Search link and step 6 wait
for the owner after a few days of use. Parent plans: `docs/phase5-chat-plan.md` (A5d),
`docs/phase5-a5c-chat-screen-plan.md` (the chat screen this builds on). Design: `docs/design.md`
D18 (one box, an invisible router that prefers the model when unsure), D22 (password retrieval
never counts against the budget) and D23 (no search bar; a found secret shows the reveal card
directly, with no second model call).

**Which model builds this:** the strongest one, in a fresh session, for steps 2-6 (new code that
decides what happens to a message and touches secrets and the chat loop; CLAUDE.md). A smaller
model (Sonnet) is fine for step 7 (merge, build, handoff) and for docs.

## What the owner will see

1. The home screen gets **one box** at the top. It replaces the **Ask Wilma** button and the
   search field. Under it, a small **Search** button (D3, temporary).
2. You type and send. Most of the time nothing looks different: Wilma answers in the chat screen,
   as today.
3. If what you typed is **exactly a space's name** ("Recipes", "open recipes"), that space opens
   straight away. No model, no cost.
4. If it is **exactly a secret's name** ("Bank login", "what's my wifi password"), the chat screen
   shows a short line and the usual **Open "Bank login" in your vault** card. One tap, then the
   fingerprint, as now. No model, no cost, nothing counted against your monthly requests.
5. **Search** (the small button) runs the old note search on what is in the box: instant, free,
   never the model. It stays until the box has proven itself, then it is deleted (D3).
6. If your monthly AI allowance is used up, the box **still works for the lookups above** (and
   Search); anything else shows the "used up, resets on the 1st" message. Today the whole box is
   disabled (Q6).

Nothing else changes: the chat screen, the cards, the vault and the delete confirmations stay as
built in A5c.

## How the router decides

The rules are plain TypeScript in `app/src/lib/router.ts`, pure functions with tests (D5). The
model is not involved in a lookup, and the rules make no network call. (Reading the user's own
names from our own server is a separate step, below.)

**Step A, "is this message only a name?"** (pure, on the text alone)

1. Normalise: lower case, accents and Arabic marks removed, punctuation and hyphens ignored,
   so "Wi-Fi", "wifi" and "wi fi" are the same.
2. Any **write or risky word** (save, add, delete, remove, update, change, rename, move, create,
   remember, forget, new, ...) means **Wilma**, always, even if a space is literally named that.
3. Drop **lookup fillers**: open, show, find, get, give, tell, see, go to, my, me, the, a, please,
   what, what's, is, where, I need, I forgot, space, folder, and the vault's generic words
   (password, passcode, PIN, login, credentials, secret, details; the same list the server's
   vault search drops, `GENERIC_WORDS` in `mcp/lib/vault.ts`).
4. What is left is the **phrase**. If it is empty or longer than 5 words, the answer is
   **Wilma** (a real sentence or question). Otherwise go to step B.

**Step B, "does the phrase equal exactly one name?"**

- Spaces: the app's list of spaces (small; kept in memory, refreshed when the home screen is
  shown). Candidates are each space's own name and its full path ("Work/Gartner" also answers to
  "work gartner"). **Restricted spaces, and every space inside one, are removed from the list
  before matching** (CLAUDE.md rule 3): typing a restricted space's name behaves exactly like
  typing a name that does not exist, i.e. it goes to Wilma, with no hint.
- Secrets: the app asks our server for secrets matching the phrase (`find_secret`, a read of the
  user's own data, restricted spaces already excluded by the server; Q2), then **re-checks
  exactness itself** on the names that come back: it never treats "the server returned it" as
  "it is the one". The router only ever sees `id`, `name` and `secret_type`, never the address
  (`url`) or anything else (D6).
- **Exactly one** match (space or secret) = a lookup. **Zero, or two or more** (including a space
  and a secret with the same name) = **Wilma** (D4, Q5). "Exact" means the same name after step
  A's normalising, plus plural "s" and (Q3) one typo in names of 6+ letters.
- Nothing is cached on disk. The thread keeps only the message, the short assistant line and the
  card (id, name, kind), never a link or a value.

Examples (names: space "Recipes"; secrets "Wi-Fi", "Bank login", "Gmail"):

| You type | Result |
|---|---|
| `recipes` / `open the Recipes space` | opens Recipes |
| `what's my wifi password` | reveal card for "Wi-Fi" |
| `bank` | reveal card for "Bank login" |
| `my gmail password is hunter2` | Wilma (extra words; the server's rule 9 handles it as today) |
| `delete bank login` | Wilma (write word) |
| `how much did I pay for the roof` | Wilma (a sentence) |
| `bank of montreal` (a secret named "Bank of Montreal online banking") | Wilma (not exact; cheap classifier, step 6, may later help) |
| the exact name of a restricted space | Wilma, as if the space did not exist |

A wrong lookup is cheap by construction: the worst case is one extra tap on a card or a space you
did not mean. A secret is never revealed by the router; the card opens the app's own vault screen
(fingerprint, 30-second hide, access-log row), exactly as in A5c.

## The cheap classifier (step 6, its own PR, optional)

D4: for messages the rules cannot place (short, not an exact name, not obviously a request), the
cheapest model (`router` route in `LLM_ROUTES`, configured since A5a, unused so far) decides one
thing: **`search`** (the person wants to find something stored; give the words to look for) or
**`wilma`** (anything else). On `search` the phone runs `search_items` itself and shows the
top few notes as a card with a button **Ask Wilma instead**, so a wrong guess is never a dead end.

What it is given and what it can do:
- Only the one message (cut to 500 characters): no history, no names, no notes, no tools.
- Its answer is validated as one of two words plus a short query string. The only thing the phone
  ever does with it is a read-only `search_items` call, which the server already restricts
  (restricted spaces never searched). It can never run a write, a delete or a vault action.
- Never for secret lookups: those are decided by the rules and never need it.
- Any failure, timeout, odd answer or used-up allowance means **Wilma** (D4).

Server work this needs (owner approves each): a small `chat` change (a classify request, new
tests) and its redeploy, and (Q4) a small migration so a classification adds its cost without
counting as one of the monthly "requests" (`record_ai_usage` today adds 1 request per call). The
evaluation set gets about 20 router cases (including secret traps: a vault-looking message must
never be classified as `search`), and the router route's model must pass them before it ships
(CLAUDE.md rule 9, D21).

An honest note on value: a Wilma answer costs roughly 0.02 cents and a classification a fraction
of that, and a message sent to the classifier and then to Wilma pays both and waits longer. The
rules alone catch the common cheap cases (names). Q4 recommends building the classifier last and
only if, after the rules are on phones, it looks worth it.

## Files (planned)

- `app/src/lib/router.ts` + `router.test.ts`: normalising, fillers, write words, `phraseOf(text)`,
  `decide(phrase, spaces, secrets)`. Pure.
- `app/src/lib/chatThread.ts`: a `lookup` action (user text, short assistant line, optional
  vault card) and the allowance-used change (Q6); `chatStore.ts` accepts nothing new (same entry
  kinds), tests extended.
- `app/src/lib/chat.tsx`: `send(text)` runs the router first and returns what happened
  (`wilma` / `opened_space` / `card`) so the screen can navigate; the spaces list and the secret
  read live here.
- `app/src/app/index.tsx` (home): the box, the Search button, the old Ask Wilma button and search
  field removed. `app/src/app/chat.tsx`: its box uses the same `send`.
- Step 6 only: `supabase/functions/chat/` (classify request), a migration, `tests/eval/` cases.

## Tests to write

1. **Router rules** (`router.test.ts`, the safety-critical set): every row of the table above;
   normalising ("Wi-Fi"/"wifi", accents, Arabic names, capitals); each write word sends to Wilma
   even when it is also a space name; more than 5 words, empty phrase and sentences go to Wilma;
   two matches go to Wilma; one match opens/cards; the typo rule (6+ letters only, never when it
   makes two matches).
2. **Restricted spaces (rule 3):** a restricted space's exact name, its path, and a child of a
   restricted space all behave as unknown and go to Wilma; the router's outputs contain no
   "hidden" or "restricted" signal; a secret whose space path is inside a restricted space is
   never matched even if the server returned it.
3. **No secrets in the router (rules 1, 2, 4):** the router's input type has no `url`, value or
   link; a `vault` card built from a lookup holds only id, name, kind; the saved thread and what is
   sent to the server never contain a link; searching and matching never write a secret anywhere.
4. **Thread:** a lookup adds the user line, the assistant line and the card in that order, makes
   no model call, is not counted; the next message to Wilma carries the user and assistant text
   only (no card); allowance-used lets lookups through and answers anything else locally with no
   call.
5. **Provider wiring:** `send` returns `wilma` and calls `chat.send` exactly once for a sentence;
   returns the space id for a space; a failed secret read (offline) falls back to Wilma; a sign-out
   while the read is under way drops the result.
6. **Search button:** runs `search_items` with the box text and never the router or the model.
7. **Step 6 only:** classifier answers validated (unknown word, empty, long query, JSON junk all
   mean Wilma); it receives only the message; a failure means Wilma; the evaluation's router cases
   including traps.
8. By hand on a phone (the owner; a short checklist is added to
   `docs/phase5-a5c-phone-checklist.md` in step 7): the table above with your real names, a
   restricted space's name, airplane mode, and a used-up allowance (set your own limit to 0 in
   Supabase as `docs/handoff.md` describes, then put it back).

`npm run check` (lint, typecheck, tests) must pass on every PR.

## Steps (each a small PR; the owner approves merges, builds, deploys and migrations)

1. **Plan** (this PR). Approved, Q1-Q7 answered as recommended.
2. **Router rules, no screen:** `router.ts` and its tests. Nothing in the app calls it yet.
3. **Thread support:** the `lookup` action and the allowance-used change, with tests.
4. **Wire the router into `send`** in `chat.tsx` (spaces list, secret read, outcomes), with tests.
   The old screens are untouched, so this is invisible on its own.
5. **The one box on the home screen** plus the Search button; remove Ask Wilma and the search
   field. Review alone (it is the visible change).
6. **The cheap classifier (optional, decided at Q4):** server change and `chat` redeploy, the
   migration, the card with "Ask Wilma instead", the evaluation cases. Owner approves the
   migration, the deploy and the paid evaluation run.
7. **Ship:** phone checklist, handoff update, then "merge and build for Play". Server-side limits
   are unchanged. After a few days of real use the owner decides when to delete the Search
   button (D3).

Not in A5d: voice (A5e), pictures and the usage bar (A5f), a password-looking-text warning before
Send (A5c decision 9, still its own PR), a pick list for several matches (Q5), languages other
than English for the filler words (Q7), opening restricted spaces (they still cannot be opened
from the app).

## Decisions

### Already answered, "yes, as recommended" (2026-10-04)

- **D1** Only exact or near-exact matches of a space or secret name skip the model.
- **D2** A found secret shows the reveal card directly with no model call, when the match is
  exact, also inside a question like "what's my wifi password".
- **D3** A small Search button stays as a fallback for now and is removed later.
- **D4** When unsure, the message goes to Wilma; the cheap model only classifies unclear messages.
- **D5** The router's rules are plain code on the phone with tests, no network.
- **D6** A secret's value is never sent anywhere; a restricted space never appears through a
  lookup (CLAUDE.md rules 1-3).

### Questions Q1-Q7: owner answered "yes to all", i.e. the recommendation of each (2026-10-04)

- **Q1. What happens on a match?** *Recommend:* a **space opens straight away** (read-only,
  nothing sensitive, it is what "go to Recipes" means); a **secret shows its card in the chat
  screen** (so the fingerprint step stays a deliberate tap, as A5c decision 4). Both are also
  written into the thread as a one-line user message and assistant line, so Wilma knows about them
  in the next message. Alternative: cards for both (one rule, one extra tap for spaces).
- **Q2. Where do secret names come from?** *Recommend:* ask the server per message, only when the
  phrase is short (so most messages never trigger it), with the server's own `find_secret`. It is
  always complete (the list call is capped at 50 and people may import hundreds of passwords, D19),
  always fresh, and no secret names are kept in the phone's memory. Costs one small read (about a
  third of a second). Spaces are few, so their list is kept in memory. Alternative: load all names
  once (instant, but wrong for people with over 50 secrets unless paged).
- **Q3. One typo allowed?** *Recommend:* yes, one letter off (swapped, missing, extra) for names
  of 6 or more letters, never if it would make two matches. "Netflx" opens "Netflix". Since a
  wrong match costs one tap and never reveals anything, this is low risk. Alternative: none (only
  case, accents, punctuation and plural "s").
- **Q4. The cheap classifier: what does it decide, and when do we build it?** *Recommend:* the two
  answers above (`search` or `wilma`), built as the **last, separate PR** and only if, after the
  rules have been used on phones, you still want it; with the small migration so a classification
  adds cost but not a "request". Alternative: skip it for good and keep sending unclear messages
  to Wilma (simplest; costs a little more per message).
- **Q5. Two things match exactly** (a secret "Bank" and a space "Bank", or two secrets). *Recommend:*
  send to Wilma, who asks which (D4: when unsure). Alternative: a small pick list of the matching
  names, free and instant (more screen work; can come later).
- **Q6. Allowance used up:** *Recommend:* the box **stays usable** for lookups and Search; other
  messages show the "used up" message under the box without calling the server. This changes A5c
  (the whole box was disabled), and matches D22: getting to your passwords never depends on the AI
  budget. Alternative: keep the whole box disabled.
- **Q7. Languages for the filler words ("open", "show", "my", ...):** *Recommend:* English now.
  Names in any language already match (Arabic and accents are handled), and a message in another
  language with extra words simply goes to Wilma, which is safe. A French/Arabic list can be added
  later, each with tests, if testers ask for it.

## What the owner does

- Approve this plan and answer Q1-Q7 ("yes to all recommendations" is fine; Q4 can also be
  "decide later").
- Later: approve the merges (steps 2-5), the app build for Play (step 7), and, only if Q4 is yes,
  the migration, the `chat` redeploy and the paid evaluation run (step 6).
- Test on the phone with the checklist from step 7, with your own space and secret names.
- Never paste keys or passwords into the chat with Wilma or with me; if you do, rotate them.
