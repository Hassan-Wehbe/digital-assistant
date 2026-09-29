// The phone's real storage for the session (see sessionStorage.ts for the design).
import { aesDecryptAsync, aesEncryptAsync, AESEncryptionKey, AESSealedData } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import kv from 'expo-sqlite/kv-store';

import { encryptedStorage, utf8Bytes, utf8Text, type KeyStore } from './sessionStorage';

// Kept on this device only: not synced to other devices or copied into backups.
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const secureKeys: KeyStore = {
  get: (name) => SecureStore.getItemAsync(name, KEYCHAIN),
  set: (name, value) => SecureStore.setItemAsync(name, value, KEYCHAIN),
  remove: (name) => SecureStore.deleteItemAsync(name, KEYCHAIN),
};

const localData: KeyStore = {
  get: (name) => kv.getItemAsync(name),
  set: (name, value) => kv.setItemAsync(name, value),
  remove: async (name) => {
    await kv.removeItemAsync(name);
  },
};

export const deviceSessionStorage = encryptedStorage(secureKeys, localData, {
  async newKey() {
    return (await AESEncryptionKey.generate()).encoded('base64');
  },
  async encrypt(key, text) {
    const sealed = await aesEncryptAsync(utf8Bytes(text), await AESEncryptionKey.import(key, 'base64'));
    return sealed.combined('base64');
  },
  async decrypt(key, sealed) {
    const bytes = await aesDecryptAsync(
      AESSealedData.fromCombined(sealed),
      await AESEncryptionKey.import(key, 'base64'),
    );
    return utf8Text(bytes);
  },
});
