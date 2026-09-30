// Vault rules that are not cryptography: when the unlocked vault locks again, and the
// steps to reveal, save or change one secret. Pure logic (the phone parts are passed in),
// so it is unit-tested; vault.tsx uses it.
import { linkToken } from './upload';
import { SECRET_FIELDS, VaultError, type SecretFields, type VaultCrypto, type VaultKeys } from './vaultCrypto';
import type { EntryLink, NewSecret, RevealLink, SecretMeta } from './wilma';

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

// ---------- saving and changing values ----------

/**
 * The entry form's values as a secret's fields, the same way the web entry page
 * (docs/vault/enter.js) does it: single-line values kept exactly as typed (a password may
 * end in a space), text boxes trimmed at the end, empty fields left out.
 */
export function entryFields(type: string, values: Record<string, string>): SecretFields {
  const specs = SECRET_FIELDS[type];
  if (!specs) throw new VaultError('bad_type', 'Choose what kind of secret this is.');
  const fields: SecretFields = {};
  for (const f of specs) {
    const raw = values[f.key] ?? '';
    const value = f.kind === 'textarea' ? raw.replace(/\s+$/, '') : raw;
    if (value !== '') fields[f.key] = value;
    else if (f.required) throw new VaultError('missing', `Fill in "${f.label}".`);
  }
  return fields;
}

export interface EntryDeps {
  rpc(fn: 'get_secret_entry_request' | 'complete_secret_entry', args: Record<string, unknown>): Promise<any>;
}

interface Expected {
  secretId: string;
  secretType: string;
  isUpdate: boolean;
  /** The vault's public key as the app knows it (get_vault_keys), when loaded. */
  publicKey: string | null;
}

/**
 * Use an entry link on the phone: get_secret_entry_request says what it is for (and gives
 * the public key), the value is sealed here, and complete_secret_entry stores only the
 * ciphertext (and uses up the link). Nothing is sent before every check has passed.
 */
async function completeEntry(deps: EntryDeps, crypto: VaultCrypto, link: string, expected: Expected, fields: SecretFields) {
  const token = linkToken(link);
  if (!token) throw new Error('Wilma sent an entry link the app could not read.');
  const request = await deps.rpc('get_secret_entry_request', { p_token: token });
  if (request?.secret_id !== expected.secretId || !!request.is_update !== expected.isUpdate || request.secret_type !== expected.secretType) {
    throw new Error('The entry link is for a different secret. Nothing was saved; try again.');
  }
  if (expected.publicKey && request.public_key !== expected.publicKey) {
    throw new VaultError('key_mismatch', 'The vault key Wilma sent does not match your vault. Nothing was saved; ask for help.');
  }
  const payload = crypto.sealSecret(request.public_key, request.secret_id, request.secret_type, fields);
  const done = await deps.rpc('complete_secret_entry', { p_token: token, p_payload_enc: payload });
  return { id: String(request.secret_id), name: String(done?.name ?? request.name) };
}

export interface SaveDeps extends EntryDeps {
  saveSecret(input: NewSecret): Promise<EntryLink & { secret: { id: string } }>;
}

/**
 * Save a new secret: save_secret (metadata only) gives an entry link, which the app uses
 * itself. The fields are checked first, so a form with a missing value asks Wilma nothing.
 * Needs only the public key, not an unlocked vault. Never log `values`.
 */
export async function saveNewSecret(
  deps: SaveDeps,
  crypto: VaultCrypto,
  input: NewSecret,
  values: Record<string, string>,
  publicKey: string | null,
) {
  const name = input.name.trim();
  if (!name) throw new VaultError('missing', 'Give the secret a name.');
  const fields = entryFields(input.secret_type, values);
  const url = input.url?.trim();
  const started = await deps.saveSecret({ ...input, name, url: url || undefined });
  return completeEntry(deps, crypto, started.entry_link, { secretId: started.secret.id, secretType: input.secret_type, isUpdate: false, publicKey }, fields);
}

export interface ChangeDeps extends EntryDeps {
  newValueLink(secretId: string): Promise<EntryLink>;
}

/** Replace a secret's value (update_secret with new_value, then the same entry steps). */
export async function changeSecretValue(
  deps: ChangeDeps,
  crypto: VaultCrypto,
  secret: { id: string; type: string },
  values: Record<string, string>,
  publicKey: string | null,
) {
  const fields = entryFields(secret.type, values);
  const link = await deps.newValueLink(secret.id);
  return completeEntry(deps, crypto, link.entry_link, { secretId: secret.id, secretType: secret.type, isUpdate: true, publicKey }, fields);
}

// ---------- name and website ----------

/**
 * What changed between the shown name/website and the edited ones, for update_secret;
 * null when nothing did. An emptied website is sent as '' (removes it).
 */
export function detailsChange(
  current: { name: string; url: string | null },
  edited: { name: string; url: string },
): { name?: string; url?: string } | null {
  const name = edited.name.trim();
  if (!name) throw new VaultError('missing', 'The name cannot be empty.');
  if (name.length > 200) throw new VaultError('too_long', 'Use at most 200 characters for the name.');
  const url = edited.url.trim();
  const change: { name?: string; url?: string } = {};
  if (name !== current.name) change.name = name;
  if (url !== (current.url ?? '')) change.url = url;
  return Object.keys(change).length ? change : null;
}

/** Secrets already saved under this name in this space (save_secret would add a second one). */
export function sameName(secrets: SecretMeta[], name: string, spacePath: string | undefined): SecretMeta[] {
  const n = name.trim().toLowerCase();
  return secrets.filter((s) => s.name.toLowerCase() === n && s.space === spacePath);
}
