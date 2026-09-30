/* eslint-disable import/no-named-as-default-member -- libsodium's functions are used from its default export, as on the web */
// Every function of sodiumLite against libsodium itself (libsodium-wrappers-sumo 0.8.4,
// the version the web vault pages ship): same outputs, and each opens what the other made.
import { beforeAll, describe, expect, it } from '@jest/globals';
import { argon2id } from '@noble/hashes/argon2.js';
import sodium from 'libsodium-wrappers-sumo';

import { sodiumLite } from './sodiumLite';
import type { Sodium } from './vaultCrypto';

const nobleArgon2id = (password: Uint8Array, salt: Uint8Array, p: { passes: number; memoryKiB: number; tagLength: number }) =>
  argon2id(password, salt, { t: p.passes, m: p.memoryKiB, p: 1, dkLen: p.tagLength });

let lite: Sodium;
beforeAll(async () => {
  await sodium.ready;
  lite = sodiumLite(nobleArgon2id, (n) => sodium.randombytes_buf(n));
});

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const V = 1;

describe('sodiumLite matches libsodium', () => {
  it('base64 (standard, padded), and refuses anything else', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 72]) {
      const b = sodium.randombytes_buf(n);
      const s = sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
      expect(lite.to_base64(b, V)).toBe(s);
      expect(hex(lite.from_base64(s, V))).toBe(hex(b));
    }
    for (const bad of ['abc', 'ab$=', 'a===', 'YQ', 'YQ==YQ==']) expect(() => lite.from_base64(bad, V)).toThrow();
  });

  it('crypto_generichash', () => {
    const m = sodium.randombytes_buf(100);
    for (const n of [16, 24, 32, 64]) expect(hex(lite.crypto_generichash(n, m))).toBe(hex(sodium.crypto_generichash(n, m)));
  });

  it('crypto_kdf_derive_from_key (the recovery key wrapping key)', () => {
    const key = sodium.randombytes_buf(32);
    for (const id of [0, 1, 7, 65535, 2 ** 30]) {
      expect(hex(lite.crypto_kdf_derive_from_key(32, id, 'DAvault1', key))).toBe(hex(sodium.crypto_kdf_derive_from_key(32, id, 'DAvault1', key)));
    }
  });

  it('crypto_pwhash (Argon2id), including the real 64 MB setting', () => {
    const pw = new TextEncoder().encode('correct horse battery staple ✓');
    const salt = sodium.randombytes_buf(16);
    for (const [ops, mem] of [
      [1, 8 * 1024 * 1024],
      [3, 64 * 1024 * 1024],
    ]) {
      expect(hex(lite.crypto_pwhash(32, pw, salt, ops, mem, 2))).toBe(
        hex(sodium.crypto_pwhash(32, pw, salt, ops, mem, sodium.crypto_pwhash_ALG_ARGON2ID13)),
      );
    }
  });

  it('crypto_secretbox both ways', () => {
    const key = sodium.randombytes_buf(32);
    const nonce = sodium.randombytes_buf(24);
    const m = sodium.randombytes_buf(32);
    const box = lite.crypto_secretbox_easy(m, nonce, key);
    expect(hex(box)).toBe(hex(sodium.crypto_secretbox_easy(m, nonce, key)));
    expect(hex(lite.crypto_secretbox_open_easy(sodium.crypto_secretbox_easy(m, nonce, key), nonce, key))).toBe(hex(m));
    box[0] ^= 1;
    expect(() => lite.crypto_secretbox_open_easy(box, nonce, key)).toThrow();
  });

  it('sealed boxes both ways, and key pairs libsodium accepts', () => {
    const mine = lite.crypto_box_keypair();
    const theirs = sodium.crypto_box_keypair();
    const m = sodium.randombytes_buf(300);
    expect(hex(sodium.crypto_box_seal_open(lite.crypto_box_seal(m, theirs.publicKey), theirs.publicKey, theirs.privateKey))).toBe(hex(m));
    expect(hex(lite.crypto_box_seal_open(sodium.crypto_box_seal(m, mine.publicKey), mine.publicKey, mine.privateKey))).toBe(hex(m));
    expect(hex(sodium.crypto_scalarmult_base(mine.privateKey))).toBe(hex(mine.publicKey));
    expect(() => lite.crypto_box_seal_open(sodium.crypto_box_seal(m, mine.publicKey), theirs.publicKey, theirs.privateKey)).toThrow();
  });

  it('has the same constants', () => {
    expect([lite.crypto_secretbox_KEYBYTES, lite.crypto_secretbox_NONCEBYTES, lite.crypto_pwhash_SALTBYTES, lite.crypto_pwhash_ALG_ARGON2ID13]).toEqual([
      sodium.crypto_secretbox_KEYBYTES,
      sodium.crypto_secretbox_NONCEBYTES,
      sodium.crypto_pwhash_SALTBYTES,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    ]);
  });
});
