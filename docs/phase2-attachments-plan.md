# Phase 2, step 1: attachments (plan)

Status: built on branch `claude/zen-faraday-m5kjwc` (see "As built" at the end); the migration
and the Edge Function deploy wait for the owner's go-ahead. Read first: `CLAUDE.md`, `docs/design.md` (§2 tools, D9, roadmap
phase 2), `docs/phase1-m2-vault-plan.md` (the link-and-page pattern reused here).

## Decisions (owner, 2026-09-28)

1. **File types now:** pictures `.jpg` / `.jpeg` / `.png` and Visio diagrams. Audio, video
   and TIFF later.
2. **No AI keys (option A).** A picture becomes searchable through a description that
   Claude writes in the chat, where it can already see the picture. The server does not
   call any AI service. Visio text is read from the file itself, which needs no AI.
3. **Upload from phone or PC.** The upload page works in any browser; the owner signs in
   there with the same account as the vault pages.
4. **Every upload starts in the conversation, with context.** The owner tells Wilma where the
   file belongs (an existing item, or a space plus what it is). There is no upload without a
   space and a reason; if either is missing, Wilma asks before making a link.

## How it works

Chat tools carry text, not files, so files travel the way vault secrets do: a tool
returns a one-time link and the file goes from the owner's browser straight to storage.

**Attach** ("Wilma, attach this diagram to my Teams routing design", or "Wilma, save this
whiteboard photo to Work/Gartner, it's the Teams routing design"):

1. Claude calls `attach_file` with **either** an existing item **or** a space plus a title
   and note (the server then creates the item first, as `save_item` would). When the picture
   is in the chat, Claude adds a **description** it writes (what is shown, labels, any text
   in the image). Without a space or item, the tool is not called: Wilma asks first.
2. The server records a one-time **upload request** (15 minutes, stored as a hash like
   vault tokens) and returns an **upload link** `…/files/upload#t=…`.
3. The owner opens the link on phone or PC and picks one or more files. The Claude app
   cannot pass the picture itself to the server, so a picture already shown in the chat is
   picked once more here (phone photo picker or PC file dialog). A front end of our own
   (phase 3: Telegram, voice, web) can send the file directly and skip this step.
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
2. **MCP tools:** `attach_file` (existing item, or new item in a named space),
   `get_attachment_link`, `delete_attachment`; instructions updated ("Wilma, attach this…",
   and ask for the space and context when they are missing).
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

- TIFF (convert to PNG in the browser), audio and video transcripts (needs a
  speech-to-text key), automatic picture descriptions (needs an AI key).

## As built (2026-09-30)

What the build added or decided where the plan left room:

- **Files:** migration `supabase/migrations/20260930090000_attachments.sql`; MCP tools in
  `supabase/functions/mcp/tools/` (`attach_file`, `get_attachment_link`, `delete_attachment`,
  `describe_attachment`) with helpers in `lib/attachments.ts`; upload page `docs/files/upload.html`
  + `upload.js`, file checks and Visio reader `docs/files/filetypes.js` (no DOM, shared with the
  Deno tests). Server version 0.4.0, 17 tools.
- **One extra tool, `describe_attachment`:** the plan's migration has a "set a description"
  function but no tool used it. It sets or replaces a picture's description (for example, the
  picture is shown in the chat after the upload). Drop it if not wanted; nothing else depends on it.
- **Who may upload:** each upload link reserves 30 attachment ids (up to 10 files, with room
  for retries; the page never reuses an id after an attempt). The Storage insert policy allows
  `<user id>/<attachment id>/<name>` only for an id reserved by one of the user's open links,
  and only from a browser sign-in: the Claude connector's token (it carries `client_id`) cannot
  upload, read the upload request, or complete it. Read and delete: own folder only. No update
  policy, so a file is never overwritten.
- **Attachment rows are written only by the database functions** (`insert/update/delete` revoked
  from `authenticated`). `complete_attachment_upload` checks each file is really in Storage at
  the expected path, with an id reserved by this link, and takes **size and type from Storage's
  record** of the upload (the type is the one the page declared, limited by the bucket to the
  four allowed; the bytes themselves are checked on the page); the type must match the extension, and Visio text is accepted for `.vsdx` only (max
  40,000 characters, like an item).
- **One link, one batch:** up to 10 files are uploaded, then recorded in a single call that
  uses up the link. Files that failed to upload are listed on the page; trying them again needs
  a new link. If the database refuses to record them, the page removes the files it just
  uploaded; if the answer is lost (network), it keeps them and tells the owner to check the
  item first, since they may already be attached.
- **Claude's description** goes to the only picture of the batch; with several pictures the page
  asks which one it describes ("None of these" drops it).
- **Search text** per attachment: `File: <name>`, caption, description, Visio text. It is split
  into chunks in SQL (`_chunk_text`, 1,000 characters, whole lines) with embeddings left pending;
  the page then calls the MCP server's `/embed-pending`, the same background indexing long items
  use. Keyword search works at once; meaning search within seconds. `search_items` keyword
  search now reads item text plus attachment text (file names also with `. _ -` as spaces).
- **Storage names:** the path uses a safe form of the file name (letters, digits, `. _ -`); the
  original name is kept in `original_filename` and used for downloads.
- **get_item** lists per attachment: id, file name, type, size, caption, description, the first
  4,000 characters of Visio text, and when it was added. The storage path is never shown to
  the model.
- **Loose ends, on purpose:**
  - A file uploaded but never recorded (tab closed mid-way) stays in the owner's folder,
    unlisted and unsearchable. At most 30 per link, and its id is in the link's reserved list,
    so a later cleanup job can find it.
  - If `attach_file` creates a new item and then fails to create the link, the item stays;
    the error names it and its id, so Claude retries with `item_id` instead of making another.
  - There is no item purge yet; when one is added it must delete the item's Storage objects too.
  - Keyword search now builds the text of each candidate item (plus its attachments) per query
    instead of using the `item_fts_idx` index. Fine for a personal store; revisit (a stored,
    indexed search column) if searches get slow.
  - Visio text inherited from masters (stencil shapes with built-in labels) is not read; only
    text typed on the page's shapes and connectors, plus page names.
