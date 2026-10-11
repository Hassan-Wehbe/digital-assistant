// Homes (D36, docs/my-places-plan.md step 3): the home_place table, as the signed-in user.
// The default moves only through set_default_home; password-like text never leaves the phone.
import { describe, expect, it } from '@jest/globals';

import {
  addHome, changeHome, checkHome, CREDENTIAL_TEXT, deleteHome, homeCardButtons, homeError, homeLine, listHomes, makeDefault, saveHomeAt,
  savedSpots, spotAddress, toHomeCard, type HomeRow, type HomesDb,
} from './homePlace';
import { EMPTY_PLACE, placeForm, placeLine, placeMetadata } from './places';
import type { SearchResult } from './wilma';

const result = (over: Partial<SearchResult>): SearchResult => ({
  id: 'x', title: 'X', item_type: 'place', space: 'Places', tags: null, snippet: null, updated_at: '2026-10-08', ...over,
});

const HOME: HomeRow = { id: 'h1', label: 'Home', address: '12 Oak St, Oviedo', lat: 28.6, lng: -81.2, is_default: true };
const MOMS: HomeRow = { id: 'h2', label: 'Mom’s', address: '4 Elm Rd', lat: 28.7, lng: -81.3, is_default: false };

/** A stand-in for the Supabase client: records every call, answers from `rows`. */
function fakeDb(rows: HomeRow[] = [], fail?: { code: string; message: string }) {
  const calls: { op: string; arg?: unknown; id?: string }[] = [];
  let next = 1;
  const answer = (data: unknown) => Promise.resolve(fail ? { data: null, error: fail } : { data, error: null });
  const db: HomesDb = {
    from: () => ({
      select: () => ({ order: () => ({ order: () => answer(rows) }) }),
      insert: (row) => {
        calls.push({ op: 'insert', arg: row });
        const made = { id: `new${next++}`, ...row, is_default: !rows.some((r) => r.is_default) };
        return { select: () => ({ single: () => answer(made) }) };
      },
      update: (changes) => ({
        eq: (_c, id) => {
          calls.push({ op: 'update', arg: changes, id });
          const was = rows.find((r) => r.id === id);
          return { select: () => ({ single: () => answer({ ...was, ...changes }) }) };
        },
      }),
      delete: () => ({
        eq: (_c, id) => {
          calls.push({ op: 'delete', id });
          return answer(null);
        },
      }),
    }),
    rpc: (fn, args) => {
      calls.push({ op: `rpc:${fn}`, arg: args });
      return answer({ id: args.p_id, is_default: true });
    },
  };
  return { db, calls };
}

