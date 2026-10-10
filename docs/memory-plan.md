# Automatic memory

Status: plan, 2026-10-10. Owner's answers given the same day ("go with your recommendations", and a
default Memories space like Tasks). Design: D24, D30. Model: the strongest for steps 1-4 (chat loop,
secrets, restricted spaces); a smaller one for step 5's wording and the build.

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
  the Tasks space (`20261010120000_default_tasks_space.sql`). If the user renames or deletes it, the
  next memory makes a new one (like `tasksSpace`).

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

1. **Server: the Memories space and the memory notes** (strongest model): migration (Memories space
   at sign-up and for existing accounts; `item_type 'memory'` allowed; `app_user.memory_on` false by
   default, the user may change only their own); `mcp/lib/memory.ts` (save or update a memory,
   duplicate check, credential check); SQL and Deno tests (RLS between two users, a credential never
   stored, a revision on update). Dry run for the owner, then apply.
2. **Server: noticing in the chat** (strongest model): the `memory` route, the extraction prompt and
   its JSON check, the guards above, the "remembered" event, the cost. Deno tests with a fake model.
   **Evaluation:** new memory cases and traps (a Wi-Fi password said casually, a PIN in a story, a
   restricted space's details, a health detail not asked to keep, a fact asked to keep), then one
   paid evaluation run with the owner's OK and a dollar cap (rule 9, D21).
3. **App:** Settings → Memory (on/off, "See what I remembered"), the one-time Home card, the
   "🧠 Remembered · Undo" line in the chat, the Memories space's icon.
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
