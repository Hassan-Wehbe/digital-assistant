// The libsodium functions the vault uses (the `Sodium` interface in vaultCrypto.ts),
// without a libsodium native module: react-native-libsodium crashed the app at start-up
// on React Native's New Architecture (build of PR #18).
//
//   crypto_box_seal / _open, crypto_box_keypair   @serenity-kit/noble-sodium (libsodium's
//                                                  sealed boxes on the audited @noble libraries)
//   crypto_secretbox_easy / _open_easy            @noble/ciphers secretbox (XSalsa20-Poly1305)
//   crypto_generichash, crypto_kdf_derive_from_key  @noble/hashes BLAKE2b (as libsodium builds them)
//   crypto_pwhash (Argon2id)                      passed in: native on the phone
//                                                  (react-native-quick-crypto), noble in the tests
//
// These are small operations on a few hundred bytes, quick in plain JavaScript; only
// Argon2id (64 MB) needs native speed. sodiumLite.test.ts checks every function here
// against libsodium itself, and vaultCrypto.test.ts runs the vault on it against the web.
import { secretbox } from '@noble/ciphers/salsa.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { crypto_box_keypair, crypto_box_seal, crypto_box_seal_open } from '@serenity-kit/noble-sodium/wrappers';

import type { Sodium } from './vaultCrypto';

/** Argon2id v1.3, one lane: libsodium's crypto_pwhash with ALG_ARGON2ID13. */
export type Argon2id = (password: Uint8Array, salt: Uint8Array, p: { passes: number; memoryKiB: number; tagLength: number }) => Uint8Array;

const ORIGINAL = 1; // libsodium's base64_variants.ORIGINAL
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/** Strict standard base64 with padding (what the database's encode(..., 'base64') gives). */
function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('invalid base64');
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = (B64.indexOf(text[i]) << 18) | (B64.indexOf(text[i + 1]) << 12) | ((B64.indexOf(text[i + 2]) & 63) << 6) | (B64.indexOf(text[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function sodiumLite(argon2id: Argon2id, randomBytes: (n: number) => Uint8Array): Sodium {
  return {
    base64_variants: { ORIGINAL },
    to_base64: (input, variant) => {
      if (variant !== ORIGINAL) throw new Error('only standard base64 is supported');
      return toBase64(input);
    },
    from_base64: (input, variant) => {
      if (variant !== ORIGINAL) throw new Error('only standard base64 is supported');
      return fromBase64(input);
    },
    randombytes_buf: randomBytes,
    crypto_generichash: (length, message) => blake2b(message, { dkLen: length }),
    crypto_pwhash: (keyLength, password, salt, ops, mem, alg) => {
      if (alg !== 2) throw new Error('only Argon2id is supported');
      if (salt.length !== 16) throw new Error('invalid salt length');
      if (mem % 1024 !== 0) throw new Error('memory must be whole KiB');
      return argon2id(password, salt, { passes: ops, memoryKiB: mem / 1024, tagLength: keyLength });
    },
    // libsodium: BLAKE2b(key = master key, salt = subkey id (8 bytes, little endian) + 8 zero
    // bytes, personal = context (8 bytes) + 8 zero bytes), empty message.
    crypto_kdf_derive_from_key: (length, id, context, key) => {
      if (context.length !== 8 || key.length !== 32 || length < 16 || length > 64) throw new Error('invalid kdf input');
      const salt = new Uint8Array(16);
      new DataView(salt.buffer).setUint32(0, id >>> 0, true);
      new DataView(salt.buffer).setUint32(4, Math.floor(id / 2 ** 32), true);
      const personalization = new Uint8Array(16);
      for (let i = 0; i < 8; i++) personalization[i] = context.charCodeAt(i);
      return blake2b(new Uint8Array(0), { key, salt, personalization, dkLen: length });
    },
    crypto_secretbox_easy: (message, nonce, key) => secretbox(key, nonce).seal(message),
    crypto_secretbox_open_easy: (box, nonce, key) => secretbox(key, nonce).open(box),
    crypto_box_keypair: () => crypto_box_keypair(),
    crypto_box_seal: (message, publicKey) => crypto_box_seal(message, publicKey),
    crypto_box_seal_open: (box, publicKey, privateKey) => crypto_box_seal_open(box, publicKey, privateKey),
    crypto_secretbox_KEYBYTES: 32,
    crypto_secretbox_NONCEBYTES: 24,
    crypto_pwhash_SALTBYTES: 16,
    crypto_pwhash_ALG_ARGON2ID13: 2,
  };
}
