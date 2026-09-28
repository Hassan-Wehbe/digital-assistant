// Vault cryptography, shared by the vault pages and tests/deno/vault_crypto_test.ts.
// Plan: docs/phase1-m2-vault-plan.md ("Cryptography").
//
// Everything here runs in the owner's browser. Only the outputs marked
// "stored" ever leave it; the passphrase, recovery key, private key and
// secret values stay in memory.
//
//   key pair        X25519 (crypto_box). Public key stored in plaintext.
//   passphrase key  Argon2id(passphrase, vault_salt, kdf_params) -> 32 bytes
//   recovery key    32 random bytes shown once; wrapping key =
//                   crypto_kdf_derive_from_key(id 1, context "DAvault1")
//   wrapped keys    nonce(24) || secretbox(private key)          (stored, 72 bytes)
//   secret payload  crypto_box_seal(padded JSON, public key)     (stored)
//                   JSON = {"v":1,"secret_id","type","fields":{...}}
//
// Saving needs only the public key (no passphrase); revealing needs the
// private key, i.e. the passphrase or the recovery key.
import sodium from "./vendor/libsodium-wrappers.mjs";

/** @typedef {{ alg: string, ops: number, mem: number }} KdfParams */

/** @type {Readonly<KdfParams>} */
export const KDF_DEFAULT = Object.freeze({ alg: "argon2id13", ops: 3, mem: 64 * 1024 * 1024 });
export const MIN_PASSPHRASE_LENGTH = 12;

const RECOVERY_CONTEXT = "DAvault1"; // crypto_kdf context: exactly 8 characters
const RECOVERY_SUBKEY_ID = 1;
const PAD_BLOCK = 256; // hide the exact length of a value
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Errors the pages show to the owner as-is. `code` lets callers react. */
export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/** @returns {Promise<any>} the initialized libsodium module */
export async function ready() {
  await sodium.ready;
  return sodium;
}

// ---------- encoding (standard base64, as Postgres decode(..., 'base64') expects) ----------

export function toB64(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export function fromB64(text, what = "value") {
  try {
    return sodium.from_base64(text, sodium.base64_variants.ORIGINAL);
  } catch {
    throw new VaultError("bad_data", `The stored ${what} is not valid.`);
  }
}

// ---------- recovery key: 32 random bytes + 2-byte checksum, base32, groups of 5 ----------

function checksum(bytes) {
  return sodium.crypto_generichash(16, bytes).subarray(0, 2);
}

function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function formatRecoveryKey(key32) {
  const full = new Uint8Array(34);
  full.set(key32);
  full.set(checksum(key32), 32);
  return base32Encode(full).match(/.{1,5}/g).join("-");
}

/** Accepts any case, spaces or dashes, and the look-alikes 0/1/8 for O/I/B. */
export function parseRecoveryKey(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z0-9]/g, "")
    .replace(/0/g, "O").replace(/1/g, "I").replace(/8/g, "B");
  const bytes = clean.length === 55 ? base32Decode(clean) : null;
  if (!bytes || bytes.length !== 34) {
    throw new VaultError("recovery_format",
      "That doesn't look like a recovery key. It has 11 groups of 5 letters and digits.");
  }
  const key = bytes.subarray(0, 32);
  // The last character also carries 3 unused bits; only the canonical spelling
  // is accepted, so every changed character is reported as a typo.
  if (!sodium.memcmp(checksum(key), bytes.subarray(32)) || base32Encode(bytes) !== clean) {
    throw new VaultError("recovery_typo", "The recovery key has a typo. Check it and try again.");
  }
  return Uint8Array.from(key);
}

// ---------- key wrapping ----------

function checkKdfParams(p) {
  if (!p || p.alg !== "argon2id13" || !Number.isInteger(p.ops) || !Number.isInteger(p.mem)) {
    throw new VaultError("bad_data", "The vault's key settings are not valid.");
  }
  return p;
}

function passphraseKey(passphrase, salt, params) {
  const p = checkKdfParams(params);
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    String(passphrase).normalize("NFKC"),
    salt, p.ops, p.mem, sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function recoveryWrappingKey(recoveryKey32) {
  return sodium.crypto_kdf_derive_from_key(
    sodium.crypto_secretbox_KEYBYTES, RECOVERY_SUBKEY_ID, RECOVERY_CONTEXT, recoveryKey32,
  );
}

function wrap(key, privateKey) {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const box = sodium.crypto_secretbox_easy(privateKey, nonce, key);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce);
  out.set(box, nonce.length);
  return out;
}

function unwrap(key, wrapped, publicKey, wrongKeyMessage) {
  const n = sodium.crypto_secretbox_NONCEBYTES;
  let privateKey;
  try {
    privateKey = sodium.crypto_secretbox_open_easy(wrapped.subarray(n), wrapped.subarray(0, n), key);
  } catch {
    throw new VaultError("wrong_key", wrongKeyMessage);
  }
  // The unwrapped key must belong to the stored public key; otherwise the
  // stored wrapped key was replaced and nothing it opens can be trusted.
  if (!sodium.memcmp(sodium.crypto_scalarmult_base(privateKey), publicKey)) {
    sodium.memzero(privateKey);
    throw new VaultError("key_mismatch",
      "The stored vault key does not match your public key. Do not continue; ask for help.");
  }
  return privateKey;
}

// ---------- vault lifecycle ----------

/**
 * @param {string} passphrase
 * @param {KdfParams} [params]
 * First-time setup. Returns `record` (stored via setup_vault), the recovery
 * key to show once, and the unlocked keys.
 */
