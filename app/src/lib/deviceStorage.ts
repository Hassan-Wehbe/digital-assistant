// The phone's real storage for the session and the chat thread (see sessionStorage.ts and
// chatStore.ts for the design).
import { aesDecryptAsync, aesEncryptAsync, AESEncryptionKey, AESSealedData } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import kv from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import type { SettingsStore } from './calendarSettings';
import { chatStore, EMPTY_CHAT, type ChatStore } from './chatStore';
import { dayMemoryStore, EMPTY_MEMORY, type DayMemoryStore } from './dayChoices';
import { base64Bytes, encryptedStorage, utf8Bytes, utf8Text, type Cipher, type KeyStore } from './sessionStorage';

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

const deviceCipher: Cipher = {
  async newKey() {
    return (await AESEncryptionKey.generate()).encoded('base64');
  },
  async encrypt(key, text) {
    const sealed = await aesEncryptAsync(utf8Bytes(text), await AESEncryptionKey.import(key, 'base64'));
    return sealed.combined('base64');
  },
  async decrypt(key, sealed) {
    // Pass bytes, not the base64 text: on Android, fromCombined accepts only bytes
    // (a string fails there, although the docs and the iOS version accept one).
    const bytes = await aesDecryptAsync(
      AESSealedData.fromCombined(base64Bytes(sealed)),
      await AESEncryptionKey.import(key, 'base64'),
    );
    // Android sizes the output buffer from an estimate; drop any zero padding at the end.
    return utf8Text(new Uint8Array(bytes)).replace(/\0+$/, '');
  },
};

export const deviceSessionStorage = encryptedStorage(secureKeys, localData, deviceCipher);

/**
 * The chat thread: same mechanism, its own AES key per account. The web build keeps no thread
 * (it uses the browser's storage for the session; the thread is for the phone only).
 */
export const deviceChatStore: ChatStore =
  Platform.OS !== 'web'
    ? chatStore(encryptedStorage(secureKeys, localData, deviceCipher), () => kv.getAllKeysAsync())
    : { load: async () => EMPTY_CHAT, save: async () => {}, clear: async () => {}, forgetOthers: async () => {} };

/**
 * My day's choices and event places (dayChoices.ts): same mechanism, its own AES key per account.
 * Never a plan. The web build keeps none.
 */
export const deviceDayMemory: DayMemoryStore =
  Platform.OS !== 'web'
    ? dayMemoryStore(encryptedStorage(secureKeys, localData, deviceCipher), () => kv.getAllKeysAsync())
    : { load: async () => EMPTY_MEMORY, save: async () => {}, forgetOthers: async () => {} };

/** Plain settings kept on this phone (Settings → Calendars' choice; calendarSettings.ts). */
export const deviceSettingsStore: SettingsStore = {
  get: (name) => kv.getItemAsync(name),
  set: (name, value) => kv.setItemAsync(name, value),
};
