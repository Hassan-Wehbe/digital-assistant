// First-time vault setup: create the key pair, wrap it with the passphrase and
// a recovery key, show the recovery key once, and store only wrapped keys.
import { $, busy, errorText, revealToggle, rpc, show, status, withSession } from "./app.js";
import { createVault, forgetKeys, MIN_PASSPHRASE_LENGTH, parseRecoveryKey } from "./crypto.js";
import sodium from "./vendor/libsodium-wrappers.mjs";

let pending = null; // { record, recoveryKey, keys } between the two steps, in memory only

$("pass1").after(revealToggle($("pass1")));

await withSession(async (email) => {
  const keys = await rpc("get_vault_keys");
  status(null);
  if (keys.set_up) return show("already");
  $("print-who").textContent = email;
  show("choose");
});

$("choose").addEventListener("submit", (e) => {
  e.preventDefault();
  const p1 = $("pass1").value, p2 = $("pass2").value;
  if (p1.length < MIN_PASSPHRASE_LENGTH) {
    return status(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`, "error");
  }
  if (p1 !== p2) return status("The two passphrases are different.", "error");
  busy($("choose"), "Creating your keys (a few seconds)…", () => {
    try {
      pending = createVault(p1);
    } catch (err) {
      return status(errorText(err), "error");
    }
    $("pass1").value = $("pass2").value = "";
    $("recovery-key").textContent = pending.recoveryKey;
    $("print-date").textContent = new Date().toLocaleDateString();
    status(null);
    show("recovery");
  });
});

$("copy-key").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(pending.recoveryKey);
    status("Copied. Paste it into your password manager, then clear your clipboard.", "ok");
  } catch {
    status("Copy did not work here; select the key and copy it by hand.", "error");
  }
});
$("print-key").addEventListener("click", () => window.print());

$("recovery").addEventListener("submit", (e) => {
  e.preventDefault();
  let typed;
  try {
    typed = parseRecoveryKey($("confirm-key").value);
  } catch (err) {
    return status(errorText(err), "error");
  }
  const shown = parseRecoveryKey(pending.recoveryKey);
  const same = sodium.memcmp(typed, shown);
  sodium.memzero(typed);
  sodium.memzero(shown);
  if (!same) return status("That is not the recovery key shown above.", "error");

  busy($("recovery"), "Saving your vault…", async () => {
    try {
      await rpc("setup_vault", {
        p_public_key: pending.record.public_key,
        p_wrapped_private_key: pending.record.wrapped_private_key,
        p_recovery_wrapped_private_key: pending.record.recovery_wrapped_private_key,
        p_vault_salt: pending.record.vault_salt,
        p_kdf_params: pending.record.kdf_params,
      });
    } catch (err) {
      return status(errorText(err), "error");
    }
    forgetKeys(pending.keys);
    pending = null;
    $("confirm-key").value = "";
    $("recovery-key").textContent = "";
    status(null);
    show("done");
  });
});
