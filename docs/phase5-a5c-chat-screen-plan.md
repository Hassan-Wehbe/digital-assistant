# A5c: the chat screen in the app (plan)

Status: **plan only, nothing built** (2026-10-02). Parent plans: `docs/phase5-chat-plan.md` (A5c),
`docs/phase5-a5b-chat-function-plan.md` ("As built: step 3" defines the request and the streamed
events). The `chat` function is deployed and live-checked; the app does not use it yet.

**Which model builds this:** the strongest one, in a fresh session, after the owner approves this
plan (CLAUDE.md: new code on the chat path, deletes, vault). Docs and small follow-ups can use a
smaller model.

## What the owner will see

1. On the home screen, a new button at the top: **Ask Wilma**. (The search field stays; A5d later
   replaces it with the one box.)
2. It opens a **conversation screen**: the thread (your messages on the right, Wilma's on the
   left), a text box at the bottom with a **Send** button, and a small line under the box:
   *"Never type passwords here. Use the Vault."*
3. You send a message. A short grey line shows what Wilma is doing ("Searching your notes…"),
   then her answer appears word by word. While she writes, Send turns into **Stop**.
4. Deleting something: Wilma says "tap Delete to confirm" and a **card** shows what would be
   deleted with **Delete** and **Cancel** buttons. Nothing is deleted until you tap Delete.
5. Passwords: Wilma never says one. A **card** says "Open *Bank login* in your vault" with a
   button; it opens the app's own vault screen (fingerprint), not a web page.
6. Limits and errors appear as plain messages with the decided buttons (below).
7. A **menu** (top right): **New conversation** (clears the thread, asks first) and nothing else
   for now.

The thread lives on the phone only, survives closing the app, and is wiped on sign-out.

## How streaming is read (checked in the installed packages)

The app is Expo SDK 57 / React Native 0.86. Docs.expo.dev is blocked here, so this was read from
`node_modules/expo/src/winter/fetch/` (after `npm ci`, not committed):

- `import { fetch } from 'expo/fetch'` is a streaming `fetch`: `response.body` is a web
  `ReadableStream<Uint8Array>`; read it with `response.body.getReader()`. It supports `signal`
  (an `AbortController`, used for **Stop** and for leaving/signing out), `Authorization` headers
  and `method: 'POST'` with a string body. React Native's own global `fetch` does **not** stream,
  so the chat client must import this one explicitly. On the web build `expo/fetch` falls back to
  the browser's `fetch`, which streams too.
- `TextDecoder` is installed by Expo's runtime and supports `decode(chunk, { stream: true })`, so
  an accented or Arabic character split across two network chunks is not corrupted. (Node's
  jest has the same API, so the parser is testable.)
- Events are newline-delimited JSON: buffer text, split on `\n`, parse each complete line, keep
  the unfinished remainder. A line that is not valid JSON, or an unknown `type`, is ignored (so
  the server can add event types later without breaking old app versions). A stream that ends
  without `done` is treated as a `connection` error.

Everything above sits behind a pure function `readChatEvents(readerOrChunks) → async events`, so
the tests need no phone.

## How the app calls `chat`

New `app/src/lib/chatClient.ts`, built like `wilmaClient` (same injected `token` / `refresh` /
`fetch`, so the same tests style works):

- `POST ${SUPABASE_URL}/functions/v1/chat`, headers `Authorization: Bearer <access token>`,
  `Content-Type: application/json`, body `{ messages: [{ role, content }] }`.
- Token and refresh come from the same functions `auth.tsx` already uses for `wilma` (shared, not
  copied). A `401` refreshes once and retries once, as `wilmaClient` does; a second `401` signs
  the user out ("Your session has ended").
- Other non-200 (400, 5xx) or no connection → the same `connection` message as the server's.
- What is sent: the last 20 thread messages, **only** user and assistant text (no cards, no
  status lines, no errors, no notices), ending with the new user message. The server trims again
  (starts at a user message, 20,000 characters each), so the app does not have to be exact.
