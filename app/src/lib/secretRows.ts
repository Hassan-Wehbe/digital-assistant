// Vault entries as list rows (the Vault, and a space screen under its notes): name and website
// only, never a value. A tap opens the entry's own screen, which asks for the unlock only when
// the vault is locked.
import type { SecretMeta } from './wilma';

/** The entry's screen, with what it shows before anything is unlocked. */
export const secretRoute = (s: SecretMeta) => ({
  pathname: '/vault/[id]' as const,
  params: { id: s.id, name: s.name, type: s.secret_type, space: s.space ?? '', url: s.url ?? '' },
});

/** A 🔒 row on a space screen: the name, then the website when there is one. */
export const spaceSecretRow = (s: SecretMeta) => ({ title: `🔒 ${s.name}`, subtitle: s.url || undefined });
