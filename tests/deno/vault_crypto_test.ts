// Vault crypto round-trips, using the exact vendored libsodium the pages load.
// Most tests use light Argon2id settings for speed; one uses the real defaults.
import { assert, assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import {
  createVault, forgetKeys, formatRecoveryKey, fromB64, KDF_DEFAULT, openSecret, parseRecoveryKey,
  ready, rewrapPassphrase, sealSecret, unlockWithPassphrase, unlockWithRecoveryKey, VaultError,
} from "../../docs/vault/crypto.js";

const sodium = await ready();
const FAST = { alg: "argon2id13", ops: 2, mem: 16 * 1024 * 1024 }; // the database's minimum
const PASS = "correct horse battery staple";
const SECRET_ID = "3f1c9a52-8d7e-4b1a-9c3e-2a6f5d4e7b10";
const OTHER_ID = "9b2e4f61-1c3d-4e5f-8a7b-6c5d4e3f2a19";
const LOGIN = { username: "hassan@example.invalid", password: "Sandbox-Pa55word!" };

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof VaultError) return e.code;
    throw e;
  }
  return "no error";
}

Deno.test("setup -> seal -> unlock -> open, with the real default Argon2id settings", () => {
  assertEquals(KDF_DEFAULT, { alg: "argon2id13", ops: 3, mem: 64 * 1024 * 1024 });
  const { record } = createVault(PASS);
  const payload = sealSecret(record.public_key, SECRET_ID, "login", LOGIN);
  const keys = unlockWithPassphrase(record, PASS);
  assertEquals(openSecret(keys, payload, SECRET_ID), { type: "login", fields: LOGIN });
  forgetKeys(keys);
  assert(keys.privateKey.every((b: number) => b === 0), "private key wiped");
});

Deno.test("stored record has the sizes the database accepts, and no newlines", () => {
  const { record } = createVault(PASS, FAST);
  assertEquals(fromB64(record.public_key).length, 32);
  assertEquals(fromB64(record.wrapped_private_key).length, 72);
  assertEquals(fromB64(record.recovery_wrapped_private_key).length, 72);
  assertEquals(fromB64(record.vault_salt).length, 16);
  assertEquals(record.kdf_params, FAST);
  for (const v of Object.values(record)) if (typeof v === "string") assert(!v.includes("\n"));
});

Deno.test("sealing needs only the public key; the ciphertext hides the value and its length", () => {
  const { record } = createVault(PASS, FAST);
  const a = sealSecret(record.public_key, SECRET_ID, "login", { password: "x" });
  const b = sealSecret(record.public_key, SECRET_ID, "login", { password: "x".repeat(150) });
  assertEquals(fromB64(a).length, fromB64(b).length, "padded to the same size");
  const c = sealSecret(record.public_key, SECRET_ID, "login", LOGIN);
  assertNotEquals(c, sealSecret(record.public_key, SECRET_ID, "login", LOGIN), "fresh ephemeral key each time");
  const raw = new TextDecoder("latin1").decode(fromB64(c));
  assert(!raw.includes(LOGIN.password) && !c.includes(LOGIN.password));
  assert(!raw.includes(SECRET_ID), "secret id is inside the ciphertext, not beside it");
});

Deno.test("a wrong passphrase fails and reveals nothing", () => {
  const { record } = createVault(PASS, FAST);
  assertEquals(code(() => unlockWithPassphrase(record, PASS + " ")), "wrong_key");
  assertEquals(code(() => unlockWithPassphrase(record, "")), "wrong_key");
});

Deno.test("passphrases shorter than 12 characters are refused", () => {
  assertEquals(code(() => createVault("short pass", FAST)), "weak_passphrase");
});

Deno.test("passphrase is Unicode-normalized (same passphrase typed on different devices)", () => {
  const { record } = createVault("café au lait matin", FAST); // precomposed é
  const keys = unlockWithPassphrase(record, "café au lait matin"); // e + combining accent
  assertEquals(keys.publicKey.length, 32);
});

