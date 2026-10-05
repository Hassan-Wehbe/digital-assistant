import { describe, expect, it } from '@jest/globals';

import { MAX_NOTES, routeMessage, type RouteReads, type Verdict } from './chatRoute';
import type { SearchResult, SecretMeta, Space } from './wilma';

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

const note = (id: string, title: string, space?: string): SearchResult => ({
  id, title, item_type: 'recipe', space, tags: null, snippet: `About ${title}`, updated_at: '2026-10-01',
});

function classified(verdict: Verdict | Error, results: SearchResult[] | Error = [note('n1', 'Lasagna', 'Recipes')]) {
  const { r, calls } = reads();
  const asked: string[] = [];
  const searched: string[] = [];
  r.classify = async (text) => {
    asked.push(text);
    if (verdict instanceof Error) throw verdict;
    return verdict;
  };
  r.searchNotes = async (query) => {
    searched.push(query);
    if (results instanceof Error) throw results;
    return results;
  };
  return { r, calls, asked, searched };
}

describe('routeMessage, step 6: the classifier for a short message that matches no name', () => {
  it('a search shows the notes found, with the classifier\'s words', async () => {
    const { r, asked, searched } = classified({ route: 'search', query: 'lasagna' });
    expect(await routeMessage('lasagna recipe', r)).toEqual({
      to: 'notes', query: 'lasagna', notes: [{ id: 'n1', title: 'Lasagna', space: 'Recipes', snippet: 'About Lasagna' }],
    });
    expect(asked).toEqual(['lasagna recipe']);
    expect(searched).toEqual(['lasagna']);
  });

  it('at most five notes, and only the fields the card shows', async () => {
    const many = Array.from({ length: 9 }, (_, i) => note(`n${i}`, `Note ${i}`));
    const { r } = classified({ route: 'search', query: 'note' }, many);
    const route = await routeMessage('note', r);
    expect(route.to === 'notes' && route.notes.length).toBe(MAX_NOTES);
    expect(route.to === 'notes' && Object.keys(route.notes[0]).sort()).toEqual(['id', 'snippet', 'title']);
  });

  it('wilma, no notes, an error or a failed search all mean Wilma', async () => {
    for (const [verdict, results] of [
      [{ route: 'wilma' }, undefined],
      [{ route: 'search', query: 'lasagna' }, []],
      [new Error('offline'), undefined],
      [{ route: 'search', query: 'lasagna' }, new Error('offline')],
      [{ route: 'search', query: '   ' }, undefined],
    ] as [Verdict | Error, SearchResult[] | Error | undefined][]) {
      const { r } = classified(verdict, results);
      expect(await routeMessage('lasagna recipe', r)).toEqual({ to: 'wilma' });
    }
  });

  it('a name that matches is a lookup, never the classifier', async () => {
    const { r, asked } = classified({ route: 'search', query: 'recipes' });
    expect(await routeMessage('recipes', r)).toEqual(expect.objectContaining({ to: 'space' }));
    expect(asked).toEqual([]);
  });

  it('two names, a sentence, a write or vault words go to Wilma without the classifier', async () => {
    for (const text of ['how much did I pay for the roof', 'delete recipes', 'bank pin', 'my netflix password']) {
      const { r, asked } = classified({ route: 'search', query: 'x' });
      expect(await routeMessage(text, r)).toEqual({ to: 'wilma' });
      expect(asked).toEqual([]);
    }
    const twins = classified({ route: 'search', query: 'bank' });
    twins.r.findSecrets = async () => [meta('k1', 'Bank'), meta('k2', 'Bank')];
    expect(await routeMessage('bank', twins.r)).toEqual({ to: 'wilma' });
    expect(twins.asked).toEqual([]);
  });

  it('without a classifier (allowance used up), no name means Wilma as before', async () => {
    const { r } = reads();
    expect(await routeMessage('lasagna recipe', r)).toEqual({ to: 'wilma' });
  });

  it('a restricted space\'s name behaves exactly like an unknown word (rule 3)', async () => {
    const health = classified({ route: 'search', query: 'health' }, []);
    const unknown = classified({ route: 'search', query: 'zebra' }, []);
    expect(await routeMessage('health', health.r)).toEqual(await routeMessage('zebra', unknown.r));
    expect(health.asked).toEqual(['health']);
  });
});
