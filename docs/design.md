# Digital Assistant — design

Status: phase 1 design, agreed 2026-09-27. Owner: Hassan Wehbe.

## 1. What it is

One assistant, one front door. The owner talks to it in natural language:

- "Store this login for the Gartner sandbox, in my Work space."
- "Save this design: the Teams to Service Cloud routing issue and how we fixed it." (plus a Visio export)
- "Save this recipe in Recipes, tag it weeknight."
- "What was the fix for the Teams routing timeout?"
- "Give me the Gartner sandbox login."

Passwords are one kind of data among many, not a separate app. What differs is
how each kind is stored behind the single interface.

## 2. Architecture

```
 Phone / desktop (Claude app, later Hermes via Telegram, later a web UI)
        │  natural language
        ▼
 Agent (LLM) ── decides intent, space, secure or not
        │  tool calls
        ▼
 MCP server (this repo) ── the product: tools, rules, encryption
        │
        ├── Knowledge path ──► item, item_chunk (pgvector), attachment (Storage)
        └── Vault path ─────► secret (encrypted payload), secret_access_log
```

The agent on top is replaceable. Data, security rules and encryption live in
the MCP server, which the owner controls.

### Phase 1 tools

| Tool | Purpose |
|---|---|
| `list_spaces` | Show the user's spaces (restricted ones marked, never their contents) |
| `create_space` | Create a space, optionally nested and/or restricted |
| `save_item` | Create an item in a space with type, tags, optional attachments |
| `update_item` | Edit an item; writes the old version to `item_revision` first |
| `search_items` | Semantic + keyword + tag search, scoped by space; excludes restricted spaces unless named and unlocked |
| `get_item` | Fetch one item with attachments and links |
| `link_items` | Record `supersedes` / `related` between items |
| `save_secret` | Start storing a typed secret: returns a link where the user types it; encrypted in the browser |
| `find_secret` | Match a secret by name/url/type; returns metadata only |
| `get_secret` | Returns metadata + a short-lived reveal link. **Never the plaintext.** |
| `update_secret` | Rename / change url; optional link to type a new value |
| `delete_secret` | Hard delete (the access log keeps a record) |

## 3. Decisions and reasons

| # | Decision | Reason |
|---|---|---|
| D1 | Single assistant for all data types, including credentials | The owner does not want to switch apps. |
| D2 | Credentials take a separate vault path: encrypted, never embedded, never shown to the model | RAG pipelines copy text into prompts, logs and third-party context. Keeping secrets out removes that exposure and makes prompt-injection extraction impossible. |
| D3 | Organizing unit is called **Space** (renamed from "compartment") | Natural to say out loud ("save this in my Gartner space"); avoids clashing with vector-DB "collection" and LLM "context". |
| D4 | Spaces nest (`parent_id`) and can be restricted | Work → Gartner → Teams Swarming; extra unlock for sensitive spaces. |
| D5 | One `item` table for all content types, with `item_type` + `metadata jsonb` | New content types need no schema change. |
| D6 | Tags are global per user (cut across spaces) via `tag` + `item_tag` | "Everything tagged salesforce" regardless of space. |
| D7 | Restricted spaces are **left out** of general and tag searches, with no hint | Owner's explicit choice. Enforced in search logic and RLS, not by tag structure. |
| D8 | `item_link` for supersedes / related | Assistant returns the current design and knows older ones exist. |
| D9 | Keep full edit history in `item_revision`; only current version is chunked | "What did this look like before?" without polluting search. |
| D10 | Secrets are typed (`secret_type`) with one encrypted JSON `payload_enc` | Covers logins, API keys, Wi-Fi, recovery codes, secure notes without schema churn. `expires_at` enables rotation reminders later. |
| D11 | Multi-user from day one (`app_user`, owner on every space) | Possible commercialization later. |
| D12 | Spaces are not shared between users | Owner does not want shared spaces, especially for secrets. |
| D13 | **Emergency access** for a trusted person (e.g. spouse): dormant grant, request starts a waiting period (`wait_days`), owner can deny, auto-grants after the wait | Access to accounts and funds if something happens to the owner, without day-to-day visibility. Modeled on Bitwarden emergency access. |
| D14 | **Item sharing** (`item_share`) with view/edit and optional expiry; structurally cannot reference secrets | Share a recipe or design with someone without granting space access. |
| D15 | Supabase free tier for phase 1, all in the cloud | No local setup; one account gives Postgres + pgvector, Storage and Auth. Open source, so self-hosting stays possible. Free projects pause after 7 days of inactivity; Pro ($25/mo) removes that. |
| D16 | Build with Claude Code on the web against this GitHub repo | Owner prefers cloud setup; repo is the single source of truth. |

## 4. Data model

See `db/schema.sql`. Groups:

- **People and access:** `app_user`, `emergency_access`, `item_share`
- **Organization:** `space`, `tag`, `item_tag`, `item_link`
- **Knowledge and RAG:** `item`, `item_revision`, `item_chunk`, `attachment`
- **Vault:** `secret`, `secret_access_log`

Deviation from the reviewed ERD: `app_user.id` is the Supabase Auth user id
(`auth.users.id`) instead of a separate `auth_subject` column, so Row Level
Security can use `auth.uid()` directly.

Embeddings: `vector(384)` assumes Supabase's built-in `gte-small` model (free,
runs in Edge Functions). If a different model is chosen, change the dimension
in a migration before any data is loaded.

## 5. Encryption

**Target design (zero-knowledge):** each user has a key pair. Their secrets are
encrypted with a per-user data key; the private key is stored only wrapped by a
key derived from the user's unlock passphrase (`wrapped_private_key`), so the
operator cannot read secrets. Emergency access stores the data key wrapped with
the trusted person's public key (`emergency_access.wrapped_key`), usable only
once access is granted. Reveal happens client-side on the reveal page.

**Phase 1: option B was chosen and built (milestone 2, 2026-09-28).** Details
and as-built notes: `docs/phase1-m2-vault-plan.md`. The options as considered:

- Option A — server-side envelope encryption: per-user data key, wrapped by a
  master key held in Supabase secrets. Simpler; the operator could technically
  decrypt. Acceptable for a single-owner deployment.
- Option B — go straight to the target design. More work up front, no migration later.

Either way: libsodium / Web Crypto primitives only, no home-grown crypto,
`key_version` on every secret for rotation.

## 6. Roadmap

1. **Phase 1:** schema in Supabase, MCP server with the tools above (typed input
   only), connected to the Claude app. Knowledge path first, vault second.
2. **Phase 2:** attachments with vision-generated descriptions (diagrams become
   searchable), reveal page with passphrase unlock, emergency access flow.
3. **Phase 3:** voice input (Whisper), Hermes on a small cloud server for
   Telegram/WhatsApp access, reminders (`expires_at`, follow-ups), item sharing UI.

## 7. Open questions

- ~~Encryption phase 1~~: option B, zero-knowledge, with a separate unlock passphrase and a recovery key (decided 2026-09-28, see `docs/phase1-m2-vault-plan.md`).
- ~~Where the MCP server is hosted~~: Supabase Edge Functions (decided 2026-09-28, see `docs/phase1-m1-plan.md`).
- ~~Embedding model~~: built-in `gte-small`, 384 dimensions (decided 2026-09-28).
