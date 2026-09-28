# Phase 1, milestone 2: set up your vault and save your first password

What is already done (by Claude Code, 2026-09-28):

- Database: migration `vault` applied to project `digital-assistant` (ref `motvckmpusxiuelpwqxy`).
  SQL tests passed on the project (all rolled back): 64 vault checks plus the milestone-1 checks.
- MCP server redeployed as Edge Function `mcp`, **version 3**: the 7 knowledge tools plus
  `save_secret`, `find_secret`, `get_secret`, `update_secret`, `delete_secret`.
- Vault pages in `docs/vault/` (published by GitHub Pages from this branch, like the sign-in page):
  `setup`, `enter`, `reveal`, `recover`.
- Live tests passed with a throwaway user, which was then deleted: the end-to-end test
  (12 tool responses scanned; no password, passphrase or ciphertext ever reached a tool
  result) and a real-browser run of all four pages (setup, save, wrong passphrase refused,
  reveal, copy, hide, recovery key, new passphrase, 30-second auto-hide).

Your vault is **not set up yet**: only you can do that, because only you may know the passphrase.

## How it works, in one paragraph

Passwords never go through the chat. When you ask Claude to store one, it gives you a
**link**. The link opens a page on your own site where you type the password; your
browser encrypts it before sending it, so the database only ever holds scrambled bytes.
When you ask for it back, Claude gives you another link; that page asks for your **vault
passphrase**, decrypts in your browser, and shows the value for 30 seconds. Claude, the
server and Supabase never see the password or the passphrase. Links work once and expire
(15 minutes to save, 10 minutes to reveal).

You will have **three** different things. Keep them apart:

| What | Used for | Where it lives |
|---|---|---|
| Account password | signing in to your Digital Assistant (milestone 1) | your password manager |
| **Vault passphrase** (new) | unlocking your secrets on the reveal page | your password manager |
| **Recovery key** (new) | resetting the passphrase if you forget it | password manager (separate entry) and/or printed |

If you lose **both** the vault passphrase and the recovery key, your stored secrets are
gone for good. Nobody can recover them; that is what "zero-knowledge" means.

Never paste a password, passphrase or recovery key into a chat (with Claude or anyone).
If it happens anyway, change that password.

## Step 1. Check the vault pages are online (1 minute)

GitHub Pages already publishes this branch's `/docs` folder (milestone 1, step 5).
Open <https://hassan-wehbe.github.io/digital-assistant/vault/>. You should see
**"Digital Assistant vault"** with two links. If you get a 404, check GitHub →
**Settings** → **Pages**: the source must be branch `claude/festive-fermat-fg6i75`, folder
**`/docs`** (not `/ (root)`). With `/ (root)` the pages end up under `…/docs/vault/` and
neither the vault links nor the connector sign-in page (`…/oauth/consent`) work. After
changing it, wait two minutes and reload.

## Step 2. Protect the branch the pages come from (recommended, 3 minutes)

Whoever can change the files in `docs/vault/` could change the pages to capture your
passphrase. So make sure nobody can push to that branch unnoticed, including by accident.

GitHub → repo **digital-assistant** → **Settings** → **Rules** → **Rulesets** →
**New ruleset** → **New branch ruleset**:

- Name: `protect pages`
- Enforcement status: **Active**
- Target branches → **Add target** → **Include by pattern**: `claude/festive-fermat-fg6i75`
  (add `main` too; after merging you will switch Pages to `main`)
- Rules: tick **Restrict deletions**, **Block force pushes**, and
  **Require a pull request before merging**.
- **Create**.

(With "Require a pull request" on, Claude Code sessions will propose changes as pull
requests that you merge, instead of pushing straight to the branch.)

Also keep **two-factor authentication** on for your GitHub account
(GitHub → your photo → **Settings** → **Password and authentication**).

## Step 3. Prepare two password-manager entries (2 minutes)

In your password manager, create:

