// Place cards and the "📍 Share where I am" card in the chat (places step 8 part 2, PR 4): reading
// the server's events, the thread, what is saved on the phone, and the tap that shares the location.
import { describe, expect, it, jest } from '@jest/globals';

import { LOCATION_DONE, shareFromCard } from './chatHere';
import { savedPlace, toEntry } from './chatStore';
import { readChatEvents, toChatEvent, type ChatEvent } from './chatStream';
import { chatReducer, initialChat, locationActive, messagesToSend, type ChatAction, type ChatState, type Entry } from './chatThread';
import { NO_PERMISSION, type LocationDeps } from './location';
import { placeCardDetail } from './places';

const TAWLET = {
  id: '00000000-0000-4000-8000-0000000000d1',
  title: 'Tawlet',
  kind: 'restaurant',
  cuisine: ['lebanese'],
  address: 'Armenia St, Beirut',
  maps_url: null,
  lat: 33.8959,
  lng: 35.5249,
  distance: { value: 0.5, unit: 'mi' },
};
const KAMPAI = { id: 'k1', title: 'Kampai sushi bar', kind: 'restaurant', cuisine: ['japanese', 'sushi'], address: 'Badaro, Beirut', maps_url: null, lat: null, lng: null };

const run = (state: ChatState, ...actions: ChatAction[]) => actions.reduce(chatReducer, state);
const ev = (event: ChatEvent): ChatAction => ({ type: 'event', event });
const DONE = ev({ type: 'done', counted: true });

describe('reading the events', () => {
  it('a places event: each card copied field by field, positions and distances only when valid', () => {
    const e = toChatEvent({ type: 'places', cards: [TAWLET, KAMPAI, { id: 'x' }, 'junk'] });
    expect(e).toEqual({
      type: 'places',
      cards: [
        {
          id: TAWLET.id, title: 'Tawlet', kind: 'restaurant', cuisine: ['lebanese'], address: 'Armenia St, Beirut',
          lat: 33.8959, lng: 35.5249, distance: { value: 0.5, unit: 'mi' },
        },
        { id: 'k1', title: 'Kampai sushi bar', kind: 'restaurant', cuisine: ['japanese', 'sushi'], address: 'Badaro, Beirut' },
      ],
    });
    const odd = toChatEvent({
      type: 'places',
      cards: [{ id: 'a', title: 'A', lat: 91, lng: 1, distance: { value: -1, unit: 'mi' }, cuisine: [1, 'thai'], evil: '<script>' }],
    });
    expect(odd).toEqual({ type: 'places', cards: [{ id: 'a', title: 'A', cuisine: ['thai'] }] });
    expect(toChatEvent({ type: 'places', cards: [] })).toBeNull();
    expect(toChatEvent({ type: 'places' })).toBeNull();
  });

  it('never more than 5 cards, and the 📍 request', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, title: `Place ${i}` }));
    const e = toChatEvent({ type: 'places', cards: many });
    expect(e?.type === 'places' && e.cards.length).toBe(5);
    expect(toChatEvent({ type: 'location_request', lat: 1 })).toEqual({ type: 'location_request' });
  });

  it('in a stream, before done, as the server sends them', async () => {
    const body = [
      { type: 'text', text: 'Tawlet is close.' },
      { type: 'places', cards: [TAWLET] },
      { type: 'done', counted: true },
    ].map((e) => JSON.stringify(e) + '\n').join('');
    const out: ChatEvent[] = [];
    for await (const e of readChatEvents((async function* () {
      yield new TextEncoder().encode(body);
    })())) out.push(e);
    expect(out.map((e) => e.type)).toEqual(['text', 'places', 'done']);
  });
});

