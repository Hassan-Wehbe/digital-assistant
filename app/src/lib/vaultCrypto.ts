// The vault's cryptography on the phone: the same format as docs/vault/crypto.js, so a
// secret saved on the web opens in the app and the other way round.
// vaultCrypto.test.ts runs this and the web code against each other.
//
//   key pair        X25519 (crypto_box). Public key stored in plaintext.
//   passphrase key  Argon2id(passphrase, vault_salt, kdf_params) -> 32 bytes
//   recovery key    32 random bytes shown once; wrapping key =
//                   crypto_kdf_derive_from_key(id 1, context "DAvault1")
//   wrapped keys    nonce(24) || secretbox(private key)          (stored, 72 bytes)
//   secret payload  crypto_box_seal(padded JSON, public key)     (stored)
//                   JSON = {"v":1,"secret_id","type","fields":{...}}
//
// The libsodium functions come from sodiumLite.ts on the phone (noble + native Argon2id)
// and from libsodium-wrappers-sumo in the tests. The web code also uses pad/unpad,
// memcmp, memzero and crypto_scalarmult_base; the first four are written here and checked
// against libsodium in the tests, and "this private key belongs to this public key" is
// checked with a sealed-box round trip.
//
// The passphrase, recovery key, private key and secret values stay in memory on
// the phone; never log them or put them in an error message.
import { utf8Bytes, utf8Text } from './sessionStorage';

