import { describe, expect, it } from '@jest/globals';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { encryptedStorage, keyName, utf8Bytes, utf8Text, type Cipher, type KeyStore } from './sessionStorage';

// Node's AES-256-GCM, laid out like expo-crypto's "combined" form: nonce + ciphertext + tag.
const nodeCipher: Cipher = {
  newKey: async () => randomBytes(32).toString('base64'),
  async encrypt(key, text) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
    const body = Buffer.concat([c.update(Buffer.from(utf8Bytes(text))), c.final()]);
    return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
  },
  async decrypt(key, sealed) {
    const all = Buffer.from(sealed, 'base64');
    const d = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), all.subarray(0, 12));
    d.setAuthTag(all.subarray(all.length - 16));
    return utf8Text(Buffer.concat([d.update(all.subarray(12, all.length - 16)), d.final()]));
  },
};

function memory(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
}

const KEY = 'sb-motvckmpusxiuelpwqxy-auth-token';
const SESSION = JSON.stringify({
  access_token: 'eyJhbGciOiJFUzI1NiJ9.access-token-value',
  refresh_token: 'refresh-token-value',
  user: { email: 'owner@example.invalid', user_metadata: { name: 'Zoë 🍋' } },
});

describe('encrypted session storage', () => {
  it('reads back what it stored', async () => {
    const store = encryptedStorage(memory(), memory(), nodeCipher);
    await store.setItem(KEY, SESSION);
    expect(await store.getItem(KEY)).toBe(SESSION);
    expect(await store.getItem('something-else')).toBeNull();
  });

  it('keeps only ciphertext in the app data, and the key only in the secure keystore', async () => {
    const keys = memory();
    const data = memory();
    await encryptedStorage(keys, data, nodeCipher).setItem(KEY, SESSION);
    const stored = data.map.get(KEY)!;
    expect(stored).not.toContain('access-token-value');
    expect(stored).not.toContain('refresh-token-value');
    expect(Buffer.from(stored, 'base64').toString('latin1')).not.toContain('refresh-token-value');
    expect([...keys.map.keys()]).toEqual([keyName(KEY)]);
    expect([...data.map.keys()]).toEqual([KEY]);
  });

  it('reuses the key and uses a fresh nonce on every write', async () => {
    const keys = memory();
    const data = memory();
    const store = encryptedStorage(keys, data, nodeCipher);
    await store.setItem(KEY, SESSION);
    const [key1, sealed1] = [keys.map.get(keyName(KEY)), data.map.get(KEY)];
    await store.setItem(KEY, SESSION);
    expect(keys.map.get(keyName(KEY))).toBe(key1);
    expect(data.map.get(KEY)).not.toBe(sealed1);
  });

  it('signs out (returns nothing, forgets both parts) when the data was changed', async () => {
    const keys = memory();
    const data = memory();
    const store = encryptedStorage(keys, data, nodeCipher);
    await store.setItem(KEY, SESSION);
    const bytes = Buffer.from(data.map.get(KEY)!, 'base64');
    bytes[20] ^= 1;
    data.map.set(KEY, bytes.toString('base64'));
    expect(await store.getItem(KEY)).toBeNull();
    expect(data.map.size + keys.map.size).toBe(0);
  });

  it('returns nothing when the key is gone (for example a backup restored to a new phone)', async () => {
    const keys = memory();
    const store = encryptedStorage(keys, memory(), nodeCipher);
    await store.setItem(KEY, SESSION);
    keys.map.clear();
    expect(await store.getItem(KEY)).toBeNull();
  });

  it('removes both parts on sign-out', async () => {
    const keys = memory();
    const data = memory();
    const store = encryptedStorage(keys, data, nodeCipher);
    await store.setItem(KEY, SESSION);
    await store.removeItem(KEY);
    expect(data.map.size + keys.map.size).toBe(0);
  });

  it('names keystore entries with the characters the keystore allows', () => {
    expect(keyName(KEY)).toBe('wilma.key.sb-motvckmpusxiuelpwqxy-auth-token');
    expect(keyName('a/b c:d')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('utf8', () => {
  it('matches the standard encoding both ways', () => {
    for (const s of ['', 'plain', 'Zoë', 'naïve café', '日本語', 'lemon 🍋 ok', SESSION]) {
      expect(Buffer.from(utf8Bytes(s)).equals(Buffer.from(s, 'utf8'))).toBe(true);
      expect(utf8Text(Uint8Array.from(Buffer.from(s, 'utf8')))).toBe(s);
    }
  });
});
