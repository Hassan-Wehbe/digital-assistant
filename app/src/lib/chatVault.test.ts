// Vault cards (docs/phase5-a5c-chat-screen-plan.md "Tests to write" 5): the server's one-time link
// never gets past the stream reader, the card keeps only ids and names, and each card opens the
// right vault screen. The first test plays real server lines through the whole path: stream →
// thread → saved thread → what is sent to the server next.
import { describe, expect, it } from '@jest/globals';

import { chatStore } from './chatStore';
import { readChatEvents } from './chatStream';
import { chatReducer, initialChat, messagesToSend, type ChatState, type Entry } from './chatThread';
import { vaultCardText, vaultRoute } from './chatVault';
import type { AuthStorage } from './sessionStorage';

const BANK = '3f2a1c9e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const ALARM = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const TOKEN = 'one-time-token-Zq81x';
const USER = '11111111-1111-4111-8111-111111111111';

const line = (e: object) => JSON.stringify(e) + '\n';
async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield new TextEncoder().encode(p);
}

// What the deployed `chat` sends (supabase/functions/chat/chat.ts vaultEvents).
const SERVER_LINES = [
  line({ type: 'status', tool: 'get_secret', text: 'Looking in your vault…' }),
  line({
    type: 'vault',
    action: 'reveal',
    secret_id: BANK,
    name: 'Bank login',
    secret_type: 'login',
    new_secret: false,
    link: `https://example.supabase.co/functions/v1/mcp/vault/reveal#t=${TOKEN}`,
    expires_at: '2026-10-03T12:10:00Z',
  }),
  line({
    type: 'vault',
    action: 'enter',
    secret_id: ALARM,
    name: 'Alarm code',
    secret_type: 'note',
    new_secret: true,
    link: `https://example.supabase.co/functions/v1/mcp/vault/enter#t=${TOKEN}`,
    expires_at: '2026-10-03T12:10:00Z',
  }),
  line({ type: 'text', text: 'Tap the cards to open them in your vault.' }),
  line({ type: 'done', counted: false }),
];

function memoryStorage(): AuthStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

type VaultEntry = Extract<Entry, { kind: 'vault' }>;
const card = (over: Partial<VaultEntry>): VaultEntry => ({
  kind: 'vault',
  id: '1',
  action: 'reveal',
  secretId: BANK,
  name: 'Bank login',
  secretType: 'login',
  ...over,
});

describe('vault cards: the link never gets in', () => {
  it('is dropped by the stream, so it is not in the thread, the saved thread, or what is sent', async () => {
    let state: ChatState = chatReducer(initialChat(), { type: 'send', text: 'show my bank password and save the alarm code' });
    for await (const event of readChatEvents(chunks(...SERVER_LINES))) {
      expect(JSON.stringify(event)).not.toContain(TOKEN);
      state = chatReducer(state, { type: 'event', event });
    }

    const cards = state.entries.filter((e) => e.kind === 'vault');
    expect(cards).toEqual([
      { kind: 'vault', id: '1', action: 'reveal', secretId: BANK, name: 'Bank login', secretType: 'login' },
      { kind: 'vault', id: '2', action: 'enter', secretId: ALARM, name: 'Alarm code', secretType: 'note', newSecret: true },
    ]);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
    expect(JSON.stringify(state)).not.toContain('expires');

    const storage = memoryStorage();
    const store = chatStore(storage, async () => []);
    await store.save(USER, { entries: state.entries, noticeDismissed: null });
    expect([...storage.map.values()].join('')).not.toContain(TOKEN);
    expect((await store.load(USER)).entries).toEqual(state.entries);

    const next = chatReducer(state, { type: 'send', text: 'thanks' });
    const sent = JSON.stringify(messagesToSend(next.entries));
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain(BANK); // cards are never sent, only text
  });

  it('a saved card with extra fields comes back with ids, names and kind only', async () => {
    const storage = memoryStorage();
    const store = chatStore(storage, async () => []);
    const written = { ...card({}), link: `https://x/reveal#t=${TOKEN}`, value: 'hunter2', newSecret: 'yes' };
    storage.map.set(`wilma.chat.${USER}`, JSON.stringify({ v: 1, user: USER, entries: [written], noticeDismissed: null }));
    const [entry] = (await store.load(USER)).entries;
    expect(entry).toEqual(card({}));
  });
});

describe('vault cards: where they lead', () => {
  it('reveal opens the secret’s own screen (which asks for the fingerprint)', () => {
    expect(vaultRoute(card({}))).toEqual({ screen: 'secret', params: { id: BANK, name: 'Bank login', type: 'login' } });
    expect(vaultRoute(card({ secretType: undefined }))).toEqual({ screen: 'secret', params: { id: BANK, name: 'Bank login' } });
  });

  it('enter for an existing secret opens "new value" with its id and kind', () => {
    expect(vaultRoute(card({ action: 'enter', secretType: 'wifi', name: 'Home Wi-Fi' }))).toEqual({
      screen: 'change',
      params: { id: BANK, name: 'Home Wi-Fi', type: 'wifi' },
    });
  });

  it('enter for a secret that does not exist yet opens "save a new secret", without its id', () => {
    expect(vaultRoute(card({ action: 'enter', secretId: ALARM, name: 'Alarm code', secretType: 'note', newSecret: true }))).toEqual({
      screen: 'new',
      params: { name: 'Alarm code', type: 'note' },
    });
  });

  it('falls back to the vault list when the card does not say enough', () => {
    // An older server without secret_type: the app does not guess the form.
    expect(vaultRoute(card({ action: 'enter', secretType: undefined }))).toEqual({ screen: 'list' });
    expect(vaultRoute(card({ action: 'enter', secretType: undefined, newSecret: true }))).toEqual({ screen: 'list' });
    for (const secretType of ['password', 'constructor', '__proto__', '']) {
      expect(vaultRoute(card({ action: 'enter', secretType }))).toEqual({ screen: 'list' });
    }
    expect(vaultRoute(card({ secretId: 'Bank login' }))).toEqual({ screen: 'list' });
    expect(vaultRoute(card({ action: 'enter', secretId: '../vault/setup' }))).toEqual({ screen: 'list' });
  });

  it('says what the card is for', () => {
    expect(vaultCardText(card({}))).toEqual({ text: 'Open “Bank login” in your vault', button: 'Open in the vault' });
    expect(vaultCardText(card({ action: 'enter' }))).toEqual({
      text: 'Enter the value for “Bank login” in your vault',
      button: 'Enter the value',
    });
  });
});