export function createVault(passphrase, params = KDF_DEFAULT) {
  if (String(passphrase).length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError("weak_passphrase",
      `Use at least ${MIN_PASSPHRASE_LENGTH} characters (a few unrelated words work well).`);
  }
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const recoveryKey = sodium.randombytes_buf(32);

  const pk = passphraseKey(passphrase, salt, params);
  const rk = recoveryWrappingKey(recoveryKey);
  const record = {
    public_key: toB64(publicKey),
    wrapped_private_key: toB64(wrap(pk, privateKey)),
    recovery_wrapped_private_key: toB64(wrap(rk, privateKey)),
    vault_salt: toB64(salt),
    kdf_params: { ...params },
  };
  const recoveryText = formatRecoveryKey(recoveryKey);
  sodium.memzero(pk);
  sodium.memzero(rk);
  sodium.memzero(recoveryKey);
  return { record, recoveryKey: recoveryText, keys: { publicKey, privateKey } };
}

/** `record` is what get_vault_keys returns. */
export function unlockWithPassphrase(record, passphrase) {
  const publicKey = fromB64(record.public_key, "public key");
  const key = passphraseKey(passphrase, fromB64(record.vault_salt, "salt"), record.kdf_params);
  try {
    const privateKey = unwrap(key, fromB64(record.wrapped_private_key, "vault key"), publicKey,
      "That passphrase is not right.");
    return { publicKey, privateKey };
  } finally {
    sodium.memzero(key);
  }
}

export function unlockWithRecoveryKey(record, recoveryKeyText) {
  const publicKey = fromB64(record.public_key, "public key");
  const recoveryKey = parseRecoveryKey(recoveryKeyText);
  const key = recoveryWrappingKey(recoveryKey);
  try {
    const privateKey = unwrap(key, fromB64(record.recovery_wrapped_private_key, "recovery vault key"),
      publicKey, "That recovery key does not open this vault.");
    return { publicKey, privateKey };
  } finally {
    sodium.memzero(key);
    sodium.memzero(recoveryKey);
  }
}

/**
 * New passphrase for unlocked keys; the result is stored via rewrap_vault_passphrase.
 * @param {{ publicKey: Uint8Array, privateKey: Uint8Array }} keys
 * @param {string} newPassphrase
 * @param {KdfParams} [params]
 */
export function rewrapPassphrase(keys, newPassphrase, params = KDF_DEFAULT) {
  if (String(newPassphrase).length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError("weak_passphrase",
      `Use at least ${MIN_PASSPHRASE_LENGTH} characters (a few unrelated words work well).`);
  }
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = passphraseKey(newPassphrase, salt, params);
  try {
    return {
      wrapped_private_key: toB64(wrap(key, keys.privateKey)),
      vault_salt: toB64(salt),
      kdf_params: { ...params },
    };
  } finally {
    sodium.memzero(key);
  }
}

export function forgetKeys(keys) {
  if (keys?.privateKey) sodium.memzero(keys.privateKey);
}

// ---------- secrets ----------

/** Encrypt a secret's fields to the owner's public key. Returns payload_enc (base64). */
export function sealSecret(publicKeyB64, secretId, secretType, fields) {
  const json = JSON.stringify({ v: 1, secret_id: secretId, type: secretType, fields });
  const plain = sodium.pad(sodium.from_string(json), PAD_BLOCK);
  const sealed = sodium.crypto_box_seal(plain, fromB64(publicKeyB64, "public key"));
  sodium.memzero(plain);
  return toB64(sealed);
}

/**
 * Decrypt payload_enc with unlocked keys. Refuses a ciphertext that was made
 * for another secret (secret_id inside must match the row it came from).
 */
export function openSecret(keys, payloadB64, expectedSecretId) {
  let plain;
  try {
    const padded = sodium.crypto_box_seal_open(fromB64(payloadB64, "secret"), keys.publicKey, keys.privateKey);
    plain = sodium.unpad(padded, PAD_BLOCK);
  } catch {
    throw new VaultError("decrypt_failed",
      "This secret could not be decrypted with your vault key. It may have been damaged.");
  }
  let data;
  try {
    data = JSON.parse(sodium.to_string(plain));
  } catch {
    data = null;
  } finally {
    sodium.memzero(plain);
  }
  if (!data || data.v !== 1 || typeof data.fields !== "object" || data.fields === null) {
    throw new VaultError("bad_data", "This secret is in an unknown format.");
  }
  if (data.secret_id !== expectedSecretId) {
    throw new VaultError("swapped",
      "This encrypted value belongs to a different secret. Do not use it; ask for help.");
  }
  return { type: data.type, fields: data.fields };
}

// ---------- what the entry page asks for, per secret_type ----------

export const SECRET_FIELDS = Object.freeze({
  login: [
    { key: "username", label: "Username or email", kind: "text", autocomplete: "off" },
    { key: "password", label: "Password", kind: "password", required: true },
    { key: "notes", label: "Notes (optional)", kind: "textarea" },
  ],
  api_key: [
    { key: "key", label: "API key", kind: "password", required: true },
    { key: "notes", label: "Notes (optional)", kind: "textarea" },
  ],
  wifi: [
    { key: "ssid", label: "Network name (SSID)", kind: "text" },
    { key: "password", label: "Password", kind: "password", required: true },
    { key: "notes", label: "Notes (optional)", kind: "textarea" },
  ],
  recovery_codes: [
    { key: "codes", label: "Recovery codes", kind: "textarea", required: true, secret: true },
    { key: "notes", label: "Notes (optional)", kind: "textarea" },
  ],
  note: [
    { key: "text", label: "Secure note", kind: "textarea", required: true, secret: true },
  ],
});