- `AppTool` / `APP_TOOLS` in `wilma.ts` stay as they are; chat adds no model-facing tool to the
  app.

## Each event, and what the screen does

| Event | Screen |
|---|---|
| `notice` `allowance_low` | A slim banner at the top of the thread: *"You've used most of this month's requests."* with a small ✕. The message text comes from the server. Dismissal is remembered for the current month (device storage); it returns next month. The banner never blocks sending. |
| `status` | One grey line under the last message, replaced by the next status, removed when text starts or the turn ends. Not saved in the thread. Text comes from the server (`status.text`). |
| `text` | Appended to the current assistant message, live. Plain selectable text (see decision 3). |
| `confirm` | A **delete card** (below). Saved in the thread with its state. |
| `vault` | A **vault card** (below). Saved in the thread (id and name only). |
| `error` `allowance_used` | Plain message from the server (it names the reset date), shown as an assistant-style notice with **Search** and **Vault** buttons (decision 5). The text box is disabled for the rest of the month with the same message as its placeholder, because every send would fail. Reopening the app tries again (it may be a new month or a raised limit). |
| `error` `service_paused` | *"I can't think right now: my AI service is paused. Your notes, search and passwords still work."* with **Search** (goes home, focuses the search field) and **Vault** (opens the vault list). Sending stays possible (the owner may top up at any time). |
| `error` `connection` | *"I'm having trouble connecting. Try again in a moment."* with **Try again**: removes the error and re-sends the same last user message. See the risk below. |
| `done` | Ends the turn; Send comes back. `counted` is ignored by the app for now (the usage bar is A5f). |

The error and notice texts are the server's `message`; the app only chooses the buttons from
`code`. If an unknown `code` arrives, show its message with no buttons.

**Risk: Try again after a partial turn.** If the connection drops after a tool already ran (for
example `save_item`), re-sending could save twice. Mitigation: the app remembers which `status.tool`
names it saw during the turn; if any tool was not read-only (a short list in the app: save, update,
create, link, attach, restore, set name), the connection message gets one extra line: *"Part of
this may already be done. Check your notes before trying again."* Partial assistant text stays
visible. Decision 6 below.

## Deletes (the confirm card)

The server **never** deletes in chat. It sends `{tool, args, target:{id,title}, message,
confirm_label, cancel_label}` and the model is told it is waiting. The app does this:

1. Show a card: the server's `message` (e.g. *Move "Tomato soup" to the recycle bin?*), buttons
   **Delete** (red) and **Cancel**. The card text and button labels are rendered from the event;
   the app does not rephrase them.
