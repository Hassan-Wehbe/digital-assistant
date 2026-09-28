// Upload page: the owner opens a one-time link from the assistant, picks
// pictures or Visio files, and the browser sends them straight to the private
// `attachments` Storage bucket under the owner's folder. The page then records
// them in the database (complete_attachment_upload uses up the link) and asks
// the MCP server to index their text for meaning search.
// Everything shown from the database or a file is set with textContent (never parsed as HTML).
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../oauth/config.js";
import { ACCEPT, checkFile, extractVsdxText, storageName, TYPES } from "./filetypes.js";

// Refuse to run inside a frame (clickjacking); GitHub Pages cannot send
// frame-ancestors headers, so this is the page's own check.
if (window.top !== window.self) {
  document.documentElement.textContent = "";
  throw new Error("framed");
}

const $ = (id) => document.getElementById(id);
const BUCKET = "attachments";

// Same sign-in session as the vault and consent pages (same site, same storage key).
const db = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { detectSessionInUrl: false },
});

const SECTIONS = ["login", "pick", "done"];
function show(id) {
  for (const s of SECTIONS) $(s).hidden = s !== id;
}

function status(message, kind = "muted") {
  const el = $("status");
  el.textContent = message ?? "";
  el.hidden = !message;
  el.className = kind === "error" ? "error" : kind === "ok" ? "ok" : "muted";
}

async function rpc(fn, args = {}) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/** The link token, from "#t=..." (a fragment is never sent to any server). */
function linkToken() {
  const t = new URLSearchParams(location.hash.slice(1)).get("t");
  return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

function minutesLeft(iso) {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return m <= 1 ? "about a minute" : `${m} minutes`;
}

function sizeText(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function accessToken() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error("You were signed out; sign in again and reload this page.");
  return session.access_token;
}

const token = linkToken();
let request = null;
/** Picked files: { id (page-local), file, type, mime, text, caption (input), bar, note, row, attachmentId } */
let picked = [];
let uploading = false;
/** Attachment ids the link reserved; Storage accepts uploads only to these. Each is used once. */
let freeIds = [];

// ---------- picking ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function refresh() {
  $("upload").disabled = picked.length === 0;
  $("upload").textContent = picked.length > 1 ? `Upload ${picked.length} files` : "Upload";
  // Which picture Claude's description belongs to, when there is more than one.
  const pictures = picked.filter((p) => TYPES[p.type].picture);
  const select = $("desc-for");
  const keep = select.value;
  select.textContent = "";
  for (const p of pictures) {
    const o = el("option", null, p.file.name);
    o.value = p.id;
    select.append(o);
  }
  select.append(Object.assign(el("option", null, "None of these"), { value: "" }));
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  $("desc-for-box").hidden = !request?.description || pictures.length < 2;
}

async function addFiles(files) {
  if (!request || uploading) return;
  const max = request.max_files ?? 10;
  for (const file of files) {
    if (picked.length >= max) {
      status(`At most ${max} files per link. Ask the assistant for another link for the rest.`, "error");
      break;
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = checkFile(file.name, head, file.size);
    if (!check.ok) {
      status(`${file.name}: ${check.error}`, "error");
      continue;
    }
    let text = null;
    if (check.type === "vsdx") {
      try {
        text = await extractVsdxText(new Uint8Array(await file.arrayBuffer()));
      } catch (err) {
        status(`${file.name}: could not be read as a Visio drawing (${err.message}).`, "error");
        continue;
      }
    }
    addRow({ id: crypto.randomUUID(), file, type: check.type, mime: check.mime, text });
    status(null);
  }
  refresh();
}

function addRow(p) {
  const row = el("div", "file");
  const head = el("div", "file-head");
  const remove = el("button", "small", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => {
    picked = picked.filter((x) => x !== p);
    row.remove();
    refresh();
  });
  head.append(el("span", "file-name", p.file.name), remove);

  let about = `${TYPES[p.type].label}, ${sizeText(p.file.size)}`;
  if (p.type === "vsdx") {
    const words = p.text ? p.text.split(/\s+/).filter(Boolean).length : 0;
    about += words ? ` · ${words} words of diagram text found` : " · no text found in the diagram";
  } else if (p.type === "vsd") {
    about += " · older Visio format: stored, but only its name and caption are searchable";
  }
  p.note = el("p", "muted", about);

  const cid = `caption-${p.id}`;
  const label = el("label", null, "Caption (optional)");
  label.htmlFor = cid;
  p.caption = el("input");
  p.caption.id = cid;
  p.caption.type = "text";
  p.caption.maxLength = 1000;
  p.caption.placeholder = "What is it? Helps you find it later";

  p.bar = el("progress");
  p.bar.max = 100;
  p.bar.value = 0;
  p.bar.hidden = true;

  row.append(head, p.note, label, p.caption, p.bar);
  p.row = row;
  $("list").append(row);
  picked.push(p);
}

// ---------- uploading ----------

/** Send one file to Storage with progress (XMLHttpRequest reports upload progress; fetch does not). */
function put(path, p, jwt) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${jwt}`);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("Content-Type", p.mime);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) p.bar.value = Math.round((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `upload failed (${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText).message ?? message;
      } catch { /* keep the status text */ }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(p.file);
  });
}

