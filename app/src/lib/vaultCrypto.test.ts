/* eslint-disable import/no-named-as-default-member -- libsodium's functions are used from its default export, as on the web */
// The app's vault code, on sodiumLite as on the phone (with noble's Argon2id standing in
// for the phone's native one), against the web vault's (docs/vault/crypto.js) on
// libsodium-wrappers-sumo 0.8.4 (the version the web pages ship): each must open what the
// other made, so secrets move freely between the phone and the web.
import { beforeAll, describe, expect, it } from '@jest/globals';
import { argon2id } from '@noble/hashes/argon2.js';
import sodium from 'libsodium-wrappers-sumo';

import * as web from '../../../docs/vault/crypto.js';
import { sodiumLite } from './sodiumLite';
import { displayRows, KDF_DEFAULT, memcmp, pad, SECRET_FIELDS, unpad, vaultCrypto, VaultError, type KdfParams, type VaultCrypto } from './vaultCrypto';

// Real Argon2id settings (the stored ones), but lighter memory keeps the tests quick;
// one test below uses the real default.
const FAST: KdfParams = { alg: 'argon2id13', ops: 2, mem: 8 * 1024 * 1024 };
const PASS = 'correct horse battery staple';
const ID = '6d1c1c49-6f0a-4d8e-9d2e-3c1f0e7a9b10';
const OTHER_ID = '0b9e8f3a-2c4d-4e5f-8a9b-1c2d3e4f5a6b';
const FIELDS = { username: 'hassan@example.com', password: 'p@ss wörd ✓ ', notes: 'line 1\nline 2' };

let app: VaultCrypto;
beforeAll(async () => {
  await sodium.ready;
  await web.ready();
  app = vaultCrypto(
    sodiumLite(
      (password, salt, p) => argon2id(password, salt, { t: p.passes, m: p.memoryKiB, p: 1, dkLen: p.tagLength }),
      (n) => sodium.randombytes_buf(n),
    ),
  );
});

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof VaultError || (e as { code?: string }).code ? (e as VaultError).code : 'other';
  }
  return 'none';
};

describe('helpers match libsodium', () => {
  it('pad and unpad like sodium_pad / sodium_unpad', () => {
    for (const n of [0, 1, 17, 255, 256, 257, 511, 512, 1000]) {
      const data = sodium.randombytes_buf(n);
      const mine = pad(data, 256);
      expect(Array.from(mine)).toEqual(Array.from(sodium.pad(data, 256)));
      expect(Array.from(unpad(mine, 256))).toEqual(Array.from(sodium.unpad(sodium.pad(data, 256), 256)));
    }
  });

  it('refuses broken padding', () => {
    expect(() => unpad(new Uint8Array(256), 256)).toThrow();
    expect(() => unpad(new Uint8Array(255), 256)).toThrow();
    const noMarker = new Uint8Array(256).fill(1);
    expect(() => unpad(noMarker, 256)).toThrow();
  });

  it('memcmp compares like sodium.memcmp', () => {
    const a = sodium.randombytes_buf(32);
    const b = Uint8Array.from(a);
    expect(memcmp(a, b)).toBe(true);
    b[31] ^= 1;
    expect(memcmp(a, b)).toBe(false);
    expect(memcmp(a, a.subarray(0, 31))).toBe(false);
  });
});

