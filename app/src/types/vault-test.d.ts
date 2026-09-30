// Types for libsodium in JavaScript, which only the tests load (the phone uses
// react-native-libsodium); the tests run the web vault's crypto.js on it next to the app's code.
declare module 'libsodium-wrappers-sumo' {
  const sodium: import('../lib/vaultCrypto').Sodium & { ready: Promise<void>; pad(b: Uint8Array, n: number): Uint8Array; unpad(b: Uint8Array, n: number): Uint8Array; memcmp(a: Uint8Array, b: Uint8Array): boolean };
  export default sodium;
}
