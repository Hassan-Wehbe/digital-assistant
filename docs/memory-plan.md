# Automatic memory

Status: plan, 2026-10-10. Owner's answers given the same day ("go with your recommendations", and a
default Memories space like Tasks). Design: D24, D30. Model: the strongest for steps 1-4 (chat loop,
secrets, restricted spaces); a smaller one for step 5's wording and the build.

**Step 2 merged (#198) and live** (`chat` v27, `mcp` v31). **Step 3 built (2026-10-10, branch
`claude/memory-step3`), not merged:** the app; see "As built: step 3" at the end.

## What the owner will see

- **Settings → Memory: Off / On.** Off until each person turns it on (also for the owner and the
  testers). A one-time card on Home explains it, with "Turn on" and "Not now".
- **In the chat:** after Wilma answers, a small line under the reply when she kept something:
  "🧠 Remembered: Lexi swims on Tuesdays · Undo". Undo deletes it at once.
- **A default 🧠 Memories space** ("What Wilma remembered about you"), made for every account like
  Tasks, top level, not restricted. Each memory is a short note in it. Open it to read, edit or
  delete any of them; Settings → Memory has "See what I remembered" for the same list.
- **Wilma uses them:** she knows your family's names, your allergies, your usual places without
  being told again, in the chat and in My day.

## Decisions (owner, 2026-10-10)

- **Q1 Automatic, with Undo.** Memories are saved without asking, shown under the reply with Undo,
  and listed in the Memories space. Nothing is hidden.
- **Q2 Sensitive topics only when asked.** Health, money, religion, politics, sexuality, and private
  details about other people are remembered only when the user says "remember …" themselves, never
  picked up automatically.
- **Q3 Off by default,** for every account; a one-time card offers it.
- **Q4 A default Memories space** (owner): made at sign-up and given to every existing account, like
  the Tasks space (`20261010120000_default_tasks_space.sql`).
