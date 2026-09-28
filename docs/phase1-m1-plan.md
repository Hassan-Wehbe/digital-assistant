# Phase 1, milestone 1: knowledge path (plan)

Status: built and deployed 2026-09-28. Owner setup and first use: `docs/phase1-m1-setup.md`.

## Language and hosting

TypeScript on Supabase Edge Functions (Deno).

- Free tier, nothing extra to host.
- `gte-small` embeddings run inside Edge Functions (no external AI key).
- The function forwards the caller's user JWT to Postgres, so Row Level
  Security applies to every query (CLAUDE.md rule 5). The service-role key is
  used only by test setup.

MCP endpoint: `https://<project-ref>.supabase.co/functions/v1/mcp`
(Streamable HTTP transport).

Login for the Claude app custom connector: OAuth via Supabase Auth's OAuth 2.1
server, with a small static login/consent page on a free static host (later
also the phase 2 reveal page). To verify against current Supabase and Claude
connector docs before building. Fallback: per-user access token entered in the
connector settings (weaker).

## Layout

```
supabase/
  config.toml
  migrations/
    <ts>_initial_schema.sql   copy of db/schema.sql
    <ts>_search.sql           search_items() hybrid search function
  functions/
    mcp/
      index.ts                HTTP entry, auth, MCP transport
      tools/                  one file per tool
      lib/chunk.ts            text chunking
      lib/embed.ts            gte-small embeddings
      lib/db.ts               Supabase client acting as the signed-in user
tests/sql/                    SQL tests (RLS, restricted spaces, revisions)
tests/deno/                   Deno unit tests
docs/oauth/                   sign-in / consent page (GitHub Pages)
db/schema.sql                 readable reference
```

## Search

One SQL function `search_items` (security invoker): pgvector cosine similarity
+ Postgres full-text search, merged with reciprocal rank fusion, optional tag
filter. Items in restricted spaces are excluded inside the SQL (no rows, no
counts).

## Decisions (agreed 2026-09-28)

1. Restricted spaces in M1: search always excludes them, and everything nested
   under them; saving into them and `get_item` by id still work. Session unlock
   is designed with the vault milestone.
2. Tests: SQL tests (`tests/sql/`) run through the Supabase connector against the
   project, each in a rolled-back transaction (Docker is not available in the
   cloud container, so no local stack). Deno unit tests (`tests/deno/`) cover
   chunking and the MCP protocol surface. End-to-end tests against a separate
   test project can come later.

## As built (differences from the proposal)

- Sign-in/consent page lives in `docs/oauth/` and is served by GitHub Pages from
  the `/docs` folder (Edge Functions cannot serve HTML).
- Migrations: `20260928120000_initial_schema.sql` (schema, extensions moved to
  the `extensions` schema) and `20260928120100_knowledge_path.sql` (sign-up
  trigger, grants, revision trigger, save/update/get/search functions).
  Multi-step tools are SQL functions so each call is atomic.
- Tool files: `supabase/functions/mcp/tools/`; shared code in `lib/`.

## Owner setup (before continuing)

1. Supabase project created (database password kept in a password manager).
2. Supabase connector connected at claude.ai/customize/connectors.
3. Environment network access allows `supabase.com`, `*.supabase.co`,
   `api.supabase.com` (or Full).
4. New session started on this repo.
