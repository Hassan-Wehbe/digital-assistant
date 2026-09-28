// Reveal page: unlock the private key with the passphrase (in this browser),
// then use the single-use link to fetch the ciphertext and decrypt it.
// The value is shown for 30 seconds, then wiped from the page; a copied value
// is cleared from the clipboard 30 seconds after copying. Nothing is stored.
import { $, busy, errorText, linkToken, minutesLeft, revealToggle, rpc, show, status, withSession }
  from "./app.js";
import { forgetKeys, openSecret, SECRET_FIELDS, unlockWithPassphrase } from "./crypto.js";

const SHOW_SECONDS = 30;
const TYPE_LABELS = {
  login: "Login", api_key: "API key", wifi: "Wi-Fi", recovery_codes: "Recovery codes", note: "Secure note",
};

const token = linkToken();
let request = null;
let hideTimer = null, tick = null, clipboardTimer = null;
let copiedValue = null;

$("passphrase").after(revealToggle($("passphrase")));

if (!token) {
  status("This link is incomplete. Ask the assistant for a new one.", "error");
} else {
  await withSession(async () => {
    try {
      request = await rpc("get_reveal_request", { p_token: token });
    } catch (err) {
      throw new Error(`${errorText(err)} (If you have two accounts, check you are signed in to the right one.)`);
    }
    $("m-name").textContent = request.name;
    $("m-type").textContent = TYPE_LABELS[request.secret_type] ?? request.secret_type;
    $("m-space").textContent = request.space;
    $("m-url").textContent = request.url ?? "—";
    $("m-expires").textContent = `${minutesLeft(request.expires_at)} more`;
    status(null);
    show("unlock");
    $("passphrase").focus();
  });
}

$("unlock").addEventListener("submit", (e) => {
  e.preventDefault();
  busy($("unlock"), "Unlocking (a few seconds)…", async () => {
    let keys = null;
    try {
      const record = await rpc("get_vault_keys");
      if (!record.set_up) throw new Error("Your vault is not set up yet.");
      // Check the passphrase before using up the link, so a typo costs nothing.
      keys = unlockWithPassphrase(record, $("passphrase").value);
      $("passphrase").value = "";
      const sealed = await rpc("reveal_secret", { p_token: token });
      if (sealed.secret_id !== request.secret_id) throw new Error("The link changed while unlocking. Ask for a new one.");
      const secret = openSecret(keys, sealed.payload_enc, sealed.secret_id);
      display(sealed, secret);
    } catch (err) {
      status(errorText(err), "error");
    } finally {
      forgetKeys(keys);
    }
  });
});

function display(meta, secret) {
  const box = $("values");
  box.textContent = "";
  const specs = SECRET_FIELDS[secret.type] ?? [];
  const known = new Set(specs.map((f) => f.key));
  const rows = [
    ...specs.filter((f) => secret.fields[f.key] !== undefined),
    ...Object.keys(secret.fields).filter((k) => !known.has(k)).map((k) => ({ key: k, label: k, kind: "text" })),
  ];
  for (const f of rows) {
    const value = String(secret.fields[f.key]);
    const masked = f.kind === "password" || f.secret;
    const wrap = document.createElement("div");
    wrap.className = "secret-row";
    const label = document.createElement("div");
    label.className = "muted";
    label.textContent = f.label.replace(/ \(optional\)$/, "");
    const shown = document.createElement("div");
    shown.className = "value";
    shown.textContent = masked ? "•".repeat(12) : value;
    const actions = document.createElement("div");
    actions.className = "row";
    if (masked) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "small";
      b.textContent = "Show";
      b.addEventListener("click", () => {
        const on = b.textContent === "Show";
        shown.textContent = on ? value : "•".repeat(12);
        b.textContent = on ? "Hide" : "Show";
      });
      actions.append(b);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "small";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => copyValue(value));
    actions.append(copy);
    wrap.append(label, shown, actions);
    box.append(wrap);
  }
  $("s-name").textContent = meta.name;
  $("s-url").textContent = meta.url ?? "";
  status(null);
  show("shown");

  let left = SHOW_SECONDS;
  $("countdown").textContent = `Hides in ${left} s.`;
  tick = setInterval(() => {
    left -= 1;
    $("countdown").textContent = `Hides in ${Math.max(left, 0)} s.`;
  }, 1000);
  hideTimer = setTimeout(hide, SHOW_SECONDS * 1000);
}

async function copyValue(value) {
  try {
    await navigator.clipboard.writeText(value);
    copiedValue = value;
    status(`Copied. The clipboard is cleared in ${SHOW_SECONDS} s.`, "ok");
    clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(clearClipboard, SHOW_SECONDS * 1000);
  } catch {
    status("Copy did not work here; use Show and copy it by hand.", "error");
  }
}

async function clearClipboard() {
  if (copiedValue === null) return;
  try {
    await navigator.clipboard.writeText("");
    status("Clipboard cleared.", "muted");
  } catch {
    // Browsers only allow clipboard writes while the page has focus.
    status("Could not clear the clipboard (this tab was not in focus). Copy something else over it.", "error");
  }
  copiedValue = null;
}

function hide() {
  clearTimeout(hideTimer);
  clearInterval(tick);
  $("values").textContent = "";
  $("s-name").textContent = $("s-url").textContent = "";
  show("hidden-done");
}

$("hide-now").addEventListener("click", hide);
// Leaving the page: wipe the value, and try to clear a copied value right away.
addEventListener("pagehide", () => {
  hide();
  if (copiedValue !== null) clearClipboard();
});
