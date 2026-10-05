import { describe, expect, it } from '@jest/globals';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { chatStore, EMPTY_CHAT, threadKey, threadsToKeep, toEntry, type SavedChat } from './chatStore';
import { MAX_ENTRIES, MAX_TEXT, PARTIAL_NOTE, type Entry } from './chatThread';
import { encryptedStorage, keyName, utf8Bytes, utf8Text, type Cipher, type KeyStore } from './sessionStorage';

// Node's AES-256-GCM, laid out like expo-crypto's "combined" form (as in sessionStorage.test.ts).
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

function memory(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
}

function setup() {
  const keys = memory();
  const data = memory();
  const store = chatStore(encryptedStorage(keys, data, nodeCipher), async () => [...data.map.keys()]);
  return { keys, data, store };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const thread: Entry[] = [
  { kind: 'user', id: '0', text: 'What is in my tomato soup recipe? Zoë 🍋' },
  { kind: 'assistant', id: '1', text: 'Tomatoes, basil and a secret pinch of sugar.' },
  {
    kind: 'confirm',
    id: '2',
    tool: 'delete_item',
    args: { item_id: 'i1' },
    target: { id: 'i1', title: 'Tomato soup' },
    message: 'Move "Tomato soup" to the recycle bin?',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    state: 'pending',
  },
  { kind: 'vault', id: '3', action: 'enter', secretId: 's1', name: 'Bank login', secretType: 'password' },
  { kind: 'error', id: '4', code: 'connection', message: "I'm having trouble connecting.", buttons: ['try_again'], note: PARTIAL_NOTE },
];
const chat: SavedChat = { entries: thread, noticeDismissed: '2026-10' };

describe('chat store', () => {
  it('reads back what it saved', async () => {
    const { store } = setup();
    await store.save(A, chat);
    expect(await store.load(A)).toEqual(chat);
  });

  it('opens an empty thread when nothing was saved', async () => {
    expect(await setup().store.load(A)).toEqual(EMPTY_CHAT);
  });

  it('keeps only ciphertext in the app data, and the key only in the secure keystore', async () => {
    const { store, keys, data } = setup();
    await store.save(A, chat);
    const stored = data.map.get(threadKey(A))!;
    for (const plain of ['tomato', 'Tomato soup', 'Bank login', 'sugar']) {
      expect(stored).not.toContain(plain);
      expect(Buffer.from(stored, 'base64').toString('latin1')).not.toContain(plain);
    }
    expect([...data.map.keys()]).toEqual([threadKey(A)]);
    expect([...keys.map.keys()]).toEqual([keyName(threadKey(A))]);
  });

  it("never reads one account's thread for another", async () => {
    const { store, data } = setup();
    await store.save(A, chat);
    expect(await store.load(B)).toEqual(EMPTY_CHAT);

    // A's sealed thread copied under B's name: B's own key cannot open it, so B sees nothing.
    await store.save(B, { entries: [{ kind: 'user', id: '0', text: 'mine' }], noticeDismissed: null });
    data.map.set(threadKey(B), data.map.get(threadKey(A))!);
    expect(await store.load(B)).toEqual(EMPTY_CHAT);
    expect(await store.load(A)).toEqual(chat);
  });

  it('refuses a thread that says it belongs to another account', async () => {
    const keys = memory();
    const data = memory();
    const storage = encryptedStorage(keys, data, nodeCipher);
    await storage.setItem(threadKey(B), JSON.stringify({ v: 1, user: A, entries: thread, noticeDismissed: null }));
    const store = chatStore(storage, async () => [...data.map.keys()]);
    expect(await store.load(B)).toEqual(EMPTY_CHAT);
  });

  it('clears one thread, and forgets every other account on sign-in or all on sign-out', async () => {
    const { store, keys, data } = setup();
    data.map.set('other.app.setting', 'kept');
    await store.save(A, chat);
    await store.save(B, chat);

    await store.forgetOthers(B);
    expect(await store.load(A)).toEqual(EMPTY_CHAT);
    expect(await store.load(B)).toEqual(chat);
    expect([...keys.map.keys()]).toEqual([keyName(threadKey(B))]);

    await store.forgetOthers(null);
    expect(await store.load(B)).toEqual(EMPTY_CHAT);
    expect(keys.map.size).toBe(0);
    expect([...data.map.keys()]).toEqual(['other.app.setting']);

    await store.save(A, chat);
    await store.clear(A);
    expect(await store.load(A)).toEqual(EMPTY_CHAT);
    expect(keys.map.size).toBe(0);
  });

  it('"New conversation" (an empty thread saved) keeps the banner choice', async () => {
    const { store } = setup();
    await store.save(A, chat);
    await store.save(A, { entries: [], noticeDismissed: chat.noticeDismissed });
    expect(await store.load(A)).toEqual({ entries: [], noticeDismissed: '2026-10' });
  });

  it('opens an empty thread, never crashes, when the data is changed, unreadable or not JSON', async () => {
    const { store, keys, data } = setup();
    await store.save(A, chat);
    const bytes = Buffer.from(data.map.get(threadKey(A))!, 'base64');
    bytes[20] ^= 1;
    data.map.set(threadKey(A), bytes.toString('base64'));
    expect(await store.load(A)).toEqual(EMPTY_CHAT);
    expect(keys.map.size + data.map.size).toBe(0);

    for (const text of ['not json', '[]', 'null', JSON.stringify({ user: A, entries: 'nope' })]) {
      const k = memory();
      const d = memory();
      const storage = encryptedStorage(k, d, nodeCipher);
      await storage.setItem(threadKey(A), text);
      expect(await chatStore(storage, async () => []).load(A)).toEqual(EMPTY_CHAT);
    }

    const broken = chatStore(
      { getItem: async () => Promise.reject(new Error('keystore locked')), setItem: async () => {}, removeItem: async () => {} },
      async () => Promise.reject(new Error('no list')),
    );
    expect(await broken.load(A)).toEqual(EMPTY_CHAT);
    await expect(broken.forgetOthers(null)).resolves.toBeUndefined();
  });

  it('drops malformed entries and fields it does not know, and never keeps a vault link', async () => {
    const keys = memory();
    const data = memory();
    const storage = encryptedStorage(keys, data, nodeCipher);
    const raw = [
      { kind: 'user', id: '0', text: 'hello', extra: 'x' },
      { kind: 'assistant', id: '1' },
      { kind: 'vault', id: '2', action: 'reveal', secretId: 's1', name: 'Bank', link: 'https://x/reveal#token' },
      { kind: 'confirm', id: '3', tool: 'delete_item', args: { item_id: 'i1', evil: { nested: 1 } }, target: { id: 'i1', title: 'T' }, message: 'm', confirmLabel: 'D', cancelLabel: 'C', state: 'pending' },
      { kind: 'confirm', id: '4', tool: 'delete_item', args: {}, target: { id: 'i1', title: 'T' }, message: 'm', confirmLabel: 'D', cancelLabel: 'C', state: 'done!' },
      { kind: 'error', id: '5', code: 'connection', message: 'm', buttons: ['search', 'delete'], note: 'anything' },
      { kind: 'status', id: '6', text: 'Saving…' },
      'junk',
    ];
    await storage.setItem(threadKey(A), JSON.stringify({ v: 1, user: A, entries: raw, noticeDismissed: 'soon' }));
    const loaded = await chatStore(storage, async () => []).load(A);
    expect(loaded).toEqual({
      entries: [
        { kind: 'user', id: '0', text: 'hello' },
        { kind: 'vault', id: '2', action: 'reveal', secretId: 's1', name: 'Bank' },
        { kind: 'confirm', id: '3', tool: 'delete_item', args: { item_id: 'i1' }, target: { id: 'i1', title: 'T' }, message: 'm', confirmLabel: 'D', cancelLabel: 'C', state: 'pending' },
        { kind: 'error', id: '5', code: 'connection', message: 'm', buttons: ['try_again'] },
      ],
      noticeDismissed: null,
    });
    expect(JSON.stringify(loaded)).not.toContain('token');
    // Saving goes through the same filter.
    const { store, data: d2 } = setup();
    await store.save(A, { entries: raw as Entry[], noticeDismissed: null });
    expect((await store.load(A)).entries).toHaveLength(4);
    expect(d2.map.size).toBe(1);
  });

  it('keeps the last 100 entries and cuts texts over 20,000 characters', async () => {
    const { store } = setup();
    const many: Entry[] = Array.from({ length: 130 }, (_, i) => ({ kind: 'user', id: String(i), text: `m${i}` }));
    many.push({ kind: 'assistant', id: '130', text: 'z'.repeat(MAX_TEXT + 500) });
    await store.save(A, { entries: many, noticeDismissed: null });
    const { entries } = await store.load(A);
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0]).toMatchObject({ id: '31', text: 'm31' });
    expect((entries[MAX_ENTRIES - 1] as { text: string }).text).toHaveLength(MAX_TEXT);
    expect(toEntry({ kind: 'user', id: '1', text: 'y'.repeat(MAX_TEXT * 2) })).toMatchObject({ text: 'y'.repeat(MAX_TEXT) });
  });

  it('forgets threads on sign-out and on another account, but not while the session is still being read', () => {
    // Launch: the app looks signed out until the saved session is read.
    expect(threadsToKeep(true, false, null)).toBeUndefined();
    // Signed out: forget all.
    expect(threadsToKeep(false, false, null)).toBeNull();
    // Signed in: keep only this account's.
    expect(threadsToKeep(false, true, A)).toBe(A);
    // Opened offline, still signed in but the session not yet back: keep everything.
    expect(threadsToKeep(false, true, null)).toBeUndefined();
  });
});

describe('saved notes cards (A5d step 6)', () => {
  it('keeps a notes card with only its known fields, and drops a malformed one', () => {
    expect(
      toEntry({ kind: 'notes', id: '4', query: 'lasagna', notes: [{ id: 'n1', title: 'Lasagna', space: 'Recipes', link: 'https://x', snippet: 5 }, { title: 'no id' }] }),
    ).toEqual({ kind: 'notes', id: '4', query: 'lasagna', notes: [{ id: 'n1', title: 'Lasagna', space: 'Recipes' }] });
    expect(toEntry({ kind: 'notes', id: '4', query: 'x', notes: [] })).toBeNull();
    expect(toEntry({ kind: 'notes', id: '4', notes: [{ id: 'n1', title: 'T' }] })).toBeNull();
  });
});
