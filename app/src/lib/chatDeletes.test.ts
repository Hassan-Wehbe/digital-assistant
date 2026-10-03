// The safety-critical set for delete cards (docs/phase5-a5c-chat-screen-plan.md "Tests to write" 4):
// what a card can run, when, and with what. Uses the real reducer, runConfirm and chat store, with
// fake client methods that record every call.
import { describe, expect, it } from '@jest/globals';

import { CANT_DO, checkDelete, runDelete, type DeleteRunners } from './chatDeletes';
import { runConfirm } from './chatRun';
import { chatStore, INTERRUPTED } from './chatStore';
import type { ChatEvent } from './chatStream';
import { canSend, cardActive, chatReducer, initialChat, messagesToSend, type ChatAction, type ChatState, type Entry } from './chatThread';
import type { AuthStorage } from './sessionStorage';
import { WilmaError } from './wilma';

const ITEM = '3f2a1c9e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const OTHER = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

type Calls = [keyof DeleteRunners, string][];

/** Fake client methods: each records its call, and can be made to fail or wait. */
function fakeRunners(opts: { fail?: Error; gate?: Promise<void> } = {}) {
  const calls: Calls = [];
  const method = (name: keyof DeleteRunners) => async (id: string) => {
    calls.push([name, id]);
    if (opts.gate) await opts.gate;
    if (opts.fail) throw opts.fail;
    return {};
  };
  const runners: DeleteRunners = {
    deleteItem: method('deleteItem'),
    purgeItem: method('purgeItem'),
    deleteSpace: method('deleteSpace'),
    deleteAttachment: method('deleteAttachment'),
    removeSecret: method('removeSecret'),
  };
  return { calls, runners };
}

function card(tool: string, args: Record<string, unknown>, targetId = ITEM, title = 'Tomato soup'): ChatEvent {
  return {
    type: 'confirm',
    tool,
    args,
    target: { id: targetId, title },
    message: `Delete "${title}"?`,
    confirm_label: 'Delete',
    cancel_label: 'Cancel',
  };
}

/** A thread where Wilma answered "delete soup" with this card; the card is entry "1". */
function withCard(event: ChatEvent) {
  let state: ChatState = initialChat();
  const act = (a: ChatAction) => (state = chatReducer(state, a));
  for (const a of [
    { type: 'send', text: 'delete soup' },
    { type: 'event', event },
    { type: 'event', event: { type: 'text', text: 'Tap Delete to confirm.' } },
    { type: 'event', event: { type: 'done', counted: true } },
  ] as ChatAction[])
    act(a);
  return { act, state: () => state, cardEntry: () => state.entries.find((e) => e.id === '1') as Extract<Entry, { kind: 'confirm' }> };
}

const tap = (t: ReturnType<typeof withCard>, runners: DeleteRunners) => runConfirm(t.state, t.act, '1', runners);

const TABLE: [string, string, keyof DeleteRunners][] = [
  ['delete_item', 'item_id', 'deleteItem'],
  ['purge_item', 'item_id', 'purgeItem'],
  ['delete_space', 'space', 'deleteSpace'],
  ['delete_attachment', 'attachment_id', 'deleteAttachment'],
  ['delete_secret', 'secret_id', 'removeSecret'],
];