function setBusy(on) {
  uploading = on;
  for (const c of $("pick").querySelectorAll("button, input, select")) c.disabled = on;
  if (!on) refresh();
}

async function upload() {
  setBusy(true);
  const done = [];
  const failed = [];
  try {
    const jwt = await accessToken();
    for (const [i, p] of picked.entries()) {
      status(`Uploading ${i + 1} of ${picked.length}: ${p.file.name}…`);
      p.bar.hidden = false;
      // A fresh reserved id per attempt, so a retry never collides with an earlier upload.
      p.attachmentId = freeIds.shift();
      if (!p.attachmentId) {
        failed.push(`${p.file.name}: too many attempts on this link`);
        continue;
      }
      const path = `${request.user_id}/${p.attachmentId}/${storageName(p.file.name)}`;
      try {
        await put(path, p, jwt);
        p.bar.value = 100;
        done.push({ p, path });
      } catch (err) {
        failed.push(`${p.file.name}: ${err.message}`);
        p.note.textContent = `Not uploaded: ${err.message}`;
        p.note.className = "error";
      }
    }
    if (!done.length) {
      status("Nothing was uploaded. Check the files and try again.", "error");
      return setBusy(false);
    }

    status("Saving…");
    const descIndex = picked.findIndex((p) => p.id === $("desc-for").value);
    const { data: result, error } = await db.rpc("complete_attachment_upload", {
      p_token: token,
      p_files: done.map(({ p }) => ({
        attachment_id: p.attachmentId,
        filename: p.file.name,
        storage_name: storageName(p.file.name),
        caption: p.caption.value.trim() || null,
        extracted_text: p.text || null,
      })),
      // Hidden list (0 or 1 picture): the server gives the description to the only picture.
      // "None of these": an id no file has, so the description is not applied.
      p_description_for: $("desc-for-box").hidden ? null
        : (picked[descIndex]?.attachmentId ?? "00000000-0000-0000-0000-000000000000"),
    });
    if (error) {
      if (!error.code) {
        // No answer from the database (network): the files may have been recorded. Keep them.
        throw new Error("Could not confirm the upload (network problem). Ask the assistant to show " +
          "the item before trying again: the files may already be attached.");
      }
      // The database refused: take the uploaded files back out of Storage.
      const { error: rmErr } = await db.storage.from(BUCKET).remove(done.map((d) => d.path));
      throw new Error(error.message + (rmErr ? " (Some uploaded files could not be removed again.)" : ""));
    }

    // Meaning search: ask the MCP server to embed the new text (keyword search already works).
    fetch(`${SUPABASE_URL}/functions/v1/mcp/embed-pending`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    }).catch(() => {});

    const n = result.attachments.length;
    $("done-summary").textContent = `${n} ${n === 1 ? "file" : "files"} attached to “${result.item_title}”.`;
    for (const a of result.attachments) {
      $("done-list").append(el("li", null, a.filename + (a.described ? " (with the description from the chat)" : "")));
    }
    if (failed.length) {
      $("done-failed").textContent = `Not uploaded: ${failed.join("; ")}. Ask the assistant for a new link to try again.`;
      $("done-failed").hidden = false;
    }
    picked = [];
    status(null);
    show("done");
  } catch (err) {
    status(err.message, "error");
    setBusy(false);
  }
}

// ---------- start ----------

async function start() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    status(null);
    return show("login");
  }
  $("who").textContent = session.user.email ?? "";
  $("account").hidden = false;
  try {
    request = await rpc("get_attachment_upload_request", { p_token: token });
  } catch (err) {
    show(null);
    return status(`${err.message} (If you have two accounts, check you are signed in to the right one.)`, "error");
  }
  $("m-item").textContent = request.item_title;
  $("m-space").textContent = request.space;
  $("m-expires").textContent = `${minutesLeft(request.expires_at)} more`;
  freeIds = [...(request.upload_ids ?? [])];
  if (request.description) {
    $("m-desc").textContent = request.description;
    $("desc-box").hidden = false;
  }
  $("files").accept = ACCEPT;
  status(null);
  show("pick");
}

$("files").addEventListener("change", async (e) => {
  await addFiles([...e.target.files]);
  e.target.value = "";
});
const drop = $("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (!uploading) await addFiles([...e.dataTransfer.files]);
});
$("pick").addEventListener("submit", (e) => {
  e.preventDefault();
  if (picked.length) upload();
});
$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  status("Signing in…");
  const { error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("password").value = "";
  if (error) return status(error.message, "error");
  await start();
});
$("signout").addEventListener("click", async (e) => {
  e.preventDefault();
  await db.auth.signOut();
  $("account").hidden = true;
  status(null);
  show("login");
});

if (!token) {
  status("This link is incomplete. Ask the assistant for a new one.", "error");
} else {
  await start();
}
