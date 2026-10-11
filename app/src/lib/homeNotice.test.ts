// Noticing which home you are at (D36, docs/my-places-plan.md step 4): no reading with the switch
// off, nothing sent but the picked home's id, and the answer kept for that day only.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { toEntry } from './chatStore';
import { chatReducer, homeAskActive, initialChat, type ChatState } from './chatThread';
import { chooseHome, EMPTY_MEMORY, homeFor, parseMemory } from './dayChoices';
import type { HomeRow } from './homePlace';
import { allowForNotice, AT_HOME_METRES, homeAt, loadNotice, metresBetween, noticeHome, saveNotice, type NoticeDeps } from './homeNotice';

const HOME: HomeRow = { id: 'h1', label: 'Home', address: '12 Oak St', lat: 28.6, lng: -81.2, is_default: true };
const MOMS: HomeRow = { id: 'h2', label: 'Mom’s', address: '4 Elm Rd', lat: 28.7, lng: -81.3, is_default: false };
const TODAY = '2026-10-13';

/** About `m` metres north of a point. */
const north = (p: { lat: number; lng: number }, m: number) => ({ latitude: p.lat + m / 111_195, longitude: p.lng });

function deps(opts: { on?: boolean; homes?: HomeRow[]; granted?: boolean; services?: boolean; at?: { latitude: number; longitude: number } | 'slow' }) {
  const calls: string[] = [];
  const d: NoticeDeps & { location: { askPermission: () => Promise<never> } } = {
    on: async () => {
      calls.push('switch');
      return opts.on ?? true;
    },
    homes: async () => {
      calls.push('homes');
      return opts.homes ?? [HOME, MOMS];
    },
    location: {
      permission: async () => {
        calls.push('permission');
        return { granted: opts.granted ?? true, canAskAgain: true };
      },
      askPermission: async () => {
        calls.push('ask');
        throw new Error('never asked while planning');
      },
      servicesOn: async () => opts.services ?? true,
      position: () => {
        calls.push('reading');
        if (opts.at === 'slow') return new Promise(() => {});
        const at = opts.at ?? north(MOMS, 20);
        return Promise.resolve({ ...at, accuracy: 10 });
      },
    },
  };
  return { d, calls };
}

describe('the switch', () => {
  it('is off until turned on, per account, on this phone', async () => {
    const map = new Map<string, string>();
    const store = { get: async (k: string) => map.get(k) ?? null, set: async (k: string, v: string) => void map.set(k, v) };
    expect(await loadNotice(store, 'u1')).toBe(false);
    expect(await saveNotice(store, 'u1', true)).toBe(true);
    expect(await loadNotice(store, 'u1')).toBe(true);
    expect(await loadNotice(store, 'u2')).toBe(false);
  });

  it('turning it on asks for the location permission (only then)', async () => {
    const asked: string[] = [];
    const ask = (granted: boolean) => ({
      permission: async () => ({ granted: false, canAskAgain: true }),
      askPermission: async () => {
        asked.push('ask');
        return { granted, canAskAgain: false };
      },
    });
    expect(await allowForNotice(ask(true), 'no')).toBeNull();
    expect(await allowForNotice(ask(false), 'no')).toBe('no');
    expect(asked).toEqual(['ask', 'ask']);
  });
});

describe('one reading while planning', () => {
  it('no reading with the switch off', async () => {
    const { d, calls } = deps({ on: false });
    expect(await noticeHome(d)).toBeNull();
    expect(calls).toEqual(['switch']);
  });

  it('no reading with one home only', async () => {
    const { d, calls } = deps({ homes: [HOME] });
    expect(await noticeHome(d)).toBeNull();
    expect(calls).not.toContain('reading');
  });

  it('never asks for the permission while planning; without it, nothing is read', async () => {
    const { d, calls } = deps({ granted: false });
    expect(await noticeHome(d)).toBeNull();
    expect(calls).not.toContain('ask');
    expect(calls).not.toContain('reading');
    const off = deps({ services: false });
    expect(await noticeHome(off.d)).toBeNull();
    expect(off.calls).not.toContain('reading');
  });

  it('at a home that is not the default: which homes to offer, and nothing of the reading', async () => {
    const { d, calls } = deps({ at: north(MOMS, 40) });
    const n = await noticeHome(d);
    expect(n).toEqual({ at: MOMS, def: HOME });
    expect(calls.filter((c) => c === 'reading')).toHaveLength(1);
    // Only the saved homes' own points, never the phone's.
    expect(JSON.stringify(n)).not.toContain(String(north(MOMS, 40).latitude));
  });

  it('at the default home, or away from every home: nothing is asked (plan from the default)', async () => {
    expect(await noticeHome(deps({ at: north(HOME, 30) }).d)).toBeNull();
    expect(await noticeHome(deps({ at: north(MOMS, 400) }).d)).toBeNull();
  });

  it('a slow reading does not hold up planning', async () => {
    expect(await noticeHome(deps({ at: 'slow' }).d, 5)).toBeNull();
  });

  it('"at" means within 150 m, the nearest home first', () => {
    expect(Math.round(metresBetween(HOME, { lat: north(HOME, 100).latitude, lng: HOME.lng }))).toBe(100);
    const near = { ...MOMS, id: 'h3', label: 'Next door', lat: north(MOMS, 60).latitude };
    expect(homeAt({ lat: north(MOMS, 50).latitude, lng: MOMS.lng }, [HOME, MOMS, near])?.id).toBe('h3');
    expect(homeAt({ lat: north(MOMS, AT_HOME_METRES + 10).latitude, lng: MOMS.lng }, [MOMS])).toBeNull();
  });
});

