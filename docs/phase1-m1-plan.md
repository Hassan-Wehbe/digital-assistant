# Phase 1, milestone 1: knowledge path (plan)

Status: proposed 2026-09-28, waiting for the owner's OK on the open decisions below.

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
tests/                        Deno tests
db/schema.sql                 readable reference
```

## Search

One SQL function `search_items` (security invoker): pgvector cosine similarity
+ Postgres full-text search, merged with reciprocal rank fusion, optional tag
filter. Items in restricted spaces are excluded inside the SQL (no rows, no
counts).

## Open decisions

1. Restricted spaces in M1: search always excludes them; saving into them and
   `get_item` by id still work. Session unlock is designed with the vault
   milestone.
2. Tests: local Supabase stack in the container (preferred) or a second free
   Supabase project used only for tests.

## Owner setup (before continuing)

1. Supabase project created (database password kept in a password manager).
2. Supabase connector connected at claude.ai/customize/connectors.
3. Environment network access allows `supabase.com`, `*.supabase.co`,
   `api.supabase.com` (or Full).
4. New session started on this repo.
