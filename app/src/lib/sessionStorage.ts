// Where the sign-in session lives on the phone.
//
// The session (access and refresh tokens) is encrypted with AES-GCM before it is
// written to the app's local key-value store. The AES key itself is kept in the
// phone's secure keystore (Android Keystore / iOS Keychain) through
// expo-secure-store, which only holds small values; the session is too large to
// store there directly. Someone who copies the app's files gets only ciphertext.
//
// The pieces are passed in so the logic can be unit-tested without a phone.

/** The storage interface supabase-js expects (its `auth.storage` option). */
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface KeyStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface Cipher {
  /** A new random 256-bit key, base64. */
  newKey(): Promise<string>;
  /** base64 (nonce + ciphertext + tag) of the UTF-8 text. */
  encrypt(key: string, text: string): Promise<string>;
  /** The text back; throws if the key is wrong or the data was changed. */
  decrypt(key: string, sealed: string): Promise<string>;
}

// SecureStore keys may contain only letters, digits, ".", "-" and "_".
export const keyName = (storageKey: string) => `wilma.key.${storageKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export function encryptedStorage(keys: KeyStore, data: KeyStore, cipher: Cipher): AuthStorage {
  const forget = async (storageKey: string) => {
    await data.remove(storageKey);
    await keys.remove(keyName(storageKey));
  };

  return {
    async getItem(storageKey) {
      const sealed = await data.get(storageKey);
      const key = await keys.get(keyName(storageKey));
      if (!sealed || !key) return null;
      try {
        return await cipher.decrypt(key, sealed);
      } catch {
        // Unreadable (key lost, e.g. after a restore to a new phone): sign in again.
        await forget(storageKey);
        return null;
      }
    },
    async setItem(storageKey, value) {
      let key = await keys.get(keyName(storageKey));
      if (!key) {
        key = await cipher.newKey();
        await keys.set(keyName(storageKey), key);
      }
      await data.set(storageKey, await cipher.encrypt(key, value));
    },
    removeItem: forget,
  };
}

// UTF-8 <-> bytes, without relying on TextDecoder (not in every JS engine the app runs on).
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Text(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c: number;
    let n: number;
    if (b < 0x80) [c, n] = [b, 1];
    else if (b >> 5 === 6) [c, n] = [b & 31, 2];
    else if (b >> 4 === 14) [c, n] = [b & 15, 3];
    else [c, n] = [b & 7, 4];
    for (let k = 1; k < n; k++) c = (c << 6) | (bytes[i + k] & 63);
    s += String.fromCodePoint(c);
    i += n;
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with or without padding or line breaks) to bytes. */
export function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}