describe('the answer, for that day only', () => {
  it('is kept for that day (the default too, so it is not asked again), and gone the next day', () => {
    const m = chooseHome(EMPTY_MEMORY, TODAY, '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d');
    expect(homeFor(m, TODAY)).toBe('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d');
    expect(homeFor(parseMemory(m, '2026-10-14'), TODAY)).toBeUndefined();
  });
});

describe('the chat\'s "You\'re at Mom\'s" card', () => {
  const ask = { type: 'home_ask' as const, date: TODAY, at: { id: 'h2', label: 'Mom’s' }, def: { id: 'h1', label: 'Home' } };
  const asked = (): ChatState => {
    let s = chatReducer(initialChat(), { type: 'send', text: 'plan my day' });
    s = chatReducer(s, { type: 'event', event: { type: 'agenda_request', from: TODAY, to: TODAY } });
    s = chatReducer(s, { type: 'event', event: { type: 'done', counted: true } });
    return chatReducer(s, ask);
  };

  it('waits for a tap; answered once; a new message leaves it not done', () => {
    let s = asked();
    const card = s.entries[s.entries.length - 1];
    expect(card).toMatchObject({ kind: 'home_ask', state: 'pending', at: { label: 'Mom’s' } });
    expect(homeAskActive(s, card, TODAY)).toBe(true);
    expect(homeAskActive(s, card, '2026-10-14')).toBe(false);
    s = chatReducer(s, { type: 'home_ask_answer', id: card.id, chosen: 'at' });
    expect(s.entries.find((e) => e.id === card.id)).toMatchObject({ state: 'answered', chosen: 'at' });
    expect(chatReducer(s, { type: 'home_ask_answer', id: card.id, chosen: 'def' })).toBe(s);

    let t = asked();
    t = chatReducer(t, { type: 'send', text: 'never mind' });
    expect(t.entries.find((e) => e.kind === 'home_ask')).toMatchObject({ state: 'not_done' });
  });

  it('a saved chat keeps only the homes\' ids and names', () => {
    expect(toEntry({ kind: 'home_ask', id: '3', date: TODAY, at: { id: 'h2', label: 'Mom’s', lat: 1 }, def: { id: 'h1', label: 'Home' }, state: 'answered', chosen: 'at', here: { lat: 1, lng: 2 } })).toEqual({
      kind: 'home_ask', id: '3', date: TODAY, at: { id: 'h2', label: 'Mom’s' }, def: { id: 'h1', label: 'Home' }, state: 'answered', chosen: 'at',
    });
    expect(toEntry({ kind: 'home_ask', id: '3', date: TODAY, at: { id: 'h2' }, def: { id: 'h1', label: 'Home' }, state: 'pending' })).toBeNull();
  });

  it('the provider passes on ids and names only, and sends the question again with the picked home\'s id', () => {
    const src = readFileSync(resolve(__dirname, 'chat.tsx'), 'utf8');
    expect(src).toContain("act({ type: 'home_ask', date: today, at: { id: n.at.id, label: n.at.label }, def: { id: n.def.id, label: n.def.label } });");
    expect(src).toContain('await followRef.current({ from: card.date, to: card.date, start_from: { home: home.id } }, undefined, forUser, false, question);');
    // Asked only for today's plan, with no home named and none picked yet.
    expect(src).toContain("if (!agenda && !ask.start_from && ask.from === ask.to && ask.from === today) {");
  });
});

describe('My day', () => {
  const src = readFileSync(resolve(__dirname, '../app/day.tsx'), 'utf8');

  it('asks only for today, once, when nothing was picked for today', () => {
    expect(src).toContain('if (!plan || date !== days.today || homeFor(mem.current, date) || noticedFor.current === date || !userId) return;');
    expect(src).toContain('noticeHome({ on: () => loadNotice(deviceSettingsStore, userId), homes: () => listHomes(homesDb), location: deviceLocation })');
  });
});
