// The chat's side of homes (D36, docs/my-places-plan.md step 3): the 🏠 card from the stream and
// from a saved chat, nothing saved without the tap, "home" in `can` on Android, and the saved home
// to plan from sent back with the calendar (`start_from`).
import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { Agenda } from './calendar';
import { chatBody } from './chatClient';
import { runTurn } from './chatRun';
import { toEntry } from './chatStore';
import { readChatEvents, toChatEvent, type ChatEvent } from './chatStream';
import { chatReducer, initialChat, type ChatState, type Entry } from './chatThread';
import { chatStartFrom } from './dayAgenda';
import { chooseHome, EMPTY_MEMORY } from './dayChoices';

const MOMS = '2b7c1f0e-4d1a-4c55-9a7e-3f1d2c3b4a59';
const EVENT = { type: 'home_save', label: 'Home', address: '12 Oak St, Oviedo', make_default: true };
const AGENDA: Agenda = { from: '2026-10-13', to: '2026-10-13', time_zone: 'America/New_York', events: [] } as unknown as Agenda;

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

function chunks(lines: unknown[]): AsyncIterable<Uint8Array> {
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return (async function* () {
    yield new TextEncoder().encode(text);
  })();
}

/** One answer through the reducer, as the provider plays it. */
function answer(events: ChatEvent[]): ChatState {
  let s = chatReducer(initialChat(), { type: 'send', text: 'my home is 12 Oak St, Oviedo' });
  for (const event of events) s = chatReducer(s, { type: 'event', event });
  return s;
}

