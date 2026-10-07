import { describe, expect, it } from '@jest/globals';

import { DEFAULT_UNIT, distanceText, loadDistanceUnit, saveDistanceUnit, type UnitsDb } from './units';

type Row = { data: unknown; error: unknown };

/** A stand-in for the Supabase client: records the calls, answers with `reply` (or throws). */
function fakeDb(reply: Row | Error) {
  const calls: unknown[][] = [];
  const answer = () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply));
  const db: UnitsDb = {
    from: (table) => {
      calls.push(['from', table]);
      return {
        select: (cols) => {
          calls.push(['select', cols]);
          return { eq: (c, v) => (calls.push(['eq', c, v]), { maybeSingle: answer }) };
        },
        update: (values) => {
          calls.push(['update', values]);
          return {
            eq: (c, v) => {
              calls.push(['eq', c, v]);
              return { select: (cols) => (calls.push(['select', cols]), { maybeSingle: answer }) };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

describe('distance unit setting', () => {
  it('reads the unit of the signed-in user only', async () => {
    const { db, calls } = fakeDb({ data: { distance_unit: 'km' }, error: null });
    expect(await loadDistanceUnit(db, 'u1')).toBe('km');
    expect(calls).toEqual([['from', 'app_user'], ['select', 'distance_unit'], ['eq', 'id', 'u1']]);
  });

  it('miles when nothing usable is stored; null when it cannot be read', async () => {
    expect(DEFAULT_UNIT).toBe('mi');
    expect(await loadDistanceUnit(fakeDb({ data: null, error: null }).db, 'u1')).toBe('mi');
    expect(await loadDistanceUnit(fakeDb({ data: { distance_unit: 'furlongs' }, error: null }).db, 'u1')).toBe('mi');
    expect(await loadDistanceUnit(fakeDb({ data: null, error: { message: 'offline' } }).db, 'u1')).toBeNull();
    expect(await loadDistanceUnit(fakeDb(new Error('network')).db, 'u1')).toBeNull();
  });

  it('saves only mi or km, for the signed-in user, and only counts a confirmed save', async () => {
    const ok = fakeDb({ data: { distance_unit: 'km' }, error: null });
    expect(await saveDistanceUnit(ok.db, 'u1', 'km')).toBe(true);
    expect(ok.calls).toEqual([['from', 'app_user'], ['update', { distance_unit: 'km' }], ['eq', 'id', 'u1'], ['select', 'distance_unit']]);

    expect(await saveDistanceUnit(fakeDb({ data: null, error: null }).db, 'u1', 'km')).toBe(false); // no row changed
    expect(await saveDistanceUnit(fakeDb({ data: null, error: { message: 'denied' } }).db, 'u1', 'km')).toBe(false);
    expect(await saveDistanceUnit(fakeDb(new Error('network')).db, 'u1', 'mi')).toBe(false);
    const bad = fakeDb({ data: { distance_unit: 'm' }, error: null });
    expect(await saveDistanceUnit(bad.db, 'u1', 'm' as 'mi')).toBe(false);
    expect(bad.calls).toEqual([]); // never sent
  });

  it('distances read as the cards will show them', () => {
    expect(distanceText(0.5, 'mi')).toBe('about 0.5 miles');
    expect(distanceText(1, 'mi')).toBe('about 1 mile');
    expect(distanceText(1.04, 'mi')).toBe('about 1 mile');
    expect(distanceText(12.4, 'mi')).toBe('about 12 miles');
    expect(distanceText(0.8, 'km')).toBe('about 0.8 km');
    expect(distanceText(0, 'mi')).toBe('less than 0.1 miles');
    expect(distanceText(0.02, 'km')).toBe('less than 0.1 km');
    expect(distanceText(NaN, 'mi')).toBe('');
    expect(distanceText(-1, 'km')).toBe('');
  });
});
