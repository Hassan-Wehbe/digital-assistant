// Favourite spaces (D38, docs/home-cleanup-plan.md step 2): at most 6, in order, saved whole on the
// server; Tasks, restricted spaces and spaces under one are never offered.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { canBeFavourite, loadFavourites, MAX_FAVOURITES, moveFavourite, parseFavourites, saveFavourites, toggleFavourite } from './favourites';
import { HOME_SPACES } from './homeSpaces';
import type { Space } from './wilma';

const sp = (id: string, path: string, restricted = false, built_in?: string): Space => ({ id, path, description: null, restricted, built_in });
const SPACES = [sp('w', 'Work'), sp('t', 'Tasks', false, 'tasks'), sp('m', 'Memories', false, 'memories'), sp('p', 'Private', true), sp('pi', 'Private/Inner')];

describe('Favourites', () => {
  it('holds as many as Home shows', () => {
    expect(MAX_FAVOURITES).toBe(HOME_SPACES);
  });

  it('offers the ☆ only on spaces that can be one', () => {
    expect(canBeFavourite(SPACES[0], SPACES)).toBe(true);
    expect(canBeFavourite(SPACES[2], SPACES)).toBe(true); // Memories is fine
    expect(canBeFavourite(SPACES[1], SPACES)).toBe(false); // Tasks
    expect(canBeFavourite(SPACES[3], SPACES)).toBe(false); // restricted
    expect(canBeFavourite(SPACES[4], SPACES)).toBe(false); // under a restricted space
  });

  it('adds at the end, removes, and refuses a seventh before asking the server', () => {
    expect(toggleFavourite(['a'], 'b')).toEqual({ list: ['a', 'b'] });
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual({ list: ['b'] });
    const full = ['1', '2', '3', '4', '5', '6'];
    const out = toggleFavourite(full, '7');
    expect(out.list).toEqual(full);
    expect(out.error).toMatch(/at most 6/);
    expect(toggleFavourite(full, '3').list).toEqual(['1', '2', '4', '5', '6']);
  });

  it('moves one place, and stays put at either end', () => {
    expect(moveFavourite(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveFavourite(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveFavourite(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveFavourite(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(moveFavourite(['a'], 'x', 1)).toEqual(['a']);
  });

  it('keeps only sensible ids from the server', () => {
    expect(parseFavourites(['a', 'a', 3, '', 'b'])).toEqual(['a', 'b']);
    expect(parseFavourites(null)).toEqual([]);
    expect(parseFavourites(Array.from({ length: 9 }, (_, i) => `s${i}`))).toHaveLength(6);
  });

  it('reads and saves through the two database functions', async () => {
    const calls: [string, unknown][] = [];
    const rpc = async (fn: string, args?: Record<string, unknown>) => {
      calls.push([fn, args]);
      return { data: fn === 'my_favourite_spaces' ? ['w'] : (args?.p_ids as string[]), error: null };
    };
    expect(await loadFavourites(rpc)).toEqual(['w']);
    expect(await saveFavourites(rpc, ['w', 'm'])).toEqual(['w', 'm']);
    expect(calls).toEqual([
      ['my_favourite_spaces', undefined],
      ['set_favourite_spaces', { p_ids: ['w', 'm'] }],
    ]);
  });

  it('a list that cannot be read is null (Home shows recent spaces); a refused save throws its message', async () => {
    expect(await loadFavourites(async () => ({ data: null, error: { message: 'function does not exist' } }))).toBeNull();
    expect(
      await loadFavourites(async () => {
        throw new Error('offline');
      }),
    ).toBeNull();
    await expect(saveFavourites(async () => ({ data: null, error: { message: 'That space cannot be a favourite.' } }), ['p'])).rejects.toThrow(
      'That space cannot be a favourite.',
    );
  });

  it('screens: Home shows the favourites, All spaces edits them, a space has the ☆; Save here is in ＋', () => {
    const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
    const home = read('app/index.tsx');
    expect(home).toContain('homeSpaces(spaces, recent.data ?? [], favourites.data)');
    expect(home).toContain("go({ here: '1' })");
    expect(home).toContain('<PlanRow');
    expect(read('app/spaces.tsx')).toContain('saveFavourites(rpc, next)');
    expect(read('app/spaces.tsx')).toContain('canBeFavourite(sp, spaces)');
    expect(read('app/space/[id].tsx')).toContain('fav.data?.allowed');
  });
});