describe('the 🏠 card from the stream', () => {
  it('is read from the server\'s home_save event', async () => {
    const got: ChatEvent[] = [];
    for await (const e of readChatEvents(chunks([{ type: 'text', text: 'Here it is.' }, EVENT, { type: 'done', counted: true }]))) got.push(e);
    expect(got[1]).toEqual({ type: 'home_save', label: 'Home', address: '12 Oak St, Oviedo', makeDefault: true });
    expect(toChatEvent({ type: 'home_save', label: '', address: 'x' })).toBeNull();
  });

  it('becomes a card in the thread, and nothing else happens (nothing saved without the tap)', () => {
    const s = answer([{ type: 'text', text: 'Tap Save to keep it.' }, toChatEvent(EVENT)!, { type: 'done', counted: true }]);
    expect(s.entries.find((e) => e.kind === 'home')).toEqual({ kind: 'home', id: expect.any(String), label: 'Home', address: '12 Oak St, Oviedo', makeDefault: true });
    // The thread's code never writes a home: only the card's own Save does.
    for (const file of ['chatThread.ts', 'chatStream.ts', 'chatStore.ts', 'chat.tsx']) {
      expect(read(file)).not.toMatch(/saveHomeAt|addHome|changeHome|makeDefault\(|home_place/);
    }
  });

  it('the card saves only from its Save buttons', () => {
    const card = read('../components/HomeCard.tsx');
    // saveHomeAt appears in its import and in the one save handler, nowhere else.
    expect(card.match(/saveHomeAt/g)).toHaveLength(2);
    expect(card).toMatch(/const save = async \(asDefault: boolean\) => \{\n\s+if \(!spot \|\| busy\) return;/);
    expect(card.match(/void save\(/g)).toHaveLength(2);
    expect(card).toMatch(/title="Save as default"[^\n]*onPress=\{\(\) => void save\(true\)\}/);
    expect(card).toMatch(/onPress=\{\(\) => void save\(false\)\}/);
    // The location is read only on the tap; the map lookup asks for the permission only on a tap.
    expect(card.match(/whereAmI\(/g)).toHaveLength(1);
    expect(card).toContain("lookUpPlace(deviceGeocoder, entry.address, false)");
  });

  it('is marked saved once the tap saved it', () => {
    let s = answer([toChatEvent(EVENT)!, { type: 'done', counted: true }]);
    const id = s.entries.find((e) => e.kind === 'home')!.id;
    s = chatReducer(s, { type: 'home_saved', id, saved: 'default' });
    expect(s.entries.find((e) => e.id === id)).toMatchObject({ kind: 'home', saved: 'default' });
    // Not a home card: nothing changes.
    expect(chatReducer(s, { type: 'home_saved', id: s.entries[0].id, saved: 'home' })).toBe(s);
  });
});

describe('the 🏠 card from a saved chat', () => {
  it('comes back with its words and whether it was saved, and nothing more', () => {
    const saved = { kind: 'home', id: '4', label: 'Mom’s', address: '4 Elm Rd', makeDefault: false, saved: 'home', lat: 28.6, lng: -81.2 };
    expect(toEntry(saved)).toEqual({ kind: 'home', id: '4', label: 'Mom’s', address: '4 Elm Rd', makeDefault: false, saved: 'home' });
    expect(toEntry({ kind: 'home', id: '5', label: 'Home', address: null, makeDefault: true })).toEqual({
      kind: 'home', id: '5', label: 'Home', address: null, makeDefault: true,
    });
    expect(toEntry({ kind: 'home', id: '6', label: 'Home', saved: 'yes' })).toEqual({ kind: 'home', id: '6', label: 'Home', address: null, makeDefault: false });
    expect(toEntry({ kind: 'home', id: '7', label: '' })).toBeNull();
  });

  it('a card saved before the chat was closed still says so', () => {
    const entry = toEntry({ kind: 'home', id: '4', label: 'Home', address: '12 Oak St', makeDefault: true, saved: 'default' }) as Extract<Entry, { kind: 'home' }>;
    const card = read('../components/HomeCard.tsx');
    expect(entry.saved).toBe('default');
    expect(card).toContain('if (entry.saved) return <ChatCardDone icon="🏠" text={homeSavedText(entry, entry.saved)} />;');
  });
});

describe('"home" in can', () => {
  it('is sent by the Android app only', () => {
    const canOn = (os: string) => {
      let can: string[] = [];
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const rn = require('react-native') as typeof import('react-native');
        Object.defineProperty(rn.Platform, 'OS', { value: os, configurable: true });
        can = (require('./chatClient') as typeof import('./chatClient')).CAN;
        /* eslint-enable @typescript-eslint/no-require-imports */
      });
      return can;
    };
    expect(canOn('android')).toEqual(['calendar', 'home']);
    expect(canOn('ios')).toEqual(['calendar']);
    expect(canOn('web')).toEqual(['calendar']);
  });
});

describe('start_from sent back with the calendar', () => {
  it('the agenda_request\'s home is read; anything else in it is dropped', () => {
    expect(toChatEvent({ type: 'agenda_request', from: '2026-10-13', to: '2026-10-13', start_from: { home: MOMS } })).toEqual({
      type: 'agenda_request', from: '2026-10-13', to: '2026-10-13', start_from: { home: MOMS },
    });
    expect(toChatEvent({ type: 'agenda_request', from: '2026-10-13', to: '2026-10-13', start_from: { home: 'moms' } })).toEqual({
      type: 'agenda_request', from: '2026-10-13', to: '2026-10-13',
    });
  });

  it('goes in the body with the calendar, never without it', () => {
    const entries = chatReducer(initialChat(), { type: 'send', text: 'plan my day from Mom’s' }).entries;
    expect(JSON.parse(chatBody(entries, undefined, AGENDA, 'UTC', MOMS))).toMatchObject({ agenda: AGENDA, start_from: { home: MOMS } });
    expect(JSON.parse(chatBody(entries, undefined, undefined, 'UTC', MOMS))).not.toHaveProperty('start_from');
    expect(JSON.parse(chatBody(entries, undefined, AGENDA, 'UTC'))).not.toHaveProperty('start_from');
  });

  it('runTurn hands it to the client', async () => {
    const seen: unknown[] = [];
    async function* send(...args: unknown[]): AsyncGenerator<ChatEvent> {
      seen.push(args[4]);
      yield { type: 'done', counted: true };
    }
    await runTurn(send, initialChat().entries, new AbortController().signal, () => {}, undefined, AGENDA, MOMS);
    expect(seen).toEqual([MOMS]);
  });

  it('the request\'s home wins; else the home picked for that day in My day; never for several days', async () => {
    const memory = chooseHome(EMPTY_MEMORY, '2026-10-13', MOMS);
    const other = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
    const load = async () => memory;
    expect(await chatStartFrom({ from: '2026-10-13', to: '2026-10-13', start_from: { home: other } }, load)).toBe(other);
    expect(await chatStartFrom({ from: '2026-10-13', to: '2026-10-13' }, load)).toBe(MOMS);
    expect(await chatStartFrom({ from: '2026-10-14', to: '2026-10-14' }, load)).toBeUndefined();
    expect(await chatStartFrom({ from: '2026-10-13', to: '2026-10-15' }, load)).toBeUndefined();
    expect(await chatStartFrom({ from: '2026-10-13', to: '2026-10-13' }, async () => Promise.reject(new Error('x')))).toBeUndefined();
  });

  it('the provider sends it back with the re-sent question', () => {
    const src = read('chat.tsx');
    expect(src).toContain("asked = { from: a.event.from, to: a.event.to, ...(a.event.start_from ? { start_from: a.event.start_from } : {}) };");
    expect(src).toContain('startRef.current(next.entries, here, out.agenda, from);');
  });
});
