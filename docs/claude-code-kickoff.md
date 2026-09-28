# Kickoff prompt for Claude Code

Paste everything below the line into a new Claude Code session opened on this
repository. It builds the knowledge path first; the vault comes in a later
session, after the encryption decision in `docs/design.md` §5.

---

Read `CLAUDE.md` and `docs/design.md` first, then help me build phase 1,
milestone 1: the knowledge path of the MCP server. I'm returning to hands-on
development after a break, so explain each step briefly and stop to tell me
whenever I need to do something myself (sign up for something, paste a value
into a settings screen, approve a deploy). Never ask me to paste a password or
API key into this chat; tell me where to enter it instead.

Scope for this session:

1. Propose the project layout and language (I lean TypeScript on Supabase Edge
   Functions unless you see a strong reason otherwise) and a hosting plan for the
   MCP server that the Claude app can reach as a custom connector. Wait for my OK.
2. Turn `db/schema.sql` into the first migration under `supabase/migrations/`
   and walk me through applying it to my Supabase project.
3. Implement these MCP tools against Supabase, acting as the signed-in user so
   Row Level Security applies: `list_spaces`, `create_space`, `save_item`,
   `update_item` (writes `item_revision` first), `get_item`, `search_items`
   (semantic via pgvector + keyword + tag filter, restricted spaces excluded
   per CLAUDE.md rule 3), `link_items`.
4. Chunk and embed item text on save/update using Supabase's built-in
   `gte-small` model (384 dimensions).
5. Tests for: two-user isolation, restricted-space exclusion, revision on edit.
6. Deploy, then give me step-by-step instructions to add the server to the
   Claude app as a custom connector, and a few example prompts to try.

Do not build anything for `secret` yet beyond what the schema already has.
