// Recover or change the unlock passphrase: unlock the private key with the
// recovery key (or the current passphrase), wrap it with the new passphrase,
// and store only the new wrapped key. The key pair and all secrets stay as they are.
import { $, busy, errorText, revealToggle, rpc, show, status, withSession } from "./app.js";
import {
  forgetKeys, MIN_PASSPHRASE_LENGTH, rewrapPassphrase, unlockWithPassphrase, unlockWithRecoveryKey,
} from "./crypto.js";

$("pass1").after(revealToggle($("pass1")));

function mode() {
  return $("mode-passphrase").checked ? "passphrase" : "recovery";
}
for (const id of ["mode-recovery", "mode-passphrase"]) {
  $(id).addEventListener("change", () => {
    $("by-recovery").hidden = mode() !== "recovery";
    $("by-passphrase").hidden = mode() !== "passphrase";
  });
}

await withSession(async () => {
  const keys = await rpc("get_vault_keys");
  status(null);
  show(keys.set_up ? "change" : "nosetup");
});

$("change").addEventListener("submit", (e) => {
  e.preventDefault();
  const p1 = $("pass1").value, p2 = $("pass2").value;
  if (p1.length < MIN_PASSPHRASE_LENGTH) {
    return status(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`, "error");
  }
  if (p1 !== p2) return status("The two new passphrases are different.", "error");

  busy($("change"), "Unlocking and re-wrapping (a few seconds)…", async () => {
    let keys = null;
    try {
      const record = await rpc("get_vault_keys");
      keys = mode() === "recovery"
        ? unlockWithRecoveryKey(record, $("recovery-key").value)
        : unlockWithPassphrase(record, $("old-pass").value);
      const next = rewrapPassphrase(keys, p1);
      await rpc("rewrap_vault_passphrase", {
        p_wrapped_private_key: next.wrapped_private_key,
        p_vault_salt: next.vault_salt,
        p_kdf_params: next.kdf_params,
      });
    } catch (err) {
      return status(errorText(err), "error");
    } finally {
      forgetKeys(keys);
    }
    for (const id of ["recovery-key", "old-pass", "pass1", "pass2"]) $(id).value = "";
    status(null);
    show("done");
  });
});
