# Phase 1, milestone 1: setup and first use

What is already done (by Claude Code, 2026-09-28):

- Database: migrations `20260928120000_initial_schema` and `20260928120100_knowledge_path`
  applied to project `digital-assistant` (ref `motvckmpusxiuelpwqxy`).
- SQL tests passed on the project (40 checks, all rolled back; see `tests/sql/`).
- End-to-end test passed against the deployed server with a throwaway user
  (save, meaning + keyword + tag search, restricted exclusion, edit history,
  long items); the user and its data were deleted afterwards.
- MCP server deployed as Edge Function `mcp`:
  `https://motvckmpusxiuelpwqxy.supabase.co/functions/v1/mcp`
- Sign-in / consent page written: `docs/oauth/consent.html` (served by GitHub Pages, step 5).

The steps below are yours: they happen in dashboards, with your passwords.
Never paste a password or key into a chat; type it only into the screens named here.

## 1. Create your user

Supabase dashboard → project **digital-assistant** → **Authentication** → **Users** →
**Add user** → **Create new user**.

- Email: your email. Password: a new strong one from your password manager.
- Tick **Auto Confirm User**. Create.

## 2. Close sign-ups

**Authentication** → **Sign In / Providers** → turn off **Allow new users to sign up** → Save.

The repo and the sign-in page are public, so this stops strangers from creating
accounts. (They would only ever see their own empty data, but there is no reason
to allow it.)

## 3. Point Supabase at the sign-in page

**Authentication** → **URL Configuration** → **Site URL**: `https://hassan-wehbe.github.io` → Save.

## 4. Turn on the OAuth server

**Authentication** → **OAuth Server**:

- Enable the OAuth 2.1 server.
- **Authorization Path**: `/digital-assistant/oauth/consent`
- **Allow Dynamic Client Registration**: on (the Claude app registers itself this way).
- Save.

(JWT signing keys: already asymmetric ES256 on this project, nothing to do.)

## 5. Publish the sign-in page (GitHub Pages)

GitHub → repo **digital-assistant** → **Settings** → **Pages**:

- **Source**: Deploy from a branch
- **Branch**: `claude/festive-fermat-fg6i75`, folder **/docs** → Save.

After a minute, open <https://hassan-wehbe.github.io/digital-assistant/oauth/consent>.
It should say "Open this page from the app you are connecting". That is correct.

When this branch is merged, switch the Pages branch to `main` (same folder); the
address stays the same.

## 6. Add the connector in the Claude app

Custom connectors need a paid Claude plan. On a Team/Enterprise plan an owner may
have to add it under organization settings instead.

1. claude.ai (or the desktop app) → **Settings** → **Connectors** →
   **Add custom connector**.
2. Name: `Digital Assistant`.
   URL: `https://motvckmpusxiuelpwqxy.supabase.co/functions/v1/mcp`
   Leave the advanced OAuth fields empty. Click **Add**.
3. Click **Connect**. A browser tab opens the sign-in page: sign in with the
   user from step 1, check that **Returns to** starts with `https://claude.ai/`,
   then **Approve**.
4. In a new chat, open the **Search and tools** menu (the sliders icon) and make
   sure **Digital Assistant** is switched on.

The phone app uses the same connector once it is added on the web.

## 7. Try it

- "Create a space called Recipes, and a space called Work with a sub-space Gartner."
- "Save this recipe in Recipes, tag it weeknight: Lemon pasta. Boil spaghetti; toss with
  butter, lemon zest, lemon juice, parmesan and black pepper."
- "Save this design in Work/Gartner: Teams to Service Cloud routing timeout. Calls
  timed out because the Omni-Channel queue capacity was 1; we raised it to 5 and
  added an overflow queue."
- "What was the fix for the Teams routing timeout?"
- "Show me everything tagged weeknight."
- "Update the lemon pasta recipe: add chilli flakes. Note: spicier version."
- "Create a restricted space called Private and save a note there: dentist is Dr. Haddad."
  Then: "Search for dentist." It should find nothing: restricted spaces are never searched.
- "What spaces do I have?"

Passwords and keys go in the vault (milestone 2): set it up with `docs/phase1-m2-setup.md`.

## If something goes wrong

- **Connector says it can't connect / discovery failed**: check steps 3–5, then
  open <https://hassan-wehbe.github.io/digital-assistant/oauth/consent> to confirm the page is live.
- **Sign-in page says the request can't be used**: the request expired (10 minutes);
  click Connect again in Claude.
- **Tools fail after working before**: ask Claude Code to read the Edge Function logs
  for `mcp` in project `motvckmpusxiuelpwqxy`.
- **Free projects pause after 7 days without use.** Resume it from the Supabase dashboard.

## Running the tests again

`tests/sql/` (database rules) run through the Supabase connector: ask Claude Code to
"run the SQL tests in tests/sql against the project". With a database connection
string in `DATABASE_URL` (Project Settings → Database), `tests/sql/run.sh` runs
them with psql. `tests/e2e/e2e.py` exercises the deployed server with a throwaway
user (see the file header). `deno test --config supabase/functions/mcp/deno.json tests/deno`
runs the server unit tests.

## Known follow-ups (not blocking)

- Supabase's security advisor warns that the RLS helpers `owns_space`, `owns_item`,
  `owns_tag` can be called directly by signed-in users. They only answer
  "do I own this?" about the caller's own data. Could move to a private schema later.
- Performance advisor: add indexes on some foreign keys and wrap `auth.uid()` as
  `(select auth.uid())` in policies. Irrelevant at personal scale; one small migration later.
- Supabase grants new tables to `anon` by default: every future migration that
  creates a table must revoke `anon` (as `20260928120100_knowledge_path.sql` does).
- Edge Functions on the free plan allow ~2 s CPU per request, and embedding costs
  ~0.1-0.3 s per chunk. A save embeds up to 4 chunks itself; longer items are
  finished in the background, 5 chunks per request (`/embed-pending`), usually
  within seconds. Items are capped at ~40,000 characters.
- Search always returns the closest items even when nothing is really relevant
  (there is no similarity cut-off yet); Claude judges relevance from the snippets.