describe('the app opens what the web made', () => {
  it('unlocks a web vault with the passphrase and the recovery key, and opens its secrets', () => {
    const v = web.createVault(PASS, FAST);
    const keys = app.unlockWithPassphrase(v.record, PASS);
    expect(memcmp(keys.privateKey, v.keys.privateKey)).toBe(true);
    expect(memcmp(app.unlockWithRecoveryKey(v.record, v.recoveryKey).privateKey, v.keys.privateKey)).toBe(true);
    // Recovery keys typed loosely still work (lower case, spaces, look-alike digits).
    const loose = v.recoveryKey.toLowerCase().replace(/-/g, ' ').replace(/o/g, '0');
    expect(memcmp(app.unlockWithRecoveryKey(v.record, loose).privateKey, v.keys.privateKey)).toBe(true);

    const payload = web.sealSecret(v.record.public_key, ID, 'login', FIELDS);
    expect(app.openSecret(keys, payload, ID)).toEqual({ type: 'login', fields: FIELDS });
  });

  it('works with the real default settings (64 MB)', () => {
    const v = web.createVault(PASS, KDF_DEFAULT);
    expect(memcmp(app.unlockWithPassphrase(v.record, PASS).privateKey, v.keys.privateKey)).toBe(true);
  });

  it('refuses a wrong passphrase or recovery key, and a ciphertext moved to another secret', () => {
    const v = web.createVault(PASS, FAST);
    expect(code(() => app.unlockWithPassphrase(v.record, 'correct horse battery stapler'))).toBe('wrong_key');
    const other = web.createVault(PASS, FAST);
    expect(code(() => app.unlockWithRecoveryKey(v.record, other.recoveryKey))).toBe('wrong_key');
    const typo = v.recoveryKey.slice(0, -1) + (v.recoveryKey.endsWith('A') ? 'B' : 'A');
    expect(code(() => app.unlockWithRecoveryKey(v.record, typo))).toBe('recovery_typo');
    expect(code(() => app.unlockWithRecoveryKey(v.record, 'ABCDE'))).toBe('recovery_format');

    const keys = app.unlockWithPassphrase(v.record, PASS);
    const payload = web.sealSecret(v.record.public_key, ID, 'login', FIELDS);
    expect(code(() => app.openSecret(keys, payload, OTHER_ID))).toBe('swapped');
    const damaged = Uint8Array.from(sodium.from_base64(payload, sodium.base64_variants.ORIGINAL));
    damaged[40] ^= 1;
    expect(code(() => app.openSecret(keys, sodium.to_base64(damaged, sodium.base64_variants.ORIGINAL), ID))).toBe('decrypt_failed');
  });

  it('notices a wrapped key that belongs to another vault', () => {
    const v = web.createVault(PASS, FAST);
    const other = web.createVault(PASS, FAST);
    const swapped = { ...v.record, wrapped_private_key: other.record.wrapped_private_key, vault_salt: other.record.vault_salt };
    expect(code(() => app.unlockWithPassphrase(swapped, PASS))).toBe('key_mismatch');
  });
});

describe('the web opens what the app made', () => {
  it('unlocks an app-made vault and its secrets', () => {
    const v = app.createVault(PASS, FAST);
    const keys = web.unlockWithPassphrase(v.record, PASS);
    expect(memcmp(keys.privateKey, v.keys.privateKey)).toBe(true);
    expect(memcmp(web.unlockWithRecoveryKey(v.record, v.recoveryKey).privateKey, v.keys.privateKey)).toBe(true);
    const payload = app.sealSecret(v.record.public_key, ID, 'wifi', { ssid: 'Home', password: 'x'.repeat(300) });
    expect(web.openSecret(keys, payload, ID)).toEqual({ type: 'wifi', fields: { ssid: 'Home', password: 'x'.repeat(300) } });
  });

  it('accepts a passphrase changed in the app, and the old one no longer works', () => {
    const v = web.createVault(PASS, FAST);
    const keys = app.unlockWithPassphrase(v.record, PASS);
    const record = { ...v.record, ...app.rewrapPassphrase(keys, 'a brand new passphrase', FAST) };
    expect(memcmp(web.unlockWithPassphrase(record, 'a brand new passphrase').privateKey, v.keys.privateKey)).toBe(true);
    expect(code(() => web.unlockWithPassphrase(record, PASS))).toBe('wrong_key');
  });

  it('formats recovery keys the same way', () => {
    const key = sodium.randombytes_buf(32);
    expect(app.formatRecoveryKey(key)).toBe(web.formatRecoveryKey(key));
    expect(memcmp(app.parseRecoveryKey(web.formatRecoveryKey(key)), key)).toBe(true);
  });
});

describe('fingerprint copy of the key', () => {
  it('is accepted only for the vault it belongs to', () => {
    const v = app.createVault(PASS, FAST);
    const stored = app.toB64(v.keys.privateKey);
    expect(app.keysFromStored(v.record, stored)).not.toBeNull();
    const other = app.createVault(PASS, FAST);
    expect(app.keysFromStored(other.record, stored)).toBeNull();
    expect(app.keysFromStored(v.record, 'not base64 !!')).toBeNull();
  });
});

describe('secret fields', () => {
  it('match the web entry page', () => {
    expect(SECRET_FIELDS).toEqual(
      Object.fromEntries(
        Object.entries(web.SECRET_FIELDS).map(([t, fs]) => [
          t,
          (fs as { key: string; label: string; kind: string; required?: boolean; secret?: boolean }[]).map(({ key, label, kind, required, secret }) => ({ key, label, kind, ...(required ? { required } : {}), ...(secret ? { secret } : {}) })),
        ]),
      ),
    );
  });

  it('show known fields in order, masked where secret, then unknown ones', () => {
    expect(displayRows('login', { notes: 'n', extra: 'e', password: 'p', username: 'u' })).toEqual([
      { key: 'username', label: 'Username or email', value: 'u', masked: false },
      { key: 'password', label: 'Password', value: 'p', masked: true },
      { key: 'notes', label: 'Notes', value: 'n', masked: false },
      { key: 'extra', label: 'extra', value: 'e', masked: false },
    ]);
    expect(displayRows('note', { text: 's' })[0].masked).toBe(true);
  });
});
