// Vault entries on a space screen (handoff job 3): 🔒 rows under the notes, name and website only;
// a tap opens the entry in the Vault (which asks for the unlock only when locked).
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { secretRoute, spaceSecretRow } from './secretRows';
import type { SecretMeta } from './wilma';

const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(SRC, f), 'utf8');

const entry = (over: Partial<SecretMeta> = {}): SecretMeta => ({
  id: 's1',
  name: 'Supabase',
  url: 'https://supabase.com',
  secret_type: 'password',
  space: 'Logins',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  last_accessed_at: null,
  ...over,
});

describe('spaceSecretRow', () => {
  it('shows the name with a lock, then the website', () => {
    expect(spaceSecretRow(entry())).toEqual({ title: '🔒 Supabase', subtitle: 'https://supabase.com' });
  });

  it('has no second line without a website', () => {
    expect(spaceSecretRow(entry({ url: null }))).toEqual({ title: '🔒 Supabase', subtitle: undefined });
    expect(spaceSecretRow(entry({ url: '' }))).toEqual({ title: '🔒 Supabase', subtitle: undefined });
  });

  it('never carries anything else, even if a row had more fields', () => {
    const odd = { ...entry(), value: 'hunter2', password: 'hunter2' } as SecretMeta;
    const row = spaceSecretRow(odd);
    expect(Object.keys(row).sort()).toEqual(['subtitle', 'title']);
    expect(JSON.stringify(row)).not.toContain('hunter2');
  });
});

describe('secretRoute', () => {
  it("opens the entry's screen with its name, type, space and website", () => {
    expect(secretRoute(entry())).toEqual({
      pathname: '/vault/[id]',
      params: { id: 's1', name: 'Supabase', type: 'password', space: 'Logins', url: 'https://supabase.com' },
    });
  });

  it('sends empty strings for a missing space or website', () => {
    expect(secretRoute(entry({ space: undefined, url: null })).params).toMatchObject({ space: '', url: '' });
  });

  it('never carries anything else, even if a row had more fields', () => {
    const odd = { ...entry(), value: 'hunter2' } as SecretMeta;
    expect(JSON.stringify(secretRoute(odd))).not.toContain('hunter2');
  });
});

describe('the space screen', () => {
  const src = read('app/space/[id].tsx');

  it("asks for this space's entries only", () => {
    expect(src).toContain('wilma.findSecrets({ space: id })');
  });

  it('lists them as 🔒 rows that open the entry in the Vault', () => {
    expect(src).toMatch(/<GroupRow key=\{s\.id\} first=\{i === 0\} \{\.\.\.spaceSecretRow\(s\)\} onPress=\{\(\) => router\.push\(secretRoute\(s\)\)\} \/>/);
  });

  it('puts them under the notes (in the footer, above the space buttons)', () => {
    const footer = src.indexOf('ListFooterComponent=');
    expect(footer).toBeGreaterThan(0);
    expect(src.indexOf('spaceSecretRow(s)')).toBeGreaterThan(footer);
    expect(src.indexOf('spaceSecretRow(s)')).toBeLessThan(src.indexOf('title="New space inside this one"'));
  });

  it('never reveals, unlocks or reads a value itself', () => {
    for (const s of ['revealLink', 'reveal(', 'useVault', 'UnlockCard', 'newValueLink', 'secretClipboard']) {
      expect(src).not.toContain(s);
    }
  });

  it('says "Nothing in this space yet" only when there are no notes and no entries', () => {
    expect(src).toContain(
      'const nothing = !loading && !secrets.loading && !error && !secrets.error && !data?.length && !secrets.data?.length;',
    );
    expect(src).toContain('nothing ? <Muted>Nothing in this space yet.</Muted> : null');
  });

  it('reloads the entries on return (after a rename or delete in the Vault) and on pull-down', () => {
    expect(src).toContain('useReloadOnReturn(secrets.reload);');
    expect(src).toContain('onRefresh={reloadAll}');
  });
});

describe('the Vault list', () => {
  it('opens an entry the same way', () => {
    expect(read('app/vault/index.tsx')).toContain('router.push(secretRoute(s))');
  });
});

describe('home', () => {
  // Password-only spaces (like Logins) are ordinary spaces: home lists every space it is given.
  it('lists every space, whatever it holds', () => {
    const src = read('app/index.tsx');
    expect(src).toContain("(await wilma.listSpaces()).map((space) => ({ kind: 'space', space }))");
    expect(src).toContain('{spaces.map((sp, i) =>');
  });
});