describe('delete cards: what runs', () => {
  it.each(TABLE)('%s runs only %s → %s, with exactly the card id, and only on Delete', async (tool, arg, method) => {
    const { calls, runners } = fakeRunners();
    const t = withCard(card(tool, { [arg]: ITEM }));
    expect(t.cardEntry().state).toBe('pending');
    expect(calls).toEqual([]); // the card arriving runs nothing
    expect(await tap(t, runners)).toBe('deleted');
    expect(calls).toEqual([[method, ITEM]]);
    expect(t.cardEntry().state).toBe('deleted');
  });

  it('Cancel runs nothing, and nothing can be run after it', async () => {
    const { calls, runners } = fakeRunners();
    const t = withCard(card('delete_item', { item_id: ITEM }));
    t.act({ type: 'confirm_cancel', id: '1' });
    expect(t.cardEntry().state).toBe('cancelled');
    expect(await tap(t, runners)).toBe('not_started');
    expect(calls).toEqual([]);
  });

  it.each(['save_item', 'update_item', 'restore_item', 'delete_everything', 'constructor', '__proto__', 'toString', ''])(
    'a card for %j runs nothing',
    async (tool) => {
      const { calls, runners } = fakeRunners();
      const t = withCard(card(tool, { item_id: ITEM }));
      expect(checkDelete(t.cardEntry())).toBeNull();
      expect(cardActive(t.state(), t.cardEntry())).toBe(false);
      expect(await tap(t, runners)).toBe('not_started');
      expect(calls).toEqual([]);
      expect(t.cardEntry().state).toBe('pending');
      await expect(runDelete(t.cardEntry(), runners)).rejects.toThrow(CANT_DO);
      expect(calls).toEqual([]);
    },
  );

  it.each<[string, string, Record<string, unknown>, string?]>([
    ['the wrong argument name', 'delete_item', { attachment_id: ITEM }],
    ['another tool’s argument name', 'delete_space', { item_id: ITEM }],
    ['a missing argument', 'delete_item', {}],
    ['an extra argument', 'delete_item', { item_id: ITEM, space: OTHER }],
    ['an id that is not a UUID', 'delete_item', { item_id: 'Tomato soup' }, 'Tomato soup'],
    ['a UUID with extra text', 'delete_item', { item_id: `${ITEM} ` }, `${ITEM} `],
    ['an id that is not a string', 'delete_secret', { secret_id: 42 }],
    ['an id other than the card’s target', 'delete_item', { item_id: OTHER }],
    ['a space name instead of its id', 'delete_space', { space: 'Recipes' }, 'Recipes'],
  ])('%s runs nothing', async (_why, tool, args, targetId = ITEM) => {
    const { calls, runners } = fakeRunners();
    const t = withCard(card(tool, args, targetId));
    expect(checkDelete(t.cardEntry())).toBeNull();
    expect(await tap(t, runners)).toBe('not_started');
    await expect(runDelete(t.cardEntry(), runners)).rejects.toThrow(CANT_DO);
    expect(calls).toEqual([]);
  });

  it('a double tap runs once', async () => {
    let open!: () => void;
    const { calls, runners } = fakeRunners({ gate: new Promise<void>((r) => (open = r)) });
    const t = withCard(card('delete_item', { item_id: ITEM }));
    const first = tap(t, runners);
    const second = tap(t, runners);
    expect(t.cardEntry().state).toBe('running');
    expect(canSend(t.state())).toBe(false); // nothing is sent while the delete runs
    open();
    expect(await second).toBe('not_started');
    expect(await first).toBe('deleted');
    expect(await tap(t, runners)).toBe('not_started'); // and a tap after it is done
    expect(calls).toEqual([['deleteItem', ITEM]]);
    expect(t.state().entries.filter((e) => e.kind === 'assistant' && e.text.startsWith('Deleted'))).toHaveLength(1);
  });

  it('nothing runs while an answer is still being written', async () => {
    const { calls, runners } = fakeRunners();
    let state: ChatState = initialChat();
    const act = (a: ChatAction) => (state = chatReducer(state, a));
    act({ type: 'send', text: 'delete soup' });
    act({ type: 'event', event: card('delete_item', { item_id: ITEM }) });
    expect(await runConfirm(() => state, act, '1', runners)).toBe('not_started');
    act({ type: 'confirm_cancel', id: '1' });
    expect(state.entries[1]).toMatchObject({ state: 'pending' });
    expect(calls).toEqual([]);
  });
});