- **Q8 Built-in spaces are marked and cannot be deleted** (owner, 2026-10-10): Tasks and Memories
  are **built-in**. A new column `space.built_in` ('tasks' | 'memories', null for the user's own
  spaces), set by the migration on each account's default Tasks space (the one
  `20261010120000_default_tasks_space.sql` made, or the user's own top-level "Tasks") and on the new
  Memories space. **The server refuses** to delete, rename, move or restrict a built-in space (a
  trigger, so neither the app, the chat nor the Claude connector can; Wilma says "Tasks is a
  built-in space, so it can't be deleted"); its description can still be edited, and its notes are
  the user's to edit or delete as usual. **The app shows it:** a small **BUILT-IN** badge (the same style
  as My day's PRO badge; owner, 2026-10-10) on the space's row (Home, All spaces) and on its screen, and Edit space has no Delete, rename or
  restricted switch for it, with the line "Built-in space: it can't be deleted or renamed." The
  `tasksSpace` fallback stays for safety. SQL tests: delete, rename, move and restrict are refused
  for the owner and for anyone else; an ordinary space is unaffected.

## How it works

**Noticing (server, `chat`).** After each answered turn with memory on, a small extra model call
(the cheapest route, a new `memory` route in `LLM_ROUTES`) looks at **the user's newest message
only**, with the previous one or two for context, and returns at most 3 short facts as JSON, or
none. Only what the user said, never Wilma's own answer. It runs after the reply has streamed
(`EdgeRuntime.waitUntil`), so the chat is never slower; the "Remembered" line arrives as one more
event if the stream is still open, else it shows next time the chat opens. Its cost is counted with
`record_ai_cost` (cost only, not a request). Conversations stay on the phone, as today: nothing new
is stored except the memories themselves.

**Never remembered (enforced by the server, not the model; rules 1, 3, 9):**
- Anything that looks like a credential: every memory goes through `rejectCredentials` like
  `save_item`; a refused one is dropped silently (no hint of what it was).
- Any turn that touched the vault, a secret, or a restricted space (a tool call on a restricted
  space, or a restricted space named in the message): no memory call at all for that turn.
- The sensitive topics of Q2, unless the message itself says "remember".
- A fact already remembered (the same words, or a close search match in Memories): not saved twice;
  a changed fact ("Lexi swims on Wednesdays now") updates the old memory (its old text goes to
  `item_revision`, rule 7).

**Stored:** a note with `item_type = 'memory'` in the Memories space: title the fact ("Lexi swims on
Tuesdays"), body empty or a short line, metadata `{ source: "chat", on: "2026-10-10" }`. Chunked and
embedded like any note, so search finds it; RLS, soft delete and the Recycle bin apply as they are.

**Used:** each chat turn's system prompt gets an "About the user" block with the newest 30 memories
(titles only, about 600 tokens at most); the rest are found by search like any note. Memories from a
restricted space never exist (they are never made there).

**Off:** no memory call, no "About the user" block. Turning it off keeps the Memories space (the user
deletes it if they want).

## Steps (one PR each)

1. **Server: the Memories space, built-in spaces and the memory notes** (strongest model): migration
   (Memories space at sign-up and for existing accounts; `space.built_in` on Tasks and Memories and
   the trigger that refuses deleting, renaming, moving or restricting them; `item_type 'memory'` allowed; `app_user.memory_on` false by
   default, the user may change only their own); `mcp/lib/memory.ts` (save or update a memory,
   duplicate check, credential check); SQL and Deno tests (RLS between two users, a credential never
   stored, a revision on update). Dry run for the owner, then apply.
2. **Server: noticing in the chat** (strongest model): the `memory` route, the extraction prompt and
   its JSON check, the guards above, the "remembered" event, the cost. Deno tests with a fake model.
   **Evaluation:** new memory cases and traps (a Wi-Fi password said casually, a PIN in a story, a
   restricted space's details, a health detail not asked to keep, a fact asked to keep), then one
   paid evaluation run with the owner's OK and a dollar cap (rule 9, D21).
3. **App:** Settings → Memory (on/off, "See what I remembered"), the one-time Home card, the
   "🧠 Remembered · Undo" line in the chat, the Memories space's icon, and the BUILT-IN badge on
   Tasks and Memories (rows and space screen; no Delete or rename for them in Edit space).
4. **Wilma uses them:** the "About the user" block in the system prompt; an evaluation run for it
   (prompt change).
5. **Privacy and build** (smaller model): privacy page paragraph (what is remembered, where it is
   kept, how to see and delete it, off by default), Data safety check (memories are user content
   already declared; nothing new is shared), the legal checklist, a phone checklist, then "build for
   Play" (versionCode 19, with the morning briefing).

## Open questions (small, defaults chosen)

- Q5: the Memories space's name and description: "Memories", "What Wilma remembered about you".
- Q6: at most 3 memories per turn, 30 in the "About the user" block.
- Q7: the cheapest model for noticing (today's provider's small model); the evaluation run decides.

## As built: step 2 (noticing in the chat)

- **`supabase/functions/chat/memory.ts`** (`noticeMemories`). `chat.ts` starts it after `done`, only
  for a whole answer (not after an error or Stop, not when the app will send the message again with
  the calendar), and `index.ts` keeps the instance alive for it with `EdgeRuntime.waitUntil`. With
  `app_user.memory_on` off it only reads that switch: no model call, nothing logged.
- **The `memory` route** is optional in `LLM_ROUTES`: without it the `router` model answers, so the
  live secret needs no change. To try another model for noticing, add `"memory": {...}` (same shape
  as the other routes); no deploy needed.
- **What the model gets:** the newest user message, up to two messages before it (Wilma's last reply
  and the user's message before that; any removed by the credential screen or talking about the
  vault are left out), and the newest 30 memories as `m1`… (so a changed fact can say
  `"replaces":"m3"`). No tools, no notes, no names of spaces. It answers
  `{"facts":[{"fact","sensitive","replaces"}]}`; anything else means nothing is remembered.
  8-second limit.
- **The server's guards (rule 9):** no memory call when the answer used any `*_secret` tool, the
  newest message has vault words or looks like a credential (the one box's `guard`), or a
  restricted space (or one under it) is named anywhere in the turn: the messages, Wilma's text, a
  tool's input or result (by name as whole words, or id). This is deliberately broad: with a
  restricted space called "Private", a message about "a private school" is not remembered either.
  Each fact is dropped when it looks like a credential, has vault words, is value-like (a number of
  4+ digits that is not a year, a word mixing letters and digits; times, ordinals and units are
  fine), shares no word with the newest message, or is sensitive (the model's flag, or the
  server's word list for health, money, religion, politics and sexuality) without the user saying
  "remember", "don't forget" or "keep in mind" ("do you remember", "I don't remember" do not
  count). `saveMemory` then checks credentials again, refuses duplicates, and updates a replaced
  memory (revision kept).
- **The event:** `{"type":"remembered","memories":[{"id","fact","updated"}]}`, after `done`, only
  for new or changed memories. Today's app stops reading at `done` and never sees it (nothing
  breaks); step 3 reads on for it.
- **Cost:** `record_ai_cost` (cost only, not a request), at most 5 cents a call.
- **Log:** one `{"event":"memory"}` line per noticing with codes and counts only (`dropped` by
  reason), never the conversation or a fact.
- **Tests:** `tests/deno/memory_notice_test.ts` (guards on their own and end to end through the
  handler with a scripted model), `tests/deno/memory_eval_test.ts` (the evaluation machinery),
  `tests/deno/llm_test.ts` (the optional route). **Evaluation:** `tests/eval/memory.ts`,
  `run.ts --suite memory`: 23 cases (7 keep, 5 skip, 11 secret-leak traps: a Wi-Fi password said
  casually, with and without the word; a PIN and a garage code in a story; a restricted space by
  name and by tool; a vault turn; health, money and another person's private news not asked to
  keep; "remember the alarm code"). **Run 38063018552 (owner's OK, $1 cap), Luna: 23/23, 0 leaks,
  $0.0011.**

## As built: step 3 (the app)

- **Settings → Memory:** On / Off (`app_user.memory_on`, read and written as the user, like
  Distances; shown only once it is read), "🧠 See what I remembered" (opens the built-in Memories
  space), and a line saying what memory does. `lib/memory.ts`.
- **Home:** a one-time card, "🧠 Let Wilma remember" with Turn on / Not now, while memory is off;
  closed for good per account on this phone (`wilma.memoryCard.v1.<id>`); gone when memory is turned
  on in Settings. `components/MemoryCard.tsx`.
- **Chat:** the stream is read past `done` for `remembered` only (`chatStream.ts`); `runTurn` gives
  Send back at `done` as before and listens on in the background up to 20 seconds (`afterDone`).
  The line goes right under the reply it came from (`memory` entry, kept with the thread):
  "🧠 Remembered: … · Undo" (or "Updated: …"). Undo sends a new memory to the Recycle bin, or gives
  a changed one its old text back (the event now carries `was`), then says "Forgotten: …" / "Back
  to: …". `MemoryLine` in `ChatCards.tsx`.
- **Built-in spaces:** `list_spaces` now says `built_in` for Tasks and Memories (server). Rows on
  Home and All spaces show ✅ / 🧠 and a **BUILT-IN** badge (the PRO badge's style, `GroupRow`'s new
  `badge`); the space's screen shows the badge and has no Delete space; Edit space has no Name
  field for them, with "Built-in space: it can't be deleted or renamed." `isTasksSpace` prefers
  the built-in one.
- **Server changes in this step:** `list_spaces` output (`built_in`, only on the two built-in
  spaces; no description change) and the `remembered` event's `was`. Both need a deploy (`mcp`,
  `chat`); an app without them still works (no badges; Undo of a changed memory deletes it).
- **Tests:** 739 app tests (15 new: `memory.test.ts`, and memory cases in `chatStream`, `chatRun`,
  `chatThread`, `homeSpaces` tests); 446 Deno tests (1 new: `list_spaces` marks built-in spaces).
