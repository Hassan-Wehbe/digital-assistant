# Digital Assistant

A personal assistant that stores and retrieves anything you tell it (technical
designs, recipes, notes, credentials), organized into spaces, usable from a
phone or desktop through natural language.

- `docs/handoff.md`: current state and how to keep building (start here in a new session)
- `CLAUDE.md`: rules Claude Code follows in this repo
- `docs/design.md`: architecture, decisions and roadmap
- `supabase/migrations/`: the database schema, as applied (Supabase Postgres + pgvector, Row Level Security)
- `db/schema.sql`: readable overview of the tables
- `docs/claude-code-kickoff.md`: the prompt that starts the first build session
- `docs/phase1-m1-plan.md` / `docs/phase1-m1-setup.md`: milestone 1 plan, and setup + first use
- `docs/phase1-m2-vault-plan.md` / `docs/phase1-m2-setup.md`: vault plan, and setup + first password
- `docs/oauth/`, `docs/vault/`: sign-in page and vault pages (GitHub Pages)
- `supabase/`: migrations and the MCP server (Edge Function `mcp`)
- `tests/`: SQL tests (run via the Supabase connector or `tests/sql/run.sh`), Deno unit tests,
  end-to-end tests (`tests/e2e/`) and a real-browser test of the vault pages (`tests/browser/`)

Status: phase 1 milestone 1 (knowledge path) and milestone 2 (zero-knowledge vault) deployed.