describe('delete cards: the thread', () => {
  it('adds the short follow-up after a delete, which the next request carries', async () => {
    const t = withCard(card('delete_item', { item_id: ITEM }));
    await tap(t, fakeRunners().runners);
    expect(t.state().entries.at(-1)).toMatchObject({ kind: 'assistant', text: 'Deleted "Tomato soup".' });
    t.act({ type: 'send', text: 'thanks' });
    expect(messagesToSend(t.state().entries).slice(-2)).toEqual([
      { role: 'assistant', content: 'Deleted "Tomato soup".' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('adds the short follow-up after Cancel', () => {
    const t = withCard(card('delete_item', { item_id: ITEM }));
    t.act({ type: 'confirm_cancel', id: '1' });
    t.act({ type: 'confirm_cancel', id: '1' }); // a second tap adds nothing
    expect(t.state().entries.filter((e) => e.kind === 'assistant').map((e) => e.kind === 'assistant' && e.text)).toEqual([
      'Tap Delete to confirm.',
      'Okay, I left "Tomato soup" alone.',
    ]);
  });

  it('a failure shows the client’s message and keeps Delete and Cancel', async () => {
    const { calls, runners } = fakeRunners({ fail: new WilmaError('Only an empty space can be deleted.') });
    const t = withCard(card('delete_space', { space: ITEM }, ITEM, 'Recipes'));
    expect(await tap(t, runners)).toBe('failed');
    expect(t.cardEntry()).toMatchObject({ state: 'failed', error: 'Only an empty space can be deleted.' });
    expect(cardActive(t.state(), t.cardEntry())).toBe(true);
    expect(t.state().entries.at(-1)).toMatchObject({ text: 'Tap Delete to confirm.' }); // no follow-up
    // Tapped again: it runs again (once), and Cancel still works.
    expect(await tap(t, runners)).toBe('failed');
    expect(calls).toEqual([
      ['deleteSpace', ITEM],
      ['deleteSpace', ITEM],
    ]);
    t.act({ type: 'confirm_cancel', id: '1' });
    expect(t.cardEntry().state).toBe('cancelled');
    expect(t.cardEntry().error).toBeUndefined();
  });

  it('a delete that signs the user out says so', async () => {
    const t = withCard(card('delete_item', { item_id: ITEM }));
    const { runners } = fakeRunners({ fail: new WilmaError('Your session has ended. Please sign in again.', true) });
    expect(await tap(t, runners)).toBe('signed_out');
  });

  it('a result for an account that has since signed out is dropped', async () => {
    const t = withCard(card('delete_item', { item_id: ITEM }));
    let live = true;
    let open!: () => void;
    const { runners } = fakeRunners({ gate: new Promise<void>((r) => (open = r)) });
    const done = runConfirm(t.state, t.act, '1', runners, () => live);
    live = false;
    open();
    await done;
    expect(t.cardEntry().state).toBe('running');
    expect(t.state().entries.some((e) => e.kind === 'assistant' && e.text.startsWith('Deleted'))).toBe(false);
  });

  it('a new message makes a pending (or failed) card "not done", and runs nothing', async () => {
    const { calls, runners } = fakeRunners();
    const t = withCard(card('delete_item', { item_id: ITEM }));
    t.act({ type: 'send', text: 'never mind, what is for dinner?' });
    expect(t.cardEntry().state).toBe('not_done');
    t.act({ type: 'event', event: { type: 'done', counted: true } });
    expect(await tap(t, runners)).toBe('not_started');
    t.act({ type: 'confirm_cancel', id: '1' });
    expect(t.cardEntry().state).toBe('not_done');
    expect(calls).toEqual([]);

    const f = withCard(card('delete_item', { item_id: ITEM }));
    await tap(f, fakeRunners({ fail: new Error('No connection.') }).runners);
    f.act({ type: 'send', text: 'something else' });
    expect(f.cardEntry().state).toBe('not_done');
  });
});

describe('delete cards after a restart', () => {
  function memoryStorage(): AuthStorage {
    const map = new Map<string, string>();
    return {
      getItem: async (k) => map.get(k) ?? null,
      setItem: async (k, v) => void map.set(k, v),
      removeItem: async (k) => void map.delete(k),
    };
  }
  const USER = '11111111-1111-4111-8111-111111111111';

  it('shows a pending card still pending, and Delete still works', async () => {
    const store = chatStore(memoryStorage(), async () => []);
    const t = withCard(card('delete_item', { item_id: ITEM }));
    await store.save(USER, { entries: t.state().entries, noticeDismissed: null });

    // The app restarts: a new thread from what was saved.
    const saved = await store.load(USER);
    let state = chatReducer(initialChat(), { type: 'load', entries: saved.entries, noticeDismissed: null });
    const act = (a: ChatAction) => (state = chatReducer(state, a));
    expect(state.entries[1]).toMatchObject({ kind: 'confirm', state: 'pending', args: { item_id: ITEM } });
    expect(cardActive(state, state.entries[1])).toBe(true);

    const { calls, runners } = fakeRunners();
    expect(await runConfirm(() => state, act, '1', runners)).toBe('deleted');
    expect(calls).toEqual([['deleteItem', ITEM]]);
    // New entries keep counting after the loaded ones.
    expect(state.entries.at(-1)).toMatchObject({ id: '3', text: 'Deleted "Tomato soup".' });
  });

  it('a card saved while its delete ran comes back failed, with a note to check first', async () => {
    const store = chatStore(memoryStorage(), async () => []);
    let open!: () => void;
    const t = withCard(card('delete_item', { item_id: ITEM }));
    const running = tap(t, fakeRunners({ gate: new Promise<void>((r) => (open = r)) }).runners);
    await store.save(USER, { entries: t.state().entries, noticeDismissed: null });
    open();
    await running;

    const saved = await store.load(USER);
    expect(saved.entries[1]).toMatchObject({ kind: 'confirm', state: 'failed', error: INTERRUPTED });
  });
});