/** The libsodium functions used here (both libraries provide them under these names). */
export interface Sodium {
  base64_variants: { ORIGINAL: number };
  to_base64(input: Uint8Array, variant: number): string;
  from_base64(input: string, variant: number): Uint8Array;
  randombytes_buf(length: number): Uint8Array;
  crypto_generichash(length: number, message: Uint8Array): Uint8Array;
  crypto_pwhash(keyLength: number, password: Uint8Array, salt: Uint8Array, ops: number, mem: number, alg: number): Uint8Array;
  crypto_kdf_derive_from_key(length: number, id: number, context: string, key: Uint8Array): Uint8Array;
  crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_secretbox_open_easy(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  crypto_box_seal_open(box: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
  crypto_secretbox_KEYBYTES: number;
  crypto_secretbox_NONCEBYTES: number;
  crypto_pwhash_SALTBYTES: number;
  crypto_pwhash_ALG_ARGON2ID13: number;
}

export interface KdfParams {
  alg: string;
  ops: number;
  mem: number;
}

/** What get_vault_keys returns once the vault is set up. */
export interface VaultRecord {
  public_key: string;
  wrapped_private_key: string;
  recovery_wrapped_private_key: string;
  vault_salt: string;
  kdf_params: KdfParams;
}

export interface VaultKeys {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export type SecretFields = Record<string, string>;

export const KDF_DEFAULT: Readonly<KdfParams> = Object.freeze({ alg: 'argon2id13', ops: 3, mem: 64 * 1024 * 1024 });
export const MIN_PASSPHRASE_LENGTH = 12;

const RECOVERY_CONTEXT = 'DAvault1'; // crypto_kdf context: exactly 8 characters
const RECOVERY_SUBKEY_ID = 1;
const PAD_BLOCK = 256; // hide the exact length of a value
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Errors shown to the owner as they are. `code` lets callers react. */
export class VaultError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

// ---------- helpers libsodium-wrappers has and the phone library lacks ----------

/** sodium_pad: 0x80, then zeros, up to the next multiple of `block` (always adds 1..block bytes). */
export function pad(data: Uint8Array, block: number): Uint8Array {
  const out = new Uint8Array(data.length + (block - (data.length % block)));
  out.set(data);
  out[data.length] = 0x80;
  return out;
}

/** sodium_unpad. */
export function unpad(data: Uint8Array, block: number): Uint8Array {
  if (data.length === 0 || data.length % block !== 0) throw new Error('bad padding');
  let i = data.length - 1;
  const stop = data.length - block;
  while (i >= stop && data[i] === 0) i--;
  if (i < stop || data[i] !== 0x80) throw new Error('bad padding');
  return data.slice(0, i);
}

/** Constant-time comparison of two byte arrays. */
export function memcmp(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function memzero(b: Uint8Array | null | undefined): void {
  b?.fill(0);
}

export function vaultCrypto(sodium: Sodium) {
  const V = sodium.base64_variants.ORIGINAL;

  // ---------- encoding (standard base64, as Postgres decode(..., 'base64') expects) ----------

  const toB64 = (bytes: Uint8Array) => sodium.to_base64(bytes, V);

  function fromB64(text: string, what = 'value'): Uint8Array {
    try {
      return sodium.from_base64(text, V);
    } catch {
      throw new VaultError('bad_data', `The stored ${what} is not valid.`);
    }
  }

  // ---------- recovery key: 32 random bytes + 2-byte checksum, base32, groups of 5 ----------

  const checksum = (bytes: Uint8Array) => sodium.crypto_generichash(16, bytes).subarray(0, 2);

  function base32Encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let out = '';
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

  function base32Decode(text: string): Uint8Array | null {
    let bits = 0;
    let value = 0;
    const out: number[] = [];
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

  function formatRecoveryKey(key32: Uint8Array): string {
    const full = new Uint8Array(34);
    full.set(key32);
    full.set(checksum(key32), 32);
    return base32Encode(full).match(/.{1,5}/g)!.join('-');
  }

  /** Accepts any case, spaces or dashes, and the look-alikes 0/1/8 for O/I/B. */
  function parseRecoveryKey(text: string): Uint8Array {
    const clean = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
    const bytes = clean.length === 55 ? base32Decode(clean) : null;
    if (!bytes || bytes.length !== 34) {
      throw new VaultError('recovery_format', "That doesn't look like a recovery key. It has 11 groups of 5 letters and digits.");
    }
    const key = bytes.subarray(0, 32);
    // Only the canonical spelling is accepted, so every changed character is reported as a typo.
    if (!memcmp(checksum(key), bytes.subarray(32)) || base32Encode(bytes) !== clean) {
      throw new VaultError('recovery_typo', 'The recovery key has a typo. Check it and try again.');
    }
    return Uint8Array.from(key);
  }

  // ---------- key wrapping ----------

  function checkKdfParams(p: KdfParams | null | undefined): KdfParams {
    if (!p || p.alg !== 'argon2id13' || !Number.isInteger(p.ops) || !Number.isInteger(p.mem)) {
      throw new VaultError('bad_data', "The vault's key settings are not valid.");
    }
    return p;
  }

  function passphraseKey(passphrase: string, salt: Uint8Array, params: KdfParams): Uint8Array {
    const p = checkKdfParams(params);
    const password = utf8Bytes(String(passphrase).normalize('NFKC'));
    try {
      return sodium.crypto_pwhash(sodium.crypto_secretbox_KEYBYTES, password, salt, p.ops, p.mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
    } finally {
      memzero(password);
    }
  }

  const recoveryWrappingKey = (recoveryKey32: Uint8Array) =>
    sodium.crypto_kdf_derive_from_key(sodium.crypto_secretbox_KEYBYTES, RECOVERY_SUBKEY_ID, RECOVERY_CONTEXT, recoveryKey32);

  function wrap(key: Uint8Array, privateKey: Uint8Array): Uint8Array {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const box = sodium.crypto_secretbox_easy(privateKey, nonce, key);
    const out = new Uint8Array(nonce.length + box.length);
    out.set(nonce);
    out.set(box, nonce.length);
    return out;
  }

  /** True when `privateKey` is the private half of `publicKey`. */
  function keysMatch(publicKey: Uint8Array, privateKey: Uint8Array): boolean {
    const probe = sodium.randombytes_buf(32);
    try {
      return memcmp(sodium.crypto_box_seal_open(sodium.crypto_box_seal(probe, publicKey), publicKey, privateKey), probe);
    } catch {
      return false;
    }
  }

  function unwrap(key: Uint8Array, wrapped: Uint8Array, publicKey: Uint8Array, wrongKeyMessage: string): Uint8Array {
    const n = sodium.crypto_secretbox_NONCEBYTES;
    let privateKey: Uint8Array;
    try {
      privateKey = sodium.crypto_secretbox_open_easy(wrapped.subarray(n), wrapped.subarray(0, n), key);
    } catch {
      throw new VaultError('wrong_key', wrongKeyMessage);
    }
    // The unwrapped key must belong to the stored public key; otherwise the stored
    // wrapped key was replaced and nothing it opens can be trusted.
    if (!keysMatch(publicKey, privateKey)) {
      memzero(privateKey);
      throw new VaultError('key_mismatch', 'The stored vault key does not match your public key. Do not continue; ask for help.');
    }
    return privateKey;
  }

  function checkPassphrase(passphrase: string) {
    if (String(passphrase).length < MIN_PASSPHRASE_LENGTH) {
      throw new VaultError('weak_passphrase', `Use at least ${MIN_PASSPHRASE_LENGTH} characters (a few unrelated words work well).`);
    }
  }

  // ---------- vault lifecycle ----------

  /** First-time setup: `record` goes to setup_vault; the recovery key is shown once. */
  function createVault(passphrase: string, params: KdfParams = KDF_DEFAULT) {
    checkPassphrase(passphrase);
    const { publicKey, privateKey } = sodium.crypto_box_keypair();
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const recoveryKey = sodium.randombytes_buf(32);
    const pk = passphraseKey(passphrase, salt, params);
    const rk = recoveryWrappingKey(recoveryKey);
    const record: VaultRecord = {
      public_key: toB64(publicKey),
      wrapped_private_key: toB64(wrap(pk, privateKey)),
      recovery_wrapped_private_key: toB64(wrap(rk, privateKey)),
      vault_salt: toB64(salt),
      kdf_params: { ...params },
    };
    const recoveryText = formatRecoveryKey(recoveryKey);
    memzero(pk);
    memzero(rk);
    memzero(recoveryKey);
    return { record, recoveryKey: recoveryText, keys: { publicKey, privateKey } as VaultKeys };
  }

  function unlockWithPassphrase(record: VaultRecord, passphrase: string): VaultKeys {
    const publicKey = fromB64(record.public_key, 'public key');
    const key = passphraseKey(passphrase, fromB64(record.vault_salt, 'salt'), record.kdf_params);
    try {
      const privateKey = unwrap(key, fromB64(record.wrapped_private_key, 'vault key'), publicKey, 'That passphrase is not right.');
      return { publicKey, privateKey };
    } finally {
      memzero(key);
    }
  }

  function unlockWithRecoveryKey(record: VaultRecord, recoveryKeyText: string): VaultKeys {
    const publicKey = fromB64(record.public_key, 'public key');
    const recoveryKey = parseRecoveryKey(recoveryKeyText);
    const key = recoveryWrappingKey(recoveryKey);
    try {
      const privateKey = unwrap(
        key,
        fromB64(record.recovery_wrapped_private_key, 'recovery vault key'),
        publicKey,
        'That recovery key does not open this vault.',
      );
      return { publicKey, privateKey };
    } finally {
      memzero(key);
      memzero(recoveryKey);
    }
  }

  /** Keys kept elsewhere (the fingerprint-protected copy): checked against the vault's public key. */
  function keysFromStored(record: VaultRecord, privateKeyB64: string): VaultKeys | null {
    const publicKey = fromB64(record.public_key, 'public key');
    let privateKey: Uint8Array;
    try {
      privateKey = fromB64(privateKeyB64);
    } catch {
      return null;
    }
    if (privateKey.length !== 32 || !keysMatch(publicKey, privateKey)) {
      memzero(privateKey);
      return null;
    }
    return { publicKey, privateKey };
  }

  /** New passphrase for unlocked keys; the result goes to rewrap_vault_passphrase. */
  function rewrapPassphrase(keys: VaultKeys, newPassphrase: string, params: KdfParams = KDF_DEFAULT) {
    checkPassphrase(newPassphrase);
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const key = passphraseKey(newPassphrase, salt, params);
    try {
      return { wrapped_private_key: toB64(wrap(key, keys.privateKey)), vault_salt: toB64(salt), kdf_params: { ...params } };
    } finally {
      memzero(key);
    }
  }

  // ---------- secrets ----------

  /** Encrypt a secret's fields to the owner's public key. Returns payload_enc (base64). */
  function sealSecret(publicKeyB64: string, secretId: string, secretType: string, fields: SecretFields): string {
    const json = utf8Bytes(JSON.stringify({ v: 1, secret_id: secretId, type: secretType, fields }));
    const plain = pad(json, PAD_BLOCK);
    memzero(json);
    const sealed = sodium.crypto_box_seal(plain, fromB64(publicKeyB64, 'public key'));
    memzero(plain);
    return toB64(sealed);
  }

  /** Decrypt payload_enc; refuses a ciphertext made for another secret. */
  function openSecret(keys: VaultKeys, payloadB64: string, expectedSecretId: string): { type: string; fields: SecretFields } {
    let plain: Uint8Array;
    try {
      const padded = sodium.crypto_box_seal_open(fromB64(payloadB64, 'secret'), keys.publicKey, keys.privateKey);
      plain = unpad(padded, PAD_BLOCK);
      memzero(padded);
    } catch {
      throw new VaultError('decrypt_failed', 'This secret could not be decrypted with your vault key. It may have been damaged.');
    }
    let data: { v?: unknown; secret_id?: unknown; type?: unknown; fields?: unknown } | null;
    try {
      data = JSON.parse(utf8Text(plain));
    } catch {
      data = null;
    } finally {
      memzero(plain);
    }
    if (!data || data.v !== 1 || typeof data.fields !== 'object' || data.fields === null) {
      throw new VaultError('bad_data', 'This secret is in an unknown format.');
    }
    if (data.secret_id !== expectedSecretId) {
      throw new VaultError('swapped', 'This encrypted value belongs to a different secret. Do not use it; ask for help.');
    }
    return { type: String(data.type), fields: data.fields as SecretFields };
  }

  return {
    toB64,
    fromB64,
    formatRecoveryKey,
    parseRecoveryKey,
    createVault,
    unlockWithPassphrase,
    unlockWithRecoveryKey,
    keysFromStored,
    rewrapPassphrase,
    sealSecret,
    openSecret,
  };
}

export type VaultCrypto = ReturnType<typeof vaultCrypto>;

export function forgetKeys(keys: VaultKeys | null | undefined): void {
  memzero(keys?.privateKey);
}

// ---------- what each secret type holds (same as SECRET_FIELDS on the web) ----------

export interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'textarea';
  required?: boolean;
  /** A textarea whose content is secret (hidden until Show). */
  secret?: boolean;
}

export const SECRET_FIELDS: Record<string, FieldSpec[]> = {
  login: [
    { key: 'username', label: 'Username or email', kind: 'text' },
    { key: 'password', label: 'Password', kind: 'password', required: true },
    { key: 'notes', label: 'Notes (optional)', kind: 'textarea' },
  ],
  api_key: [
    { key: 'key', label: 'API key', kind: 'password', required: true },
    { key: 'notes', label: 'Notes (optional)', kind: 'textarea' },
  ],
  wifi: [
    { key: 'ssid', label: 'Network name (SSID)', kind: 'text' },
    { key: 'password', label: 'Password', kind: 'password', required: true },
    { key: 'notes', label: 'Notes (optional)', kind: 'textarea' },
  ],
  recovery_codes: [
    { key: 'codes', label: 'Recovery codes', kind: 'textarea', required: true, secret: true },
    { key: 'notes', label: 'Notes (optional)', kind: 'textarea' },
  ],
  note: [{ key: 'text', label: 'Secure note', kind: 'textarea', required: true, secret: true }],
};

export const TYPE_LABELS: Record<string, string> = {
  login: 'Login',
  api_key: 'API key',
  wifi: 'Wi-Fi',
  recovery_codes: 'Recovery codes',
  note: 'Secure note',
};

/** The rows to show for a revealed secret: known fields in order, then any others. */
export function displayRows(type: string, fields: SecretFields): { key: string; label: string; value: string; masked: boolean }[] {
  const specs = SECRET_FIELDS[type] ?? [];
  const known = new Set(specs.map((f) => f.key));
  return [
    ...specs
      .filter((f) => fields[f.key] !== undefined)
      .map((f) => ({ key: f.key, label: f.label.replace(/ \(optional\)$/, ''), value: String(fields[f.key]), masked: f.kind === 'password' || !!f.secret })),
    ...Object.keys(fields)
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, label: k, value: String(fields[k]), masked: false })),
  ];
}
