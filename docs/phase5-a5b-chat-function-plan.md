# A5b: the `chat` function (plan for the owner's review)

Status: **proposed, 2026-10-02.** Nothing here is built yet. Parent plan: `docs/phase5-chat-plan.md`.
Model: `gpt-6-luna` only for now (owner's decision; evaluation 55/56, 0 leaks).

## What it is, in one paragraph

A new server function, `chat`, that the app (A5c) talks to. The app sends what the user typed;
`chat` asks Luna, runs Wilma's existing tools for it (the same ones the Claude connector uses,
with the same safety rules), and streams the answer back word by word. It also keeps each
person's monthly AI allowance and shows the messages already decided for when a limit is hit.
Nothing changes for users until the app gets its chat screen (A5c).

```
phone app ──(user's sign-in)──► chat function ──► Luna (OpenAI)
                                     │
                                     └──► Wilma's tools, in memory, as that user
                                          (rule 9 check, restricted spaces, vault links)
```

## How it works

1. **Sign-in:** same as the MCP server. No valid sign-in, no answer (401).
2. **Allowance check** before calling the model (see Budget). Used up: the "allowance used"
   message, no model call.
3. **The conversation loop** is the one the evaluation tested: model, tool calls, results,
   model, at most 8 rounds per message. The instructions are the evaluated ones
   (`tests/eval/system.ts` moves to a shared place so the evaluation and `chat` use the same
   file). Small fix included: "a new version that replaces the old one" uses only the new content.
4. **Streaming:** the reply arrives as it is written, plus short status lines ("Searching your
   notes…"). The app shows them in the thread.
5. **Deleting asks first, in the app.** When the model wants to delete or purge something
   (`delete_item`, `purge_item`, `delete_space`, `delete_secret`, `delete_attachment`), `chat`
   does not run it. It sends the app a confirm card ("Delete *Tomato soup*? [Delete] [Cancel]").
   If the user taps Delete, the app runs that one tool itself (as it already can today) and tells
   the conversation it was done. No new server state, and a model can never delete on its own.
6. **Vault links open the app's vault.** When a tool returns a reveal or entry link, `chat` also
   sends the secret's id, so the app opens its own vault screen (fingerprint, A3) instead of a
   web page. Values still never pass through `chat` or the model.
7. **Errors** use the decided messages: allowance used, service paused (OpenAI account out of
   credit, `quota_exceeded`), "trouble connecting, try again". Logs hold codes and ids only, never
   conversation text.

### Where the conversation is kept (owner's choice, recommendation first)

- **Recommended: on the phone only.** The app keeps the thread and sends the recent part (last
  ~20 messages) with each new message. Nothing about the conversation is stored on the server, so
  there is nothing extra to protect, back up or delete. Clearing the app's thread forgets it.
- Alternative: stored on the server (a `conversation` table with RLS), so it follows the user to
  another phone. More to protect; can be added later without changing the rest.

## Budget (D22): the `ai_usage` migration

- Table `ai_usage`: one row per person per month: cost in cents (fractional) and number of
  requests. **RLS: people read only their own row; nobody writes it directly.**
- One database function `record_ai_usage(cost)` called by `chat` as the signed-in user. It only
  ever *adds* (it refuses negative or oversized amounts), so a person can never lower their own
  usage. No service-role key on the request path (CLAUDE.md rule 5).
- **Per-person monthly limit:** a column on `app_user` (`ai_monthly_limit_cents`), with a default
  the owner picks. The owner can change one person's limit in the Supabase table editor.
- At 80%: a heads-up. At 100%: the "allowance used, resets on the 1st" message.
  Search, notes and the vault keep working without chat.
- **Password retrieval never counts** (D22): a message whose only tool calls are vault lookups
  (`find_secret`, `get_secret`) is not added to usage.
- Shown to people as **requests**; kept internally in cents (Luna costs ~$0.29 per 1,000
  requests in the evaluation, so $3 is roughly 10,000 requests).

## Secrets and settings (owner, in Supabase → Edge Functions → Secrets; never in chat)

- `OPENAI_API_KEY`: a **second** key from the OpenAI "Wilma" project, named e.g. `wilma-chat`
  (separate from the `wilma-eval` key in GitHub, so either can be revoked alone).
- `LLM_ROUTES`: which model answers. I give the exact value (no secret in it); all three routes
  point to `gpt-6-luna` for now.

## Privacy

Before chat is switched on for anyone but the owner, the privacy page (`docs/legal/privacy.html`)
says that chat messages, and the notes looked up to answer them, are sent to OpenAI to produce the
reply, and that OpenAI does not keep them (`store: false`). I draft the wording; the owner approves
it. Play's data-safety answers get the same update (A5c, before the app release).

## Building and checking (each a small PR)

1. **Shared pieces:** the tool list and the instructions move to shared files used by the MCP
   server, `chat` and the evaluation (no behaviour change; `mcp` redeploy afterwards).
2. **Migration `ai_usage`:** dry run first in a rolled-back transaction (`tests/sql/09_ai_usage.sql`:
   RLS between two users, only-adds rule, monthly rows), then applied **with the owner's OK**.
3. **The `chat` function:** tested without any model or database using the evaluation's pretend
   account and a scripted model: streaming, the confirm card for every delete tool, vault links,
   allowance (80%, 100%, vault-only messages not counted), each error message, no conversation text
   in logs, sign-in required.
4. **Deploy `chat`** with the owner's OK, verified like `mcp` (files identical, 401 without sign-in).
   One short live check on a throwaway test user (a few requests, under 1 cent), then the test
   user is deleted.
5. **Evaluation re-run** on the shared instructions (2 cents).

## What the owner decides or does

1. **Monthly limit per person** (default for everyone; can be changed per person).
   Suggestion: **$3** (≈ 10,000 requests at today's Luna price, effectively unlimited for testing).
2. **Where conversations are kept:** phone only (recommended) or on the server.
3. Create the **`wilma-chat` OpenAI key** and add it, with `LLM_ROUTES`, to Supabase secrets.
4. Approve: the migration, the `chat` deploy (and the small `mcp` redeploy), and the privacy
   wording.

Not in A5b: the chat screen (A5c), the one box replacing search (A5d), voice (A5e), pictures and
budget settings in the app (A5f).
