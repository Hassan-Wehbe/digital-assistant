// Vault rules that are not cryptography: when the unlocked vault locks again, and the
// steps to reveal one secret. Pure logic (the phone parts are passed in), so it is
// unit-tested; vault.tsx uses it.
import { linkToken } from './upload';
import type { SecretFields, VaultCrypto, VaultKeys } from './vaultCrypto';
import type { RevealLink } from './wilma';

/** Owner's choice (2026-09-30): open for 5 minutes, locked after a minute away from the app. */
export const UNLOCK_MS = 5 * 60 * 1000;
export const AWAY_MS = 60 * 1000;
/** Revealed values hide again, and a copied value leaves the clipboard, after 30 seconds. */
export const SHOW_MS = 30 * 1000;

/** Should an unlocked vault lock now? `awaySince`: when the app went to the background, if it is there. */
export function shouldLock(unlockedAt: number, now: number, awaySince: number | null): boolean {
  if (now - unlockedAt >= UNLOCK_MS) return true;
  return awaySince !== null && now - awaySince >= AWAY_MS;
}

export interface RevealDeps {
  revealLink(secretId: string): Promise<Pick<RevealLink, 'reveal_link'>>;
  rpc(fn: 'get_reveal_request' | 'reveal_secret', args: { p_token: string }): Promise<any>;
}

export interface Revealed {
  name: string;
  url: string | null;
  type: string;
  fields: SecretFields;
}

/**
 * Reveal one secret: Wilma gives a one-time link (get_secret), the app uses it itself
 * (get_reveal_request checks it, reveal_secret returns the ciphertext once and logs the
 * reveal), and the value is decrypted here. Never log the result.
 */
export async function revealSecret(deps: RevealDeps, crypto: VaultCrypto, keys: VaultKeys, secretId: string): Promise<Revealed> {
  const link = await deps.revealLink(secretId);
  const token = linkToken(link.reveal_link);
  if (!token) throw new Error('Wilma sent a reveal link the app could not read.');
  const request = await deps.rpc('get_reveal_request', { p_token: token });
  if (request?.secret_id !== secretId) throw new Error('The reveal link is for a different secret. Try again.');
  const sealed = await deps.rpc('reveal_secret', { p_token: token });
  if (sealed?.secret_id !== secretId) throw new Error('Wilma sent a different secret. Try again.');
  const secret = crypto.openSecret(keys, sealed.payload_enc, secretId);
  return { name: sealed.name, url: sealed.url ?? null, type: secret.type, fields: secret.fields };
}
