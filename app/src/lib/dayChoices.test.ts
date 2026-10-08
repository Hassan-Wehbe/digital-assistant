// What My day keeps on the phone (Q7): today's choices per day, event-place answers per title, the
// geocoder's results. Encrypted per account; never a plan (Mapbox's terms).
import { describe, expect, it } from '@jest/globals';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import {
  answerPlace, choicesFor, dayMemoryStore, EMPTY_MEMORY, forgetPlace, MAX_REMEMBERED, memoryKey, parseMemory, rememberFound, resetChoices,
  separate, takeBoth, toggleNotDriving, type DayMemory,
} from './dayChoices';
import { encryptedStorage, utf8Bytes, utf8Text, type Cipher, type KeyStore } from './sessionStorage';

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

function setup() {
  const keys = kv();
  const data = kv();
  const storage = encryptedStorage(keys, data, nodeCipher);
  return { data, storage, store: dayMemoryStore(storage, async () => [...data.map.keys()]) };
}

const TODAY = '2026-10-09';

describe('choices for the day', () => {
  it('Take both makes one trip, joins trips that share an event, and can be undone', () => {
    let m = takeBoth(EMPTY_MEMORY, TODAY, ['a', 'b']);
    expect(choicesFor(m, TODAY)).toEqual({ together: [['a', 'b']] });
    m = takeBoth(m, TODAY, ['b', 'c']);
    expect(choicesFor(m, TODAY).together?.map((g) => [...g].sort())).toEqual([['a', 'b', 'c']]);
    m = separate(m, TODAY, 'c');
    expect(choicesFor(m, TODAY)).toEqual({});
    expect(m.choices).toEqual([]);
  });

  it('keeps at most 20 trips, as the server takes', () => {
    let m = EMPTY_MEMORY;
    for (let i = 0; i < 25; i++) m = takeBoth(m, TODAY, [`a${i}`, `b${i}`]);
    expect(choicesFor(m, TODAY).together).toHaveLength(20);
    expect(choicesFor(m, TODAY).together?.[19]).toEqual(['a24', 'b24']);
  });

  it('Not driving turns on and off, per day', () => {
    let m = toggleNotDriving(EMPTY_MEMORY, TODAY, 'swim');
    m = toggleNotDriving(m, '2026-10-10', 'school');
    expect(choicesFor(m, TODAY)).toEqual({ not_driving: ['swim'] });
    expect(choicesFor(m, '2026-10-10')).toEqual({ not_driving: ['school'] });
    m = toggleNotDriving(m, TODAY, 'swim');
    expect(choicesFor(m, TODAY)).toEqual({});
  });

  it('Start over drops only that day', () => {
    let m = takeBoth(EMPTY_MEMORY, TODAY, ['a', 'b']);
    m = toggleNotDriving(m, '2026-10-10', 'x');
    m = resetChoices(m, TODAY);
    expect(choicesFor(m, TODAY)).toEqual({});
    expect(choicesFor(m, '2026-10-10')).toEqual({ not_driving: ['x'] });
  });

  it('a day’s choices are dropped once it has passed', () => {
    const m = toggleNotDriving(toggleNotDriving(EMPTY_MEMORY, '2026-10-08', 'old'), TODAY, 'new');
    const next = parseMemory(JSON.parse(JSON.stringify(m)), TODAY);
    expect(next.choices.map((c) => c.date)).toEqual([TODAY]);
    expect(parseMemory(JSON.parse(JSON.stringify(m)), '2026-10-10').choices).toEqual([]);
  });
});

describe('event places', () => {
  it('an answer is remembered per title, whatever its case and spaces', () => {
    const m = answerPlace(EMPTY_MEMORY, 'Dentist', { lat: 28.6, lng: -81.2, label: 'Dr. Lee' });
    expect(m.places['dentist']).toEqual({ lat: 28.6, lng: -81.2, label: 'Dr. Lee' });
    expect(answerPlace(m, '  DENTIST ', { not_a_trip: true }).places).toEqual({ dentist: { not_a_trip: true } });
    expect(forgetPlace(m, 'dentist').places).toEqual({});
  });

  it('refuses an answer off the map', () => {
    expect(answerPlace(EMPTY_MEMORY, 'X', { lat: 200, lng: 0, label: 'X' })).toBe(EMPTY_MEMORY);
  });

  it('keeps at most the newest 200 answers and looked-up texts', () => {
    let m: DayMemory = EMPTY_MEMORY;
    for (let i = 0; i < MAX_REMEMBERED + 5; i++) m = answerPlace(m, `event ${i}`, { not_a_trip: true });
    expect(Object.keys(m.places)).toHaveLength(MAX_REMEMBERED);
    expect(m.places['event 0']).toBeUndefined();
    m = rememberFound(m, { 'aquatic center': { lat: 1, lng: 2 }, nowhere: { none: true } });
    expect(m.found).toEqual({ 'aquatic center': { lat: 1, lng: 2 }, nowhere: { none: true } });
  });
});

describe('on the phone', () => {
  it('is encrypted per account, and read back only for that account', async () => {
    const { data, store } = setup();
    const m = answerPlace(takeBoth(EMPTY_MEMORY, TODAY, ['a', 'b']), 'Dentist', { lat: 1, lng: 2, label: 'Dr. Lee' });
    await store.save('u1', m);
    expect(data.map.get(memoryKey('u1'))).not.toContain('Dentist');
    expect(await store.load('u1', TODAY)).toEqual(m);
    expect(await store.load('u2', TODAY)).toEqual(EMPTY_MEMORY);
  });

  it('never writes anything but the choices, answers and looked-up points (no plan, no drive times)', async () => {
    const { storage, store } = setup();
    const withPlan = { ...EMPTY_MEMORY, plan: { rows: [{ kind: 'drive', minutes: 15 }] }, leave_at: '16:10' } as unknown as DayMemory;
    await store.save('u1', withPlan);
    const written = JSON.parse((await storage.getItem(memoryKey('u1')))!);
    expect(Object.keys(written).sort()).toEqual(['choices', 'found', 'places', 'user', 'v']);
    expect(JSON.stringify(written)).not.toMatch(/minutes|leave_at|plan/);
  });

  it('forgets other accounts (and everything when signed out)', async () => {
    const { data, store } = setup();
    await store.save('u1', EMPTY_MEMORY);
    await store.save('u2', EMPTY_MEMORY);
    await store.forgetOthers('u1');
    expect([...data.map.keys()].filter((k) => k.startsWith('wilma.day.'))).toEqual([memoryKey('u1')]);
    await store.forgetOthers(null);
    expect([...data.map.keys()].filter((k) => k.startsWith('wilma.day.'))).toEqual([]);
  });

  it('an unreadable memory opens empty', async () => {
    const { data, store } = setup();
    data.map.set(memoryKey('u1'), 'not encrypted');
    expect(await store.load('u1', TODAY)).toEqual(EMPTY_MEMORY);
  });
});