Deno.test("recovery key opens the vault and sets a new passphrase; the old one stops working", () => {
  const { record, recoveryKey } = createVault(PASS, FAST);
  const payload = sealSecret(record.public_key, SECRET_ID, "api_key", { key: "sk-test-123" });

  const keys = unlockWithRecoveryKey(record, recoveryKey);
  const rewrapped = rewrapPassphrase(keys, "a brand new passphrase", FAST);
  const updated = { ...record, ...rewrapped };
  assertEquals(updated.public_key, record.public_key, "public key unchanged");

  assertEquals(code(() => unlockWithPassphrase(updated, PASS)), "wrong_key");
  const again = unlockWithPassphrase(updated, "a brand new passphrase");
  assertEquals(openSecret(again, payload, SECRET_ID).fields, { key: "sk-test-123" });
  // The recovery key keeps working after a passphrase change.
  assertEquals(unlockWithRecoveryKey(updated, recoveryKey).publicKey, again.publicKey);
});

Deno.test("recovery key format: 11 groups of 5, forgiving input, typo detection", () => {
  const { record, recoveryKey } = createVault(PASS, FAST);
  assert(/^([A-Z2-7]{5}-){10}[A-Z2-7]{5}$/.test(recoveryKey), recoveryKey);
  // lower case, spaces instead of dashes, and look-alike digits still work
  const sloppy = recoveryKey.toLowerCase().replaceAll("-", " ").replaceAll("o", "0").replaceAll("i", "1");
  unlockWithRecoveryKey(record, sloppy);
  // one changed character is caught by the checksum
  const i = 7;
  const typo = recoveryKey.slice(0, i) + (recoveryKey[i] === "A" ? "B" : "A") + recoveryKey.slice(i + 1);
  assertEquals(code(() => parseRecoveryKey(typo)), "recovery_typo");
  // ...including the last character, which also carries 3 unused padding bits
  const last = recoveryKey.slice(0, -1) + (recoveryKey.endsWith("A") ? "B" : "A");
  assertEquals(code(() => parseRecoveryKey(last)), "recovery_typo");
  assertEquals(code(() => parseRecoveryKey("not a key")), "recovery_format");
  // a valid key from another vault does not open this one
  const other = createVault(PASS, FAST).recoveryKey;
  assertEquals(code(() => unlockWithRecoveryKey(record, other)), "wrong_key");
  // round trip of the encoding itself
  const raw = sodium.randombytes_buf(32);
  assertEquals(parseRecoveryKey(formatRecoveryKey(raw)), raw);
});

Deno.test("a ciphertext moved onto another secret's row is detected", () => {
  const { record } = createVault(PASS, FAST);
  const payload = sealSecret(record.public_key, SECRET_ID, "login", LOGIN);
  const keys = unlockWithPassphrase(record, PASS);
  assertEquals(code(() => openSecret(keys, payload, OTHER_ID)), "swapped");
});

Deno.test("a tampered ciphertext fails to open", () => {
  const { record } = createVault(PASS, FAST);
  const bytes = fromB64(sealSecret(record.public_key, SECRET_ID, "login", LOGIN));
  bytes[bytes.length - 1] ^= 1;
  const keys = unlockWithPassphrase(record, PASS);
  assertEquals(code(() => openSecret(keys, sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL), SECRET_ID)),
    "decrypt_failed");
});

Deno.test("a ciphertext sealed to another vault's key fails to open", () => {
  const mine = createVault(PASS, FAST).record;
  const theirs = createVault(PASS, FAST).record;
  const payload = sealSecret(theirs.public_key, SECRET_ID, "login", LOGIN);
  assertEquals(code(() => openSecret(unlockWithPassphrase(mine, PASS), payload, SECRET_ID)), "decrypt_failed");
});

Deno.test("a wrapped key swapped in from another vault is detected (public key check)", () => {
  const mine = createVault(PASS, FAST).record;
  const attacker = createVault(PASS, FAST).record;
  const swapped = { ...mine, wrapped_private_key: attacker.wrapped_private_key, vault_salt: attacker.vault_salt };
  assertEquals(code(() => unlockWithPassphrase(swapped, PASS)), "key_mismatch");
});
