// Spaces on Home (owner, 2026-10-18, D38): the favourites; until there are any, the six opened most
// recently on this phone (owner, 2026-10-09); then All spaces.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { favouriteSpaces, hiddenSpaceIds, HOME_SPACES, homeSpaces, isTasksSpace, MAX_RECENT, parseRecent, recentKey, recentSpacesStore, rememberOpened } from './homeSpaces';
import type { Space } from './wilma';

const sp = (id: string, path: string, restricted = false): Space => ({ id, path, description: null, restricted });
const SPACES = [
  sp('w', 'Work'), sp('r', 'Recipes'), sp('t', 'Tasks'), sp('h', 'Home'), sp('g', 'Work/Gartner'),
  sp('p', 'Private', true), sp('c', 'Cars'), sp('k', 'Kids'),
];

describe('Home spaces', () => {
  it('shows the opened ones first, then fills alphabetically; never Tasks or a restricted space', () => {
    const out = homeSpaces(SPACES, ['g', 'p', 't', 'gone', 'r']);
    expect(out.shown.map((s) => s.path)).toEqual(['Work/Gartner', 'Recipes', 'Cars', 'Home', 'Kids', 'Work']);
    expect(out.shown).toHaveLength(HOME_SPACES);
    expect(out.favourites).toBe(false);
    expect(out.total).toBe(7); // all but Tasks (restricted ones are listed under All spaces)
    expect(out.more).toBe(1);
  });

  it('a new phone shows the first six alphabetically; few spaces need no All spaces', () => {
    expect(homeSpaces(SPACES, []).shown.map((s) => s.path)).toEqual(['Cars', 'Home', 'Kids', 'Recipes', 'Work', 'Work/Gartner']);
    expect(homeSpaces([sp('w', 'Work'), sp('t', 'Tasks')], []).more).toBe(0);
  });

  it('Tasks is only a top-level, not restricted space named Tasks', () => {
    expect(isTasksSpace(sp('t', ' tasks '))).toBe(true);
    expect(isTasksSpace(sp('t', 'Work/Tasks'))).toBe(false);
    expect(isTasksSpace(sp('t', 'Tasks', true))).toBe(false);
  });

  it('the built-in Tasks space is Tasks; a space only named Tasks is not, once one is built-in', () => {
    expect(isTasksSpace({ ...sp('t', 'Tasks'), built_in: 'tasks' })).toBe(true);
    expect(isTasksSpace({ ...sp('m', 'Memories'), built_in: 'memories' })).toBe(false);
    expect(isTasksSpace({ ...sp('t', 'Tasks'), built_in: 'memories' })).toBe(false);
  });

  it('remembers the newest first, once, at most MAX_RECENT', () => {
    expect(rememberOpened(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(rememberOpened(Array.from({ length: MAX_RECENT }, (_, i) => `s${i}`), 'new')).toHaveLength(MAX_RECENT);
    expect(parseRecent('["a","a",3,"b"]')).toEqual(['a', 'b']);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
  });

  it('keeps ids only, per account, and forgets other accounts', async () => {
    const data = new Map<string, string>([[recentKey('other'), '["x"]'], ['wilma.day.u1', 'keep']]);
    const store = recentSpacesStore({
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => void data.set(k, v),
      remove: async (k) => void data.delete(k),
      keys: async () => [...data.keys()],
    });
    await store.save('u1', ['w', 'r']);
    expect(await store.load('u1')).toEqual(['w', 'r']);
    await store.forgetOthers('u1');
    expect([...data.keys()].sort()).toEqual([recentKey('u1'), 'wilma.day.u1'].sort());
    await store.forgetOthers(null);
    expect(data.has(recentKey('u1'))).toBe(false);
  });

  it('screens: Home links to All spaces; a restricted space is never remembered; sign-out forgets', () => {
    const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
    expect(read('app/index.tsx')).toContain("router.push('/spaces')");
    expect(read('lib/openSpace.ts')).toContain('if (userId && !s.restricted)');
    expect(read('lib/openSpace.ts')).toContain("router.push('/tasks')");
    expect(read('lib/auth.tsx')).toContain('deviceRecentSpaces.forgetOthers(keep)');
  });
});

describe('Favourites on Home (D38)', () => {
  const NESTED = [...SPACES, sp('pi', 'Private/Inner'), sp('pd', 'Private/Inner/Deep'), sp('pv', 'Privateer')];

  it('shows the favourites in their order instead of the recent ones', () => {
    const out = homeSpaces(SPACES, ['g', 'r'], ['k', 'w']);
    expect(out.shown.map((s) => s.path)).toEqual(['Kids', 'Work']);
    expect(out.favourites).toBe(true);
    expect(out.more).toBe(5);
  });

  it('never shows Tasks, a restricted space or one under it, even if the server sent them', () => {
    expect(homeSpaces(NESTED, [], ['t', 'p', 'pi', 'pd', 'h']).shown.map((s) => s.path)).toEqual(['Home']);
    expect(favouriteSpaces(NESTED, ['pv', 'gone', 'pi'])).toEqual([sp('pv', 'Privateer')]);
  });

  it('falls back to the recent ones with no favourites, or when they cannot be read', () => {
    expect(homeSpaces(SPACES, ['r'], []).favourites).toBe(false);
    expect(homeSpaces(SPACES, ['r'], null).shown[0].path).toBe('Recipes');
    expect(homeSpaces(SPACES, [], ['p', 't']).favourites).toBe(false); // nothing left to show
  });

  it('spaces under a restricted one are hidden by path, not by a similar name', () => {
    expect([...hiddenSpaceIds(NESTED)].sort()).toEqual(['p', 'pd', 'pi']);
    expect(homeSpaces(NESTED, ['pi', 'pv']).shown.map((s) => s.path)).not.toContain('Private/Inner');
  });
});