describe('homes', () => {
  it('a new home writes only its name, address and point (never the default: the database sets it)', async () => {
    const { db, calls } = fakeDb();
    const out = await addHome(db, { label: '  Lake\n house ', address: ' 1 Shore Dr ', lat: 28.5, lng: -81.1 });
    expect(calls).toEqual([{ op: 'insert', arg: { label: 'Lake house', address: '1 Shore Dr', lat: 28.5, lng: -81.1 } }]);
    expect(out).toEqual({ home: expect.objectContaining({ label: 'Lake house', is_default: true }) });
  });

  it('refuses text that looks like a password or a code, and sends nothing', async () => {
    const { db, calls } = fakeDb([HOME]);
    for (const h of [
      { label: 'Gate PIN 4821', address: null },
      { label: 'Home', address: 'my password is hunter2!x' },
    ]) {
      expect(checkHome({ ...h, lat: 1, lng: 2 })).toEqual({ error: CREDENTIAL_TEXT });
      expect(await addHome(db, { ...h, lat: 1, lng: 2 })).toEqual({ error: CREDENTIAL_TEXT });
      expect(await saveHomeAt(db, { ...h, lat: 1, lng: 2 }, { asDefault: true })).toEqual({ error: CREDENTIAL_TEXT });
    }
    expect(await changeHome(db, HOME, { label: 'alarm code 1234' })).toEqual({ error: CREDENTIAL_TEXT });
    expect(calls).toEqual([]);
  });

  it('checks the name, the address and the point first', () => {
    expect(checkHome({ label: ' ', lat: 1, lng: 2 })).toEqual({ error: expect.stringContaining('Give the home a name') });
    expect(checkHome({ label: 'x'.repeat(61), lat: 1, lng: 2 })).toEqual({ error: expect.stringContaining('60') });
    expect(checkHome({ label: 'Home', address: 'a'.repeat(301), lat: 1, lng: 2 })).toEqual({ error: expect.stringContaining('300') });
    expect(checkHome({ label: 'Home', lat: 91, lng: 2 })).toEqual({ error: expect.stringContaining('not on the map') });
    expect(checkHome({ label: 'Work', address: '', lat: 1, lng: 2 })).toEqual({ fields: { label: 'Work', address: null, lat: 1, lng: 2 } });
  });

  it('one default: it moves only through set_default_home', async () => {
    const { db, calls } = fakeDb([HOME, MOMS]);
    expect(await makeDefault(db, 'h2')).toBe(true);
    expect(calls).toEqual([{ op: 'rpc:set_default_home', arg: { p_id: 'h2' } }]);
    // No write anywhere names is_default.
    await changeHome(db, MOMS, { address: '5 Elm Rd' });
    for (const c of calls) expect(JSON.stringify(c.arg ?? {})).not.toContain('is_default');
  });

  it('saving by name changes the home with that name ("I moved"); a new name adds one', async () => {
    const moved = fakeDb([HOME, MOMS]);
    const out = await saveHomeAt(moved.db, { label: 'home', address: '9 Pine Ave', lat: 30, lng: -80 });
    // The name stays as saved ("Home", not the card's "home").
    expect(moved.calls).toEqual([{ op: 'update', id: 'h1', arg: { label: 'Home', address: '9 Pine Ave', lat: 30, lng: -80 } }]);
    expect(out).toEqual({ home: expect.objectContaining({ id: 'h1', label: 'Home', address: '9 Pine Ave' }), replaced: true });

    const added = fakeDb([HOME]);
    await saveHomeAt(added.db, { label: 'Lake house', address: null, lat: 30, lng: -80 });
    expect(added.calls.map((c) => c.op)).toEqual(['insert']);
  });

  it('Save as default saves, then moves the ★; already the default: no second step', async () => {
    const other = fakeDb([HOME]);
    const out = await saveHomeAt(other.db, { label: 'Mom’s', address: '4 Elm Rd', lat: 28.7, lng: -81.3 }, { asDefault: true });
    expect(other.calls.map((c) => c.op)).toEqual(['insert', 'rpc:set_default_home']);
    expect(out).toEqual({ home: expect.objectContaining({ label: 'Mom’s', is_default: true }), replaced: false });

    const first = fakeDb([]);
    await saveHomeAt(first.db, { label: 'Home', address: '12 Oak St', lat: 1, lng: 2 }, { asDefault: true });
    expect(first.calls.map((c) => c.op)).toEqual(['insert']);
  });

  it('says the database\'s refusals plainly', async () => {
    expect(homeError({ code: 'P0001', message: 'You can save at most 10 homes. Delete one first.' })).toBe('You can save at most 10 homes. Delete one first.');
    expect(homeError({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'Mom’s')).toBe(
      'You already have a home called “Mom’s”. Pick another name.',
    );
    expect(homeError({ code: '42501', message: 'permission denied for table home_place' })).toBe('That wasn’t saved. Check your connection and try again.');
    const { db } = fakeDb([], { code: 'P0001', message: 'You can save at most 10 homes. Delete one first.' });
    expect(await addHome(db, { label: 'Eleventh', lat: 1, lng: 2 })).toEqual({ error: 'You can save at most 10 homes. Delete one first.' });
    expect(await deleteHome(db, 'h1')).toBe(false);
    expect(await makeDefault(db, 'h1')).toBe(false);
  });

  it('lists the homes as read, odd rows left out; a failure is a plain sentence', async () => {
    const { db } = fakeDb([HOME, { ...MOMS, lat: 'x' as unknown as number }, MOMS]);
    expect(await listHomes(db)).toEqual([HOME, MOMS]);
    await expect(listHomes(fakeDb([], { code: 'x', message: 'boom' }).db)).rejects.toThrow('Your homes cannot be read right now');
  });

  it('a row reads "🏠 Home ★ · 12 Oak St, Oviedo"', () => {
    expect(homeLine(HOME)).toBe('🏠 Home ★ · 12 Oak St, Oviedo');
    expect(homeLine({ ...MOMS, address: null })).toBe('🏠 Mom’s');
  });

  it('Use where I am keeps no address; a typed or saved place keeps its words', () => {
    expect(spotAddress({ lat: 1, lng: 2, label: 'Where I am', here: true })).toBeNull();
    expect(spotAddress({ lat: 1, lng: 2, label: '12 oak st', address: '12 Oak St, Oviedo, FL' })).toBe('12 Oak St, Oviedo, FL');
    expect(spotAddress({ lat: 1, lng: 2, label: 'Aquatic Center' })).toBe('Aquatic Center');
  });
});

describe('the chat\'s 🏠 card', () => {
  const card = { label: 'Home', address: '12 Oak St', makeDefault: true };

  it('reads the event, and drops a malformed one', () => {
    expect(toHomeCard({ type: 'home_save', label: ' Home ', address: '12 Oak St', make_default: true }, 'make_default')).toEqual(card);
    expect(toHomeCard({ label: 'Home', address: null }, 'make_default')).toEqual({ label: 'Home', address: null, makeDefault: false });
    expect(toHomeCard({ label: '', address: 'x' }, 'make_default')).toBeNull();
    expect(toHomeCard({ label: 'x'.repeat(61) }, 'make_default')).toBeNull();
    expect(toHomeCard({ label: 'Home', address: 7 }, 'make_default')).toBeNull();
  });

  it('the first home: Save only (it becomes the default)', () => {
    expect(homeCardButtons([], card)).toEqual({ buttons: ['save'], main: 'save' });
  });

  it('with a default already: Save and Save as default, the one Wilma was asked for filled', () => {
    expect(homeCardButtons([HOME], { label: 'Mom’s', address: '4 Elm Rd', makeDefault: false })).toEqual({ buttons: ['save', 'default'], main: 'save' });
    expect(homeCardButtons([HOME], { label: 'Lake', address: null, makeDefault: true })).toEqual({ buttons: ['save', 'default'], main: 'default' });
  });

  it('the default itself (I moved): Save only, and it says which home changes', () => {
    expect(homeCardButtons([HOME, MOMS], card)).toEqual({ buttons: ['save'], main: 'save', replaces: HOME });
    expect(homeCardButtons([HOME, MOMS], { label: 'moms', address: null, makeDefault: false })).toEqual({ buttons: ['save', 'default'], main: 'save' });
    expect(homeCardButtons([HOME, MOMS], { label: 'MOM’S', address: null, makeDefault: false })).toEqual({ buttons: ['save', 'default'], main: 'save', replaces: MOMS });
  });

  it('homes that cannot be read: both buttons', () => {
    expect(homeCardButtons(null, card).buttons).toEqual(['save', 'default']);
  });
});

describe('picking a place', () => {
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