1. **"Digital Assistant – vault passphrase"**. Let the password manager generate it:
   a passphrase of 5–6 random words, or at least 16 random characters. It must be
   different from your account password.
2. **"Digital Assistant – vault recovery key"**. Leave it empty for now; you will
   paste the key into it in step 4.

## Step 4. Set up the vault (3 minutes, on your computer)

1. Open <https://hassan-wehbe.github.io/digital-assistant/vault/setup>.
2. Sign in with your **Digital Assistant account** email and password (the account
   from milestone 1). The page remembers this sign-in, like the connector's sign-in page does.
3. **Unlock passphrase**: paste the vault passphrase from entry 1. Paste it again in
   **Type it again**. Tick **I understand…** and click **Create my vault keys**. Wait a
   few seconds.
4. **Your recovery key** appears: 11 groups of 5 characters, shown only once.
   - Click **Copy**, paste it into password-manager entry 2 and save that entry.
   - Optional: click **Print** and keep the paper somewhere safe (not next to your computer).
   - Clear your clipboard afterwards (copy some harmless text).
5. Paste the recovery key into **To confirm you saved it…** and click **Finish setup**.
6. You see **"Your vault is ready."** Close the tab.

## Step 5. Make sure Claude sees the new tools (1 minute)

1. In claude.ai (or the app), start a **new chat**. Open the **Search and tools** menu
   (sliders icon) and check that **Digital Assistant** is on.
2. Ask: *"Which vault tools do you have?"* Claude should mention `save_secret` and `get_secret`.
3. If it only knows the older tools: **Settings** → **Connectors** → **Digital Assistant**
   → **Disconnect**, then **Connect** again and approve on the sign-in page. Then start a
   new chat.

## Step 6. Save your first password (2 minutes)

1. In the chat, say for example:
   *"Store my Gartner sandbox login in my Work space. The website is https://sandbox.gartner.com."*
   (If you have no Work space yet, Claude will create one or ask you.)
   **Do not type the password in the chat.**
2. Claude answers with a link like `https://hassan-wehbe.github.io/digital-assistant/vault/enter#t=…`
   (valid 15 minutes). Open it.
3. The page shows **Name**, **Type**, **Space** and **Website**. Check they are what you meant.
   (If it asks you to sign in, use your **account** password.)
4. Type the **username** and the **password** (click **Show** to check what you typed).
   Notes are optional.
5. Click **Encrypt and save**. You see **"Saved."** Close the tab and tell Claude *"done"*.

Saving never asks for your vault passphrase: the page only needs your public key to lock
the value. Unlocking is what needs the passphrase.

## Step 7. Find it and reveal it (2 minutes)

1. Ask: *"Which passwords do I have in Work?"* Claude lists names and websites only.
2. Ask: *"Give me the Gartner sandbox login."* Claude answers with a reveal link
   (valid 10 minutes, works once). Open it.
3. Enter your **vault passphrase** (not your account password) and click **Unlock and show**.
   A wrong passphrase just shows "That passphrase is not right"; the link stays usable.
4. The username is shown and the password is masked. Click **Show** to see it, or
   **Copy** to put it on the clipboard.
5. After **30 seconds** the value disappears from the page. A copied value is cleared from
   the clipboard 30 seconds after copying, as long as the tab is still open and in front.
   Otherwise copy something else over it. **Hide now** hides it immediately.

To see it again later, ask Claude again: each reveal needs a new link.

## Step 8. Test your recovery key once (recommended, 2 minutes)

Do this now, while you know everything works:

1. Open <https://hassan-wehbe.github.io/digital-assistant/vault/recover>.
2. Choose **I forgot my passphrase: use my recovery key**, paste the recovery key.
3. Enter a new passphrase twice (you may enter your current one again) and click
   **Set new passphrase**. You see **"Done."**
4. If you chose a new passphrase, update password-manager entry 1. Your recovery key
   stays the same.

