// My day's home (D36, docs/my-places-plan.md step 3): "Where do you leave from?" saves to
// home_place, and "🏠 Planned from Home · Change" picks a home for that day only (Q5), kept with
// the day's other choices on the phone and sent as `start_from`.
import { describe, expect, it } from '@jest/globals';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { dayBody } from './dayAgenda';
import { chooseHome, dayMemoryStore, EMPTY_MEMORY, homeFor, parseMemory, resetChoices, takeBoth, toggleDropOff } from './dayChoices';
import { encryptedStorage, utf8Bytes, utf8Text, type Cipher, type KeyStore } from './sessionStorage';

const MOMS = '2b7c1f0e-4d1a-4c55-9a7e-3f1d2c3b4a59';
const TODAY = '2026-10-13';
const TOMORROW = '2026-10-14';

const nodeCipher: Cipher = {
  newKey: async () => randomBytes(32).toString('base64'),
  async encrypt(key, text) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
    const body = Buffer.concat([c.update(Buffer.from(utf8Bytes(text))), c.final()]);
    return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
  },
  async decrypt(key, sealed) {
    const all = Buffer.from(sealed, 'base64');
    const d = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), all.subarray(0, 12));
    d.setAuthTag(all.subarray(all.length - 16));
    return utf8Text(Buffer.concat([d.update(all.subarray(12, all.length - 16)), d.final()]));
  },
};

function kv(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v), remove: async (k) => void map.delete(k) };
}

describe('Change: a home for that day only', () => {
  it('is kept for that day, and the other day is unchanged', () => {
    const m = chooseHome(EMPTY_MEMORY, TODAY, MOMS);
    expect(homeFor(m, TODAY)).toBe(MOMS);
    expect(homeFor(m, TOMORROW)).toBeUndefined();
  });

  it('is gone once the day has passed', () => {
    const m = chooseHome(EMPTY_MEMORY, TODAY, MOMS);
    expect(homeFor(parseMemory(m, TODAY), TODAY)).toBe(MOMS);
    expect(homeFor(parseMemory(m, TOMORROW), TODAY)).toBeUndefined();
  });

  it('picking the default again keeps no choice; other choices of the day stay', () => {
    let m = takeBoth(EMPTY_MEMORY, TODAY, ['a', 'b']);
    m = chooseHome(m, TODAY, MOMS);
    m = chooseHome(m, TODAY, null);
    expect(homeFor(m, TODAY)).toBeUndefined();
    expect(m.choices).toEqual([{ date: TODAY, together: [['a', 'b']], not_driving: [] }]);
    expect(chooseHome(chooseHome(EMPTY_MEMORY, TODAY, MOMS), TODAY, null)).toEqual(EMPTY_MEMORY);
  });

  it('only a home id is kept; anything else is ignored', () => {
    expect(chooseHome(EMPTY_MEMORY, TODAY, 'Mom’s')).toBe(EMPTY_MEMORY);
    expect(homeFor(parseMemory({ choices: [{ date: TODAY, together: [], not_driving: [], home: '12 Oak St' }] }, TODAY), TODAY)).toBeUndefined();
  });

  it('Start over drops it with the day\'s other choices', () => {
    expect(homeFor(resetChoices(chooseHome(EMPTY_MEMORY, TODAY, MOMS), TODAY), TODAY)).toBeUndefined();
  });

  it('is sent as start_from in that day\'s plan request, and only that day\'s', () => {
    const m = chooseHome(EMPTY_MEMORY, TODAY, MOMS);
    expect(dayBody(TODAY, 'UTC', undefined, [], m)).toEqual({ mode: 'day', date: TODAY, tz: 'UTC', events: [], start_from: { home: MOMS } });
    expect(dayBody(TOMORROW, 'UTC', undefined, [], m)).not.toHaveProperty('start_from');
  });

  it('is kept on the phone (encrypted, per account), with 🚸 drop off too', async () => {
    const data = kv();
    const store = dayMemoryStore(encryptedStorage(kv(), data, nodeCipher), async () => [...data.map.keys()]);
    const m = toggleDropOff(chooseHome(EMPTY_MEMORY, TODAY, MOMS), 'Lexi school');
    await store.save('u1', m);
    const back = await store.load('u1', TODAY);
    expect(homeFor(back, TODAY)).toBe(MOMS);
    // Before homes, the drop-off titles were left out of what was written, so they were lost.
    expect(back.drop_off).toEqual(['lexi school']);
    expect([...data.map.values()].join('')).not.toContain(MOMS);
  });
});

describe('the My day screen', () => {
  const src = readFileSync(resolve(__dirname, '../app/day.tsx'), 'utf8');

  it('"Where do you leave from?" saves Home in home_place, no longer a note', () => {
    expect(src).toContain('saveHomeAt(homesDb, { label: HOME_TITLE, address: spotAddress(spot), lat: spot.lat, lng: spot.lng }, { asDefault: true })');
    expect(src).not.toMatch(/saveItem:|createSpace:|item_type: 'place'/);
  });

  it('shows "🏠 Planned from … · Change", lists the homes for this day, and Manage homes', () => {
    expect(src).toContain('title={`🏠 Planned from ${plan.home.label ?? HOME_TITLE} · Change`}');
    expect(src).toContain('change(chooseHome(memory, date, h.id));');
    expect(src).toContain("router.push('/homes');");
    expect(src).toContain('For this day only.');
  });
});
