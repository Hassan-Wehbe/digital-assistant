// Types for libsodium in JavaScript, which only the tests load (the phone uses sodiumLite.ts);
// the tests check sodiumLite against it and run the web vault's crypto.js on it.
declare module 'libsodium-wrappers-sumo' {
  const sodium: import('../lib/vaultCrypto').Sodium & { ready: Promise<void>; pad(b: Uint8Array, n: number): Uint8Array; unpad(b: Uint8Array, n: number): Uint8Array; memcmp(a: Uint8Array, b: Uint8Array): boolean; crypto_scalarmult_base(k: Uint8Array): Uint8Array; crypto_pwhash_ALG_ARGON2ID13: number };
  export default sodium;
}