The same page, with **I know my passphrase**, is how you change the passphrase later.

## Everyday use

- **Save**: *"Save the office Wi-Fi password in Home."* / *"Store my OpenAI API key in Work."*
  Types: login, API key, Wi-Fi, recovery codes, secure note.
- **Reveal**: *"Give me the office Wi-Fi password."*
- **Change the value** (after you changed the password on the website):
  *"I changed my Gartner sandbox password; update it."* Claude gives you a new entry link.
- **Rename / move the website**: *"Rename the Gartner sandbox login to Gartner sandbox (EU)."*
- **Delete**: *"Delete the old Gartner sandbox login."* Claude confirms the name first.
- **On your phone**: the links open in the phone's browser. Sign in once, then paste the
  passphrase from your phone's password manager.
- Secrets saved in a **restricted** space are never listed by *"which passwords do I have"*
  searches (unlocking restricted spaces comes in a later milestone).

## If something goes wrong

- **"This link has expired or was already used"**: ask Claude for a new link.
  (If you have two accounts, check the page's "Signed in as" line.)
- **"That passphrase is not right"**: you need the *vault passphrase*, not the account
  password. Forgot it? Step 8 (recover page) with the recovery key.
- **"The recovery key has a typo"**: check it character by character; case, spaces and
  dashes don't matter.
- **Claude says the vault is not set up**: do step 4.
- **Claude asks you to type a password in the chat**: don't. Say *"use save_secret and give
  me the link"*. If you already typed one, change that password on the website, then
  save the new one through the link.
- **The page stays on "Loading…"**: reload; if it persists, open it in a normal browser
  window (not inside another app), and ask Claude Code to check the vault pages.
- **Lost both the passphrase and the recovery key**: the stored secrets cannot be
  decrypted by anyone. Ask Claude Code to reset your vault (it deletes the unreadable
  secrets and clears your keys) and set it up again with step 4.

## Running the tests again

- SQL (database rules): ask Claude Code to *"run the SQL tests in tests/sql against the project"*;
  `tests/sql/04_vault.sql` is the vault.
- Unit tests: `deno test -A --config supabase/functions/mcp/deno.json tests/deno`
  (crypto round trips, page hardening and integrity hashes, tool output shape).
- End-to-end and real-browser tests need a **throwaway** user (never your account);
  see the headers of `tests/e2e/vault_e2e.ts` and `tests/browser/vault_flow.mjs`.
- After editing anything in `docs/vault/`: `node scripts/vault-sri.mjs` (updates the
  integrity hashes the pages check).

## Known follow-ups (not blocking)

- Expired/used links are refused correctly, but the API reports that as HTTP 500
  (error code `P0002`) instead of a 4xx. Cosmetic: the page shows the right message.
  A small migration can switch it to a 4xx.
- Supabase's security advisor lists the vault functions as "callable by signed-in users".
  That is intended: each one checks who is calling (owner only; vault-page functions
  also refuse the connector's token). The two link-token tables have RLS on with no
  policies, also intended (only those functions read them).
- Supabase Auth **leaked password protection** (checks your *account* password against
  known breaches) is off. Optional, and only on paid Supabase plans; the advisor's link
  (<https://supabase.com/docs/guides/auth/password-security>) shows where to switch it on.
- The sign-in/consent page (`docs/oauth/`, milestone 1) still loads supabase-js from a
  CDN; it could use the vendored copy in `docs/vault/vendor/` like the vault pages.
- CLAUDE.md says migrations go in `db/migrations/`; since milestone 1 they live in
  `supabase/migrations/` (the Supabase CLI location). Worth aligning the wording.
- Later milestones: unlocking restricted spaces per session, emergency access, rotation
  reminders (`secret.expires_at`).
- When this branch is merged: switch GitHub Pages to `main` (same `/docs` folder; links
  keep working) and keep the branch ruleset from step 2 on `main`.
