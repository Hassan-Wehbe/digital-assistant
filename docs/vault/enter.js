// Entry page: the owner types a secret, the browser seals it to their public
// key, and only the ciphertext is uploaded. No passphrase is needed to save.
import { $, busy, errorText, linkToken, minutesLeft, revealToggle, rpc, show, status, withSession }
  from "./app.js";
import { SECRET_FIELDS, sealSecret } from "./crypto.js";

const TYPE_LABELS = {
  login: "Login", api_key: "API key", wifi: "Wi-Fi", recovery_codes: "Recovery codes", note: "Secure note",
};

const token = linkToken();
let request = null;

function buildFields(type) {
  const box = $("fields");
  box.textContent = "";
  for (const f of SECRET_FIELDS[type] ?? []) {
    const label = document.createElement("label");
    label.htmlFor = `f-${f.key}`;
    label.textContent = f.label;
    let input;
    if (f.kind === "textarea") {
      input = document.createElement("textarea");
      input.spellcheck = false;
    } else {
      input = document.createElement("input");
      input.type = f.kind === "password" ? "password" : "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.autocapitalize = "off";
    }
    input.id = `f-${f.key}`;
    input.dataset.key = f.key;
    input.required = !!f.required;
    box.append(label);
    if (f.kind === "password") {
      const row = document.createElement("div");
      row.className = "field";
      row.append(input, revealToggle(input));
      box.append(row);
    } else {
      box.append(input);
    }
  }
}

function clearFields() {
  for (const el of $("fields").querySelectorAll("[data-key]")) el.value = "";
}

if (!token) {
  status("This link is incomplete. Ask the assistant for a new one.", "error");
} else {
  await withSession(async () => {
    const keys = await rpc("vault_status");
    if (!keys?.set_up) {
      status(null);
      return show("nosetup");
    }
    try {
      request = await rpc("get_secret_entry_request", { p_token: token });
    } catch (err) {
      throw new Error(`${errorText(err)} (If you have two accounts, check you are signed in to the right one.)`);
    }
    $("title").textContent = request.is_update ? "New value for a secret" : "Save a secret";
    $("m-name").textContent = request.name;
    $("m-type").textContent = TYPE_LABELS[request.secret_type] ?? request.secret_type;
    $("m-space").textContent = request.space;
    $("m-url").textContent = request.url ?? "—";
    $("m-expires").textContent = `${minutesLeft(request.expires_at)} more`;
    buildFields(request.secret_type);
    status(null);
    show("entry");
    $("fields").querySelector("[data-key]")?.focus();
  });
}

$("entry").addEventListener("submit", (e) => {
  e.preventDefault();
  const fields = {};
  for (const el of $("fields").querySelectorAll("[data-key]")) {
    // Single-line values are kept exactly as typed (a password may end in a space).
    const v = el.tagName === "TEXTAREA" ? el.value.replace(/\s+$/, "") : el.value;
    if (v !== "") fields[el.dataset.key] = v;
  }
  busy($("entry"), "Encrypting and saving…", async () => {
    try {
      const payload = sealSecret(request.public_key, request.secret_id, request.secret_type, fields);
      await rpc("complete_secret_entry", { p_token: token, p_payload_enc: payload });
    } catch (err) {
      return status(errorText(err), "error");
    }
    clearFields();
    $("fields").textContent = "";
    $("done-name").textContent = request.name;
    status(null);
    show("done");
  });
});