describe('the thread', () => {
  const asked = () => run(initialChat(), { type: 'send', text: 'Restaurants near me?' });

  it('place cards join the answer; only text ever goes to the server', () => {
    const s = run(asked(), ev({ type: 'text', text: 'Tawlet is about 0.5 miles away.' }), ev(toChatEvent({ type: 'places', cards: [TAWLET] })!), DONE);
    expect(s.entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'places']);
    expect(messagesToSend(run(s, { type: 'send', text: 'Thanks' }).entries)).toEqual([
      { role: 'user', content: 'Restaurants near me?' },
      { role: 'assistant', content: 'Tawlet is about 0.5 miles away.' },
      { role: 'user', content: 'Thanks' },
    ]);
  });

  it('the 📍 card remembers the question it answers, once per answer', () => {
    const s = run(asked(), ev({ type: 'location_request' }), ev({ type: 'location_request' }), ev({ type: 'text', text: 'Where are you?' }), DONE);
    const cards = s.entries.filter((e) => e.kind === 'location');
    expect(cards).toEqual([{ kind: 'location', id: '1', question: 'Restaurants near me?', state: 'pending' }]);
    expect(locationActive(s, cards[0])).toBe(true);
    expect(messagesToSend(run(s, { type: 'send', text: 'Near Tawlet' }).entries).map((m) => m.content)).toEqual([
      'Restaurants near me?', 'Where are you?', 'Near Tawlet',
    ]);
  });

  it('tappable only while it waits and nothing is being written', () => {
    const streaming = run(asked(), ev({ type: 'location_request' }));
    const card = streaming.entries[1];
    expect(locationActive(streaming, card)).toBe(false);
    expect(run(streaming, { type: 'location_start', id: card.id })).toBe(streaming);
  });

  it('share: locating, then shared; a failure waits again with the reason; Not now', () => {
    const s = run(asked(), ev({ type: 'location_request' }), DONE);
    const id = s.entries[1].id;
    const locating = run(s, { type: 'location_start', id });
    expect(locating.entries[1]).toMatchObject({ state: 'locating' });
    expect(run(locating, { type: 'location_start', id })).toBe(locating); // a second tap does nothing
    expect(run(locating, { type: 'location_failed', id, error: NO_PERMISSION }).entries[1]).toMatchObject({ state: 'pending', error: NO_PERMISSION });
    expect(run(locating, { type: 'location_shared', id }).entries[1]).toMatchObject({ state: 'shared' });
    expect(run(s, { type: 'location_dismiss', id }).entries[1]).toMatchObject({ state: 'dismissed' });
    expect(run(s, { type: 'location_shared', id })).toBe(s); // never shared without a reading
  });

  it('a new message moves on: an unanswered 📍 card can no longer be tapped', () => {
    const s = run(asked(), ev({ type: 'location_request' }), DONE, { type: 'send', text: "I'm near Tawlet" });
    expect(s.entries[1]).toMatchObject({ kind: 'location', state: 'not_done' });
    const shared = run(asked(), ev({ type: 'location_request' }), DONE, { type: 'location_start', id: '1' }, { type: 'location_shared', id: '1' }, {
      type: 'send',
      text: 'Restaurants near me?',
    });
    expect(shared.entries[1]).toMatchObject({ state: 'shared' }); // stays as it was
  });
});

describe('saved on the phone', () => {
  it('place cards keep what they show and open, never a position or a distance', () => {
    const event = toChatEvent({ type: 'places', cards: [TAWLET] }) as Extract<ChatEvent, { type: 'places' }>;
    const live: Entry = { kind: 'places', id: '4', cards: event.cards };
    const saved = toEntry(JSON.parse(JSON.stringify(live)));
    expect(saved).toEqual({
      kind: 'places',
      id: '4',
      cards: [{ id: TAWLET.id, title: 'Tawlet', kind: 'restaurant', cuisine: ['lebanese'], address: 'Armenia St, Beirut' }],
    });
    expect(JSON.stringify(saved)).not.toMatch(/33\.89|35\.52|"distance"|"lat"|"lng"/);
    expect(savedPlace({ id: 'x' })).toBeNull();
  });

  it('a 📍 card: its question and state; closed while locating, it waits again', () => {
    expect(toEntry({ kind: 'location', id: '2', question: 'Near me?', state: 'locating', error: 'x' })).toEqual({
      kind: 'location', id: '2', question: 'Near me?', state: 'pending',
    });
    expect(toEntry({ kind: 'location', id: '2', question: 'Near me?', state: 'shared' })).toMatchObject({ state: 'shared' });
    expect(toEntry({ kind: 'location', id: '2', question: '', state: 'pending' })).toBeNull();
    expect(toEntry({ kind: 'location', id: '2', question: 'x', state: 'weird' })).toBeNull();
  });
});

