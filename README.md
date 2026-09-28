# Digital Assistant

A personal assistant that stores and retrieves anything you tell it (technical
designs, recipes, notes, credentials), organized into spaces, usable from a
phone or desktop through natural language.

- `CLAUDE.md`: rules Claude Code follows in this repo
- `docs/design.md`: architecture, decisions and roadmap
- `db/schema.sql`: phase 1 database schema (Supabase Postgres + pgvector, with Row Level Security)
- `docs/claude-code-kickoff.md`: the prompt that starts the first build session
- `docs/phase1-m1-plan.md` / `docs/phase1-m1-setup.md`: milestone 1 plan, and setup + first use
- `supabase/`: migrations and the MCP server (Edge Function `mcp`)
- `tests/`: SQL tests (run via the Supabase connector or `tests/sql/run.sh`) and Deno unit tests

Status: phase 1 milestone 1 (knowledge path) deployed; vault (secrets) not built yet.
