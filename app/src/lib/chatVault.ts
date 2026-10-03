// Where a vault card in the chat leads (docs/phase5-a5c-chat-screen-plan.md "Vault events").
// The card never uses the server's one-time link (the stream drops it as it is read): it opens
// the app's own vault screens, which ask for the fingerprint or passphrase and keep values out
// of the chat. Pure logic: the screen turns the result into a route.

import type { Entry } from './chatThread';
import { SECRET_FIELDS } from './vaultCrypto';

type VaultEntry = Extract<Entry, { kind: 'vault' }>;

export type VaultRoute =
  /** The secret's own screen (reveal after unlocking). */
  | { screen: 'secret'; params: { id: string; name: string; type?: string } }
  /** A new value for an existing secret. */
  | { screen: 'change'; params: { id: string; name: string; type: string } }
  /** "Save a new secret", with the name and kind filled in (the user picks the space). */
  | { screen: 'new'; params: { name: string; type: string } }
  /** The vault list: when the card does not say enough to open the right screen. */
  | { screen: 'list' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A kind of secret the entry screen has a form for. */
const knownType = (type: string | undefined): type is string => !!type && Object.hasOwn(SECRET_FIELDS, type);

export function vaultRoute(card: VaultEntry): VaultRoute {
  if (card.action === 'enter') {
    // Without the kind the app would have to guess the form: the list instead (an older server).
    if (!knownType(card.secretType)) return { screen: 'list' };
    if (card.newSecret) return { screen: 'new', params: { name: card.name, type: card.secretType } };
    if (!UUID.test(card.secretId)) return { screen: 'list' };
    return { screen: 'change', params: { id: card.secretId, name: card.name, type: card.secretType } };
  }
  if (!UUID.test(card.secretId)) return { screen: 'list' };
  return { screen: 'secret', params: { id: card.secretId, name: card.name, ...(knownType(card.secretType) ? { type: card.secretType } : {}) } };
}

/** The card's text and its one button. */
export function vaultCardText(card: VaultEntry): { text: string; button: string } {
  return card.action === 'reveal'
    ? { text: `Open “${card.name}” in your vault`, button: 'Open in the vault' }
    : { text: `Enter the value for “${card.name}” in your vault`, button: 'Enter the value' };
}
