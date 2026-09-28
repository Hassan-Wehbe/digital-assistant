# Phase 2, step 1: attachments (plan)

Status: plan, not built. Read first: `CLAUDE.md`, `docs/design.md` (§2 tools, D9, roadmap
phase 2), `docs/phase1-m2-vault-plan.md` (the link-and-page pattern reused here).

## Decisions (owner, 2026-09-28)

1. **File types now:** pictures `.jpg` / `.jpeg` / `.png` and Visio diagrams. Audio, video
   and TIFF later.
2. **No AI keys (option A).** A picture becomes searchable through a description that
   Claude writes in the chat, where it can already see the picture. The server does not
   call any AI service. Visio text is read from the file itself, which needs no AI.
3. **Upload from phone or PC.** The upload page works in any browser; the owner signs in
   there with the same account as the vault pages.

## How it works

Chat tools carry text, not files, so files travel the way vault secrets do: a tool
returns a one-time link and the file goes from the owner's browser straight to storage.

**Attach** ("Wilma, attach this diagram to my Teams routing design"):

1. Claude calls `attach_file` with the item and, when the picture is in the chat, a
   **description** it writes (what is shown, labels, any text in the image).
2. The server records a one-time **upload request** (15 minutes, stored as a hash like
   vault tokens) and returns an **upload link** `…/files/upload#t=…`.
3. The owner opens the link on phone or PC and picks one or more files.
4. The page checks each file (type from its first bytes, not just the name; size limit),
   reads the text out of a Visio `.vsdx`, and uploads the file to a **private Storage
   bucket** under the owner's folder.
5. The page confirms the upload to the database: an `attachment` row is written with
   filename, type, size, and its searchable text (Claude's description, the owner's
   optional caption, Visio text). That text is split into chunks for search; the page
   then asks the server to compute their embeddings (the existing background indexing).

**Find:** `search_items` also matches attachment filenames, descriptions and Visio text,
by keyword and by meaning. Results point to the item that owns the attachment.

**Open:** `get_item` lists an item's attachments. `get_attachment_link` returns a
short-lived (10 minute) download link for the owner to open. Claude does not open it.

**Describe later:** `describe_attachment` sets or replaces the description, for a
picture uploaded straight from the phone and shown to Claude afterwards.

**Remove:** `delete_attachment` deletes the file and its search text (the owner confirms
first). Items keep their soft delete; purging an item removes its files.

## Visio

- **`.vsdx`** (Visio 2013 and later) is a zip of XML files. The upload page reads the
  shape and connector text and the page names with the browser's built-in unzip
  (`DecompressionStream`), with no third-party code, and sends that text with the upload.
  A `.vsdx` diagram is then searchable by the words on it ("falcon queue", "SBC").
- **`.vsd`** (older binary format) is stored and downloadable, but only its filename and
  caption are searchable. Tip: export a PNG and attach it too, and Claude can describe it.
- Claude cannot see inside a Visio file in the chat, so Visio text always comes from the
  upload page.

## Storage and limits

- One private bucket, `attachments`. Object path `<user id>/<attachment id>/<file name>`.
  Storage row-level security: a user can only write, read and delete under their own
  folder. Nothing is public; downloads use short-lived signed links.
- **20 MB per file** (bucket setting). Supabase's free plan allows 1 GB of storage in total.
  That is thousands of photos and diagrams; the plan can be raised later.
- Accepted types are checked twice: by the page (first bytes: PNG signature, JPEG
  `FF D8 FF`, zip for `.vsdx`, OLE for `.vsd`) and by the bucket's allowed types.
- Files are encrypted at rest by Supabase but are **not** end-to-end encrypted like the
  vault. They are knowledge, not credentials.

## Rules that still hold

- **Rule 1-2 (secrets):** a description never transcribes a password, key or code
  visible in a picture. The server instructions and the tool description say so, and
  the upload page reminds the owner that credentials belong in the vault.
- **Rule 3 (restricted spaces):** an attachment belongs to an item, so its text is
  searched only when the item's space is searchable.
- **Rule 4 (sharing):** attachments hang off items only. Nothing links a file to a secret.
- **Rule 5 (ownership):** RLS on `attachment` and the upload-request table; Storage
  policies on the owner's folder; the upload page's database functions check the
  token's owner, as the vault pages do.
- **Rule 7 (history):** attachments are not versioned. Replacing a file means attaching
  the new one and deleting the old one.
- Every new table and function: revoke `anon`, grant only what `authenticated` needs.

## What gets built

1. **Migration `attachments`:** bucket and Storage policies; `attachment` gains
   `size_bytes`, `caption`, `extracted_text`; table `attachment_upload_request`
   (token hash, item, description, expiry, used); functions to create a request (MCP),
   read and complete it (upload page), and set a description; `search_items` keyword
   search extended to attachment text; `get_item` attachment list extended.
2. **MCP tools:** `attach_file`, `get_attachment_link`, `describe_attachment`,
   `delete_attachment`; instructions updated ("Wilma, attach this…").
3. **Upload page** `docs/files/upload.html`: same hardening as the vault pages (strict
   CSP, same-origin code only, integrity hashes, frame check); drag-and-drop on PC,
   camera/photo picker on phone; progress and a clear result ("2 files attached to
   *Teams routing design*").
4. **Tests:**
   - SQL: two-user isolation for attachments, requests and Storage objects;
     restricted-space exclusion of attachment text; one-time and expiry rules.
   - Deno: tool output shape, the Visio text extractor (against a small `.vsdx` built
     in the test), and the file-type sniffing.
   - Browser: attach a PNG and a `.vsdx` through the real page against the project with
     a throwaway user, then find both by search.

Live steps (migration, Edge Function deploy) are applied only with the owner's go-ahead.

## Later (not in this step)

- Starting an upload from the page itself, without a chat ("new item from these files").
- TIFF (convert to PNG in the browser), audio and video transcripts (needs a
  speech-to-text key), automatic picture descriptions (needs an AI key).
