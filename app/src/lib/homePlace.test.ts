// "Where do you leave from?": Home is one place note of kind home, in an unrestricted Places space.
import { describe, expect, it } from '@jest/globals';

import { findHome, saveHome, savedSpots, type HomeDeps } from './homePlace';
import { EMPTY_PLACE, placeForm, placeLine, placeMetadata } from './places';
import type { SearchResult, Space } from './wilma';

const result = (over: Partial<SearchResult>): SearchResult => ({
  id: 'x', title: 'X', item_type: 'place', space: 'Places', tags: null, snippet: null, updated_at: '2026-10-08', ...over,
});

function deps(spaces: Space[], found: SearchResult[] = [], fail?: string) {
  const calls: string[] = [];
  const saved: unknown[] = [];
  const d: HomeDeps = {
    listSpaces: async () => spaces,
    createSpace: async (s) => {
      calls.push(`create:${s.name}`);
      return { id: 'new-space' };
    },
    search: async (o) => {
      calls.push(`search:${o.query}:${o.item_type}`);
      return found;
    },
    saveItem: async (item) => {
      if (fail) throw new Error(fail);
      saved.push(item);
      return { id: 'home-id' };
    },
    updateItem: async (id, changes) => {
      saved.push({ update: id, ...changes });
    },
  };
  return { d, calls, saved };
}

describe('Home', () => {
  it('is saved in the Places space (never a restricted one), made when there is none', async () => {
    const restricted: Space = { id: 'r', path: 'Places', description: null, restricted: true };
    const { d, calls, saved } = deps([restricted]);
    expect(await saveHome(d, { lat: 28.6, lng: -81.2, address: '1 Elm St, Oviedo' })).toEqual({ ok: true });
    expect(calls).toContain('create:Places');
    expect(saved[0]).toEqual({
      space: 'new-space', title: 'Home', body: '', item_type: 'place', metadata: { kind: 'home', lat: 28.6, lng: -81.2, address: '1 Elm St, Oviedo' },
    });
  });

  it('uses an existing Places space', async () => {
    const { d, calls, saved } = deps([{ id: 'p', path: 'places', description: null, restricted: false }]);
    await saveHome(d, { lat: 1, lng: 2 });
    expect(calls).not.toContain('create:Places');
    expect(saved[0]).toMatchObject({ space: 'p', metadata: { kind: 'home', lat: 1, lng: 2 } });
  });

  it('changing it updates the same note (one Home only)', async () => {
    const home = result({ id: 'h1', title: 'Our house', place: { kind: 'home', lat: 1, lng: 2 } });
    const { d, saved } = deps([], [result({ id: 'cafe', place: { kind: 'cafe' } }), home]);
    expect(await findHome(d, 'Our house')).toBe('h1');
    await saveHome(d, { lat: 3, lng: 4 }, 'Our house');
    expect(saved).toEqual([{ update: 'h1', metadata: { kind: 'home', lat: 3, lng: 4 } }]);
  });

  it('says plainly when another Home exists that it could not find', async () => {
    const { d } = deps([], [], 'there is already a Home place ("Mum’s"); change that one with update_item instead');
    const out = await saveHome(d, { lat: 1, lng: 2 });
    expect(out).toEqual({ error: 'You already have a Home place, “Mum’s”. Open that note and edit its location to change it.' });
  });

  it('a saved place can be picked only when it has a location (and is not Home)', () => {
    const picks = savedSpots([
      result({ id: 'a', title: 'Aquatic Center', place: { kind: 'other', lat: 28.6, lng: -81.2, address: 'Oviedo' } }),
      result({ id: 'b', title: 'No spot', place: { kind: 'cafe' } }),
      result({ id: 'h', title: 'Home', place: { kind: 'home', lat: 1, lng: 2 } }),
      result({ id: 'n', title: 'A note', item_type: 'note' }),
    ]);
    expect(picks).toEqual([{ id: 'a', lat: 28.6, lng: -81.2, label: 'Aquatic Center', address: 'Oviedo' }]);
  });

  it('editing the Home note keeps it Home (the kind picker does not offer it)', () => {
    const base = { kind: 'home' as const, lat: 1, lng: 2, status: 'want' as const };
    const form = placeForm(base);
    expect(form.kind).toBeNull();
    expect(placeMetadata(form, base)).toEqual({ metadata: expect.objectContaining({ kind: 'home', lat: 1, lng: 2 }) });
    expect(placeMetadata(EMPTY_PLACE, null)).toEqual({ metadata: expect.not.objectContaining({ kind: 'home' }) });
    expect(placeLine(base)).toMatch(/^Home/);
  });
});
