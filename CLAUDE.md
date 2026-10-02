# Digital Assistant — project rules for Claude Code

A personal digital assistant: one conversational front door that stores and
retrieves anything the owner tells it (technical designs, recipes, notes,
credentials), organized into **spaces**. Read `docs/design.md` before any
non-trivial change; it records the decisions and the reasons behind them.

The owner is returning to hands-on development after a break. Explain what
you are doing in plain terms, prefer small reviewable steps, and say clearly
when the owner must do something themselves (sign up, paste a value into a
settings screen, approve a deploy).

At the start of each step, recommend which Claude model to use (the owner switches with
`/model`; Claude cannot). Strongest model: new code or design touching secrets, sharing,
restricted spaces, auth, RLS or the chat loop. Smaller model (e.g. Sonnet): merging reviewed
PRs, applying an already dry-run migration, deploys that follow a written plan, starting
evaluation runs, docs and small fixes. Also suggest a fresh session when a step starts and the
conversation is long: `docs/handoff.md` and the plan docs carry the state.

## Stack (phase 1)

- **Database, storage, auth:** Supabase (hosted Postgres + pgvector, Storage, Auth).
- **Assistant interface:** an MCP server exposing a small set of tools, connected
  to the Claude app as a custom connector. The MCP server is the product; any
  agent (Claude, Hermes, a custom UI) can sit on top of it later.
- **Schema:** the migrations in `supabase/migrations/` are the source of truth. Changes
  go in a new timestamped migration file there, never by editing applied SQL.
  `db/schema.sql` is a readable overview of the tables; when it and a migration
  disagree, the migration wins.

## Non-negotiable rules

1. **Secrets never reach the model.** `SECRET` payloads are never placed in a
   tool result, prompt, log line, error message, or embedding. `get_secret`
   returns only metadata plus a short-lived reveal link; the plaintext is shown
   to the human on a page outside the chat.
2. **Secrets are never embedded or indexed.** No rows from `secret` go into
   `item_chunk` or any search index. Only `name`, `url`, `secret_type` are plaintext.
3. **Restricted spaces are invisible to general search.** Searches (semantic,
   keyword, tag) exclude items in `space.is_restricted = true` spaces entirely:
   no results, no counts, no "some results hidden" hints. They are reachable
   only when the user names that space and has unlocked it in the session.
4. **Sharing never touches secrets.** `item_share` references `item` only. Do
   not add a path that shares a `secret`, directly or by copying its contents
   into an item.
5. **Every row is owned.** All queries are scoped to the authenticated user.
   Enable Row Level Security on every table; never use the service-role key in
   code paths that serve a user request unless RLS-equivalent checks are applied.
6. **No credentials in the repo or in chat.** Keys and passwords live in
   environment variables / Supabase secrets. Keep `.env` git-ignored and keep
   `.env.example` up to date with names only. If the owner pastes a secret
   into the conversation, tell them to rotate it.
7. **History is kept.** Editing an item writes the previous version to
   `item_revision` first. Only the current version is chunked for search.
8. **Soft delete items** (`deleted_at`); purge is a separate, explicit action.
9. **Security never depends on the model.** Any model may misroute a request, so the
   server enforces the rules itself: `save_item`/`update_item` reject content that
   looks like a credential (password/PIN/API-key patterns, "my password is ...") and
   point the user to the vault instead. Every model or provider change must pass the
   evaluation set's secret-leak traps before it ships (see `docs/design.md` D21).

## Conventions

- Table names are singular snake_case (`space`, `item`, `item_chunk`).
- Every access to a secret (create, reveal, update, delete) writes a
  `secret_access_log` row.
- Supabase grants new tables and functions to `anon` by default: every migration
  that creates one revokes `anon` and grants only what `authenticated` needs.
- Write tests for: RLS isolation between two users, restricted-space exclusion,
  secret payload never appearing in tool output, revision on edit.