2. **Delete tapped:** the app runs that one tool itself, with the signed-in user's token, through
   the **existing** client methods and **only** for these five tools, mapped to fixed methods and
   fixed argument names:

   | `tool` | args | runs |
   |---|---|---|
   | `delete_item` | `item_id` | `wilma.deleteItem` (to the recycle bin) |
   | `purge_item` | `item_id` | `wilma.purgeItem` |
   | `delete_space` | `space` | `wilma.deleteSpace` |
   | `delete_attachment` | `attachment_id` | `wilma.deleteAttachment` |
   | `delete_secret` | `secret_id` | `vault.remove` (same call as the secret screen's Delete) |

   Any other `tool` name, a missing argument, or an id that is not a UUID → the card shows
   "I can't do that from here" and nothing runs. The app never executes a tool name taken from
   the stream outside this table, and never lets the stream choose the arguments' *names*. Each
   row's `args` must equal exactly the table's argument and the `target.id`.
3. While running the buttons are disabled; on success the card becomes "Deleted *Tomato soup*"
   (no buttons) and the app **adds a short assistant message** to the thread, without a model
   call: *"Deleted "Tomato soup"."* (so the next message to the model knows). On failure the card
   shows the plain error from the client and keeps **Delete** / **Cancel** available.
4. **Cancel tapped:** the card becomes "Left *Tomato soup* alone" and the app adds the assistant
   message *"Okay, I left "Tomato soup" alone."* so the model does not think it is still pending.
5. **A card left unanswered** stays pending in the thread, also after the app restarts, until
   tapped. Starting a **new** user message while a card is pending marks it "Not done" (Cancel
   with no message to the model), so a card from this morning can never be tapped by accident
   after the conversation moved on. (Decision 7.)
6. `delete_secret` needs the vault unlocked on the phone (the existing `vault.remove` opens the
   keys first). If locked, the card shows the existing unlock card (fingerprint) in place; on
   unlock the Delete continues. A secret delete also keeps its normal access-log row on the
   server (CLAUDE.md conventions), because the same call runs.

## Vault events (passwords)

`{type:"vault", action:"reveal"|"enter", secret_id, name, link, expires_at}`.

- The app shows a card *"Open “Bank login” in your vault"* (reveal) or *"Enter the value for
  “Bank login” in your vault"* (enter) with one button. **The app does not open it by itself**
  (it would pull the user out of a reply that is still streaming); the user taps.
- **reveal** → `router.push('/vault/[id]', { id: secret_id, name })`. That existing screen already
  asks for the fingerprint / passphrase (`UnlockCard`), hides after 30 s, blocks screenshots and
  records the access. **enter** → `/vault/enter` with `id` and `name` and the secret's `type`.
  The event has no `secret_type`; the build adds it to the event (server: the tool result already
  contains `secret.secret_type`; one line plus a test, then a redeploy of `chat` with the owner's
  OK) rather than the app guessing. Until that is deployed the app falls back to the vault list.
- **The `link` is never used and never stored.** It is the fallback for clients without a vault
  screen (the web page). The app drops it as the event is read, so it cannot reach the saved
  thread, a log or the clipboard (CLAUDE.md rule 1). A test asserts this.
- The saved card keeps only `secret_id`, `name` and `action`. After the link's `expires_at`
  nothing changes, since the app does not use the link at all.
- Secret **values** never appear in the chat: the server never has them (the vault seals them on
  the phone), and the vault screens already keep them out of everything else.

## The thread on the phone

**What is stored:** a list of entries: `user` text, `assistant` text, `confirm` card (with its
state: pending / deleted / cancelled / not done / failed), `vault` card (ids and names), and
`error` entries (so the screen looks the same after restart). Status lines and the 80% banner are
not part of it. Only user and assistant *text* is ever sent to the server.

**Where:** encrypted on the phone, per account, using the **same mechanism as the sign-in session**
(`encryptedStorage` in `sessionStorage.ts`: AES-GCM, key in the phone's secure store, ciphertext in
the local key-value store). The thread can contain note contents Wilma read out, so plain storage
would be a step down from how the session is kept. (Decision 2.) Key name per user id:
`wilma.chat.<userId>`. A thread written by another account is never read.

**Size:** at most **100 entries** are kept (oldest dropped); only the last 20 messages are sent
anyway. Entries over 20,000 characters are cut when stored.

**When it is cleared:**
- **New conversation** in the menu (asks first: "Clear this conversation? Your notes are not
  affected.").
- **Sign out**, and when a different account signs in (same place the vault already forgets the
  previous account's key).
- **Delete account**, via sign-out. Nothing else (no timer) in v1; decision 2.
- Never uploaded, never in backups of the app's files in readable form (the key is
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, as for the session).

**Where the state lives:** a `ChatProvider` in `_layout.tsx` (next to `VaultProvider`), not inside
the screen. Opening a vault card and coming back, or switching apps while an answer streams, keeps
the thread and the running request. Signing out aborts the request and clears the thread.
A save is written after each completed turn and each card change (not on every text piece).

**Offline:** the thread opens and reads without a connection; Send fails with the `connection`
message and Try again.

## Files (planned)

New, all pure logic in `lib/` (the repo tests `lib/`, not screens), screens kept thin:

- `app/src/lib/chatStream.ts`: line splitter and event parser (`readChatEvents`).
- `app/src/lib/chatClient.ts`: the `POST`, 401 refresh, what is sent.
- `app/src/lib/chatThread.ts`: entries, the reducer (events → entries), `messagesToSend`,
  card state changes, caps.
- `app/src/lib/chatDeletes.ts`: the five-tool table and argument checks.
- `app/src/lib/chatStore.ts` (+ device wiring in `deviceStorage.ts`): encrypted load/save/clear.
- `app/src/lib/chat.tsx`: `ChatProvider` / `useChat` (send, stop, retry, clear, confirm, cancel).
- `app/src/app/chat.tsx`: the screen. `app/src/components/ChatBubble.tsx`, `ChatCards.tsx`.
- Edits: `_layout.tsx` (provider, a `chat` route), `index.tsx` (the button), `auth.tsx` (expose
  the token functions to the chat client; clear the thread on sign-out).
- Server (small, with the owner's OK): add `secret_type` to the `vault` event in `chat/chat.ts`
  and its test; redeploy `chat`.

## Tests to write

Jest, in the style of the existing `lib/*.test.ts` (injected fakes, no phone):

1. **Stream parser:** events split across chunks; a multi-byte character (e.g. “é”, an Arabic
   letter) split across two chunks; several events in one chunk; blank lines; a bad JSON line
   skipped; an unknown event type ignored; a stream ending without `done` becomes a `connection`
   error; an aborted stream stops cleanly.
2. **Client:** request URL, headers, body; only user/assistant text is sent, at most 20, none of
   cards/status/errors; 401 → one refresh and one retry; second 401 → signed-out error; 400/500
   and no network → the `connection` message; the token is never put in an error or log.
3. **Thread reducer:** text appends to one assistant message; status shows and clears; each error
   code adds the right buttons; `allowance_used` disables sending; notice banner once and
   dismissal remembered per month; Try again removes the error and re-sends the last user message
   once; the "part of this may be done" line appears only after a write tool.
4. **Deletes (the safety-critical set):** the five tools run exactly the mapped method with
   exactly the card's arguments and **only** on Delete; Cancel runs nothing; a sixth tool name
   (`save_item`, `update_item`, anything unknown) runs nothing; wrong argument name, non-UUID id
   or id different from `target.id` runs nothing; double tap runs once; the assistant message is
   added on success and on cancel; failure keeps the buttons; a new user message turns a pending
   card to "not done" and runs nothing; a restarted app shows a pending card still pending.
5. **Vault events:** the `link` never appears in the saved thread, in what is sent to the server
   or in any error text; the card keeps only id, name, action; reveal and enter route to the right
   screens; with no `secret_type` the fallback goes to the vault list.
6. **Store:** save/load round trip with the same in-memory key store and cipher fakes as
   `sessionStorage.test.ts`; stored text is not readable (ciphertext); a second account never
   reads the first account's thread; sign-out and "New conversation" clear it; corrupt or
   unreadable data opens an empty thread, never crashes; the 100-entry and length caps.
7. **Server:** the `vault` event carries `secret_type` (extend `tests/deno/chat_test.ts`).
8. By hand, on a phone with the preview or Play build (the owner, with a short checklist in the
   PR): stream a long answer; Stop; a save; a delete card with Delete and with Cancel; a vault
   card to the fingerprint screen; airplane mode and Try again; close and reopen the app;
   sign out and back in (empty thread); a very long thread.

`npm run check` (lint, typecheck, tests) must pass on every PR.

## Steps (each a small PR; the owner approves merges, builds and deploys)

1. **Plan** (this PR). Owner approves and answers the decisions below.
2. **Chat plumbing, no screen:** `chatStream.ts`, `chatClient.ts`, `chatThread.ts` and their tests.
   Nothing in the app calls it yet.
3. **Thread storage:** `chatStore.ts`, the device wiring, clear on sign-out, tests.
4. **The screen, text only:** `ChatProvider`, the screen, the home button, streaming text, status,
   Send/Stop, the 80% banner, the error messages and Try again. (No cards yet; a `confirm` or
   `vault` event shows "Open this in the app's other screens" at worst, and never runs anything.)
5. **Delete cards:** `chatDeletes.ts`, the card, the assistant follow-up messages, tests. This is
   the most safety-sensitive PR; review it alone.
6. **Vault cards:** the card and routing; the one-line server change and `chat` redeploy (owner's
   OK) so `enter` can open the right screen.
7. **Polish and ship:** manual checklist on a phone, handoff update, then **"merge and build for
   Play"** (the owner's usual app build) so testers get it. Server-side limits are unchanged; the
   $1 default allowance protects testers' spend.

Not in A5c: the usage bar and the admin screen (A5f / separate step), the one box replacing search
(A5d), voice (A5e), pictures (A5f), markdown rendering (decision 3), showing the reveal card without
a second model call (D23 idea, later).

## Decisions for the owner (my recommendation first)

1. **Entry point.** *Recommend:* a button "Ask Wilma" at the top of the home screen, search stays
   until A5d. Alternative: replace the search field now (no; A5d does it with the router).
2. **How the thread is kept.** *Recommend:* on the phone only, **encrypted** like the sign-in
   session, last 100 entries, cleared by "New conversation" and on sign-out, no auto-expiry.
   Alternatives: plain storage (simpler, weaker), or auto-clear after N days of no use (say if you
   want it; easy to add).
3. **How replies look.** *Recommend:* plain text in v1 (readable, selectable, no links opened).
   Wilma sometimes writes lists or **bold**; those would show as raw symbols until a small
   markdown renderer is added later (an extra package, so a separate decision then).
4. **Vault cards open by tap, not automatically.** *Recommend:* tap. Alternative: open the vault
   screen straight away when the event arrives (faster, but it interrupts a reply that is still
   being written).
5. **Buttons when the monthly allowance is used up.** *Recommend:* the same **Search** and
   **Vault** buttons as the paused message, and the text box disabled. (The agreed text only
   named buttons for the paused case; this is a small extension.)
6. **Try again after a partial turn.** *Recommend:* always offer it, plus the extra line "Part of
   this may already be done. Check your notes before trying again." when a saving tool had run.
   Alternative: never offer Try again after a write (safer against doubles, more annoying).
7. **A delete card the user ignores.** *Recommend:* it expires (becomes "Not done") the moment the
   next message is sent, and stays tappable until then, also after a restart. Alternative: expire
   after 10 minutes, or never.
8. **Server change for `enter` links.** *Recommend:* add `secret_type` to the `vault` event
   (one line + test + a redeploy of `chat`, which needs your OK). Alternative: the app asks the
   server for the secret's type, with no deploy but one more call and an ambiguity when two
   secrets share a name.
9. **Warn about passwords while typing?** *Recommend for now:* only the fixed hint under the
   box. Later: a gentle check before Send for things that look like a password (the server
   already refuses to *save* them; this only avoids sending them to the AI provider at all).
   That needs a copy of the `credentials.ts` rules in the app, so it is its own PR if you want it.
10. **Owner's "service paused" notice.** The agreed design wants a notice for the owner in the app
    when the provider is out of credit. *Recommend:* leave it to the admin screen step (A5f), since
    it needs the admin functions; in A5c every user just sees the friendly pause message.

## What the owner does

- Approve this plan and answer the ten decisions (a "yes to all recommendations" is fine).
- Later: approve the small `chat` redeploy (step 6), approve the app build for Play, and test on
  the phone with the checklist from the final PR.
- Never paste keys or passwords into the chat with Wilma or with me; if you do, rotate them.