function phone(o: { granted?: boolean; canAskAgain?: boolean } = {}) {
  return {
    permission: jest.fn(async () => ({ granted: o.granted ?? true, canAskAgain: o.canAskAgain ?? false })),
    askPermission: jest.fn(async () => ({ granted: false, canAskAgain: false })),
    servicesOn: jest.fn(async () => true),
    position: jest.fn(async () => ({ latitude: 33.8951234567, longitude: 35.5171234567, accuracy: 12 })),
  } satisfies LocationDeps;
}

/** A thread holding one waiting 📍 card, and the provider's current/act pair over it. */
function holder() {
  let state = run(initialChat(), { type: 'send', text: 'Sushi near me?' }, ev({ type: 'location_request' }), DONE);
  const act = (a: ChatAction) => (state = chatReducer(state, a));
  return { current: () => state, act, id: state.entries[1].id };
}

describe('the 📍 Share where I am tap', () => {
  it('one reading, then the question to send again with the point', async () => {
    const h = holder();
    const deps = phone();
    expect(await shareFromCard(h.current, h.act, h.id, deps)).toEqual({ question: 'Sushi near me?', here: { lat: 33.895123, lng: 35.517123 } });
    expect(deps.position).toHaveBeenCalledTimes(1);
    expect(h.current().entries[1]).toMatchObject({ state: 'shared' });
  });

  it('refused: the reason on the card, nothing to send', async () => {
    const h = holder();
    expect(await shareFromCard(h.current, h.act, h.id, phone({ granted: false }))).toBeNull();
    expect(h.current().entries[1]).toMatchObject({ state: 'pending', error: NO_PERMISSION });
  });

  it('nothing is read for a card that cannot be tapped, or once signed out', async () => {
    const h = holder();
    h.act({ type: 'location_dismiss', id: h.id });
    const deps = phone();
    expect(await shareFromCard(h.current, h.act, h.id, deps)).toBeNull();
    expect(deps.permission).not.toHaveBeenCalled();

    const g = holder();
    expect(await shareFromCard(g.current, g.act, g.id, phone(), () => false)).toBeNull();
  });

  it('a message sent while it was reading wins: the question is not sent again', async () => {
    const h = holder();
    const deps = phone();
    let release!: () => void;
    deps.position.mockImplementationOnce(
      () => new Promise((done) => (release = () => done({ latitude: 1, longitude: 2, accuracy: 5 }))),
    );
    const pending = shareFromCard(h.current, h.act, h.id, deps);
    await new Promise((r) => setTimeout(r, 0));
    h.act({ type: 'send', text: 'Never mind' });
    release();
    expect(await pending).toBeNull();
    expect(h.current().entries[1]).toMatchObject({ state: 'not_done' });
  });
});

describe('wording', () => {
  it('kind and cuisine; an unknown kind is left out', () => {
    expect(placeCardDetail({ kind: 'restaurant', cuisine: ['italian', 'pizza'] })).toBe('Restaurant · italian, pizza');
    expect(placeCardDetail({ kind: 'spaceship', cuisine: [] })).toBe('');
    expect(placeCardDetail({ cuisine: ['coffee'] })).toBe('coffee');
  });

  it('the answered card says what happened, never where', () => {
    for (const t of Object.values(LOCATION_DONE)) expect(t).not.toMatch(/\d/);
  });
});
