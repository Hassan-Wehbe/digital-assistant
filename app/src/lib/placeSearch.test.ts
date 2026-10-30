// Find a place by name: only the typed words are sent, the answer is checked again, and every
// way it can fail ends in something the screen can show (never a crash).
import { describe, expect, it } from '@jest/globals';

import { looksLikeStreetAddress, newSearchSession, placeSearchClient, readSearchAnswer, type JsonFetch } from './placeSearch';
import { WilmaError } from './wilma';

const OK = {
  available: true,
  suggestions: [
    { place_id: 'ChIJ-lib_1', name: 'Coral Gables Branch Library', address: '3443 Segovia St, Coral Gables, FL', kind: 'library' },
    { place_id: 'bad id!', name: 'Bad' },
    { place_id: 'ChIJ-x', name: '  ' },
    { place_id: 'ChIJ-shop', name: 'Bookstore', address: 'Coral Gables', kind: 'spaceship' },
  ],
};

describe('readSearchAnswer', () => {
  it('keeps only well-formed suggestions and known kinds', () => {
    expect(readSearchAnswer(200, OK)).toEqual({
      suggestions: [
        { placeId: 'ChIJ-lib_1', name: 'Coral Gables Branch Library', address: '3443 Segovia St, Coral Gables, FL', kind: 'library' },
        { placeId: 'ChIJ-shop', name: 'Bookstore', address: 'Coral Gables' },
      ],
    });
  });
  it('says when the search is not set up or resting for the day', () => {
    expect(readSearchAnswer(200, { available: false, reason: 'not_set_up' })).toEqual({ unavailable: 'not_set_up' });
    expect(readSearchAnswer(200, { available: false, reason: 'daily_limit' })).toEqual({ unavailable: 'daily_limit' });
  });
  it("passes on a refusal's sentence, and treats anything else as a connection problem", () => {
    expect(readSearchAnswer(400, { error: 'Type at least 3 letters.' })).toEqual({ problem: 'refused', message: 'Type at least 3 letters.' });
    expect(readSearchAnswer(502, { error: 'x' })).toEqual({ problem: 'connection' });
    expect(readSearchAnswer(200, null)).toEqual({ problem: 'connection' });
  });
});

describe('placeSearchClient', () => {
  const fetchOf = (...answers: { status: number; body: unknown }[]) => {
    const sent: { url: string; body: unknown; auth: string }[] = [];
    const f: JsonFetch = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      const a = answers.shift() ?? { status: 500, body: null };
      return { status: a.status, json: async () => a.body };
    };
    return { f, sent };
  };

  it('sends only the typed words and the search id, with the sign-in', async () => {
    const { f, sent } = fetchOf({ status: 200, body: OK });
    const client = placeSearchClient({ url: 'https://x/functions/v1/place-search', token: async () => 'tok', refresh: async () => null, fetch: f });
    const out = await client.search('  coral gables lib ', 'abc12345');
    expect('suggestions' in out && out.suggestions.length).toBe(2);
    expect(sent).toEqual([{ url: 'https://x/functions/v1/place-search', body: { text: 'coral gables lib', session: 'abc12345' }, auth: 'Bearer tok' }]);
  });

  it('refreshes the sign-in once after a 401, and says when the session has ended', async () => {
    const a = fetchOf({ status: 401, body: null }, { status: 200, body: OK });
    const ok = placeSearchClient({ token: async () => 'old', refresh: async () => 'new', fetch: a.f });
    expect('suggestions' in (await ok.search('coral', 'abc12345'))).toBe(true);
    expect(a.sent.map((s) => s.auth)).toEqual(['Bearer old', 'Bearer new']);

    const b = fetchOf({ status: 401, body: null });
    const ended = placeSearchClient({ token: async () => 'old', refresh: async () => null, fetch: b.f });
    await expect(ended.search('coral', 'abc12345')).rejects.toBeInstanceOf(WilmaError);
  });

  it('a network failure is a connection problem, not a crash', async () => {
    const client = placeSearchClient({ token: async () => 'tok', refresh: async () => null, fetch: async () => { throw new Error('offline'); } });
    expect(await client.search('coral', 'abc12345')).toEqual({ problem: 'connection' });
  });
});

describe('helpers', () => {
  it('makes a 32-letter search id the server accepts', () => {
    const id = newSearchSession();
    expect(id).toMatch(/^[a-z0-9]{32}$/);
    expect(newSearchSession(() => 0)).toBe('0'.repeat(32));
  });
  it('tells a street address from a name', () => {
    expect(looksLikeStreetAddress('12 Elm St, Miami')).toBe(true);
    expect(looksLikeStreetAddress('3443B Segovia St')).toBe(true);
    expect(looksLikeStreetAddress('Coral Gables library')).toBe(false);
    expect(looksLikeStreetAddress('7 ')).toBe(false);
  });
});
