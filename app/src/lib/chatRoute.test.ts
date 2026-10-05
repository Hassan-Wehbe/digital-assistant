import { describe, expect, it } from '@jest/globals';

import { routeMessage, type RouteReads } from './chatRoute';
import type { SecretMeta, Space } from './wilma';

const SPACES: Space[] = [
  { id: 's-recipes', path: 'Recipes', description: null, restricted: false },
  { id: 's-health', path: 'Health', description: null, restricted: true },
];
const meta = (id: string, name: string, space?: string): SecretMeta => ({
  id,
  name,
  url: 'https://example.invalid/login',
  secret_type: 'login',
  space,
  created_at: '2026-10-01',
  updated_at: '2026-10-01',
  last_accessed_at: null,
});

function reads(opts: { secrets?: SecretMeta[]; spacesFail?: boolean; secretsFail?: boolean } = {}) {
  const calls: { spaces: number; queries: string[] } = { spaces: 0, queries: [] };
  const r: RouteReads = {
    spaces: async () => {
      calls.spaces++;
      if (opts.spacesFail) throw new Error('offline');
      return SPACES;
    },
    findSecrets: async (query) => {
      calls.queries.push(query);
      if (opts.secretsFail) throw new Error('offline');
      return opts.secrets ?? [];
    },
  };
  return { r, calls };
}

describe('routeMessage', () => {
  it('a sentence, a write or a value goes to Wilma with no read at all', async () => {
    for (const text of ['how much did I pay for the roof', 'delete recipes', 'the wifi is hunter2', 'pin: 1234']) {
      const { r, calls } = reads();
      expect(await routeMessage(text, r)).toEqual({ to: 'wilma' });
      expect(calls).toEqual({ spaces: 0, queries: [] });
    }
  });

  it('a space name opens the space; the vault search gets only the words to look for', async () => {
    const { r, calls } = reads();
    expect(await routeMessage('open the Recipes space', r)).toEqual({ to: 'space', space: { id: 's-recipes', path: 'Recipes', name: 'Recipes' } });
    expect(calls.queries).toEqual(['Recipes']);
  });

  it('a secret name gives the secret with id, name, kind and space only', async () => {
    const { r, calls } = reads({ secrets: [meta('k1', 'Bank login', 'Logins')] });
    const route = await routeMessage('what is my bank password', r);
    expect(route).toEqual({ to: 'secret', secret: { id: 'k1', name: 'Bank login', secretType: 'login', space: 'Logins' } });
    expect(JSON.stringify(route)).not.toMatch(/https/);
    expect(calls.queries).toEqual(['bank password']);
  });

  it('a secret the server returned that is not an exact name goes to Wilma', async () => {
    const { r } = reads({ secrets: [meta('k1', 'Bank of Montreal online banking')] });
    expect(await routeMessage('bank', r)).toEqual({ to: 'wilma' });
  });

  it('a restricted space’s name goes to Wilma, also when the server returns a secret inside it', async () => {
    const { r } = reads({ secrets: [meta('k2', 'Health', 'Health')] });
    expect(await routeMessage('health', r)).toEqual({ to: 'wilma' });
  });

  it('any failed read means Wilma (never a guess from half the names)', async () => {
    expect(await routeMessage('recipes', reads({ secretsFail: true }).r)).toEqual({ to: 'wilma' });
    expect(await routeMessage('recipes', reads({ spacesFail: true }).r)).toEqual({ to: 'wilma' });
  });
});
