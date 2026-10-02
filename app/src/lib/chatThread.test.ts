import { describe, expect, it } from '@jest/globals';

import type { ChatEvent } from './chatStream';
import {
  canSend,
  chatReducer,
  initialChat,
  MAX_ENTRIES,
  MAX_TEXT,
  messagesToSend,
  monthKey,
  noticeVisible,
  PARTIAL_NOTE,
  type ChatAction,
  type ChatState,
  type Entry,
} from './chatThread';

const run = (state: ChatState, ...actions: ChatAction[]) => actions.reduce(chatReducer, state);
const ev = (event: ChatEvent): ChatAction => ({ type: 'event', event });
const send = (text: string): ChatAction => ({ type: 'send', text });
const text = (t: string) => ev({ type: 'text', text: t });
const status = (tool: string, t = 'Working…') => ev({ type: 'status', tool, text: t });
const error = (code: string, message = `msg ${code}`) => ev({ type: 'error', code, message });
const DONE = ev({ type: 'done', counted: true });
const confirm: ChatEvent = {
  type: 'confirm',
  tool: 'delete_item',
  args: { item_id: 'i1' },
  target: { id: 'i1', title: 'Tomato soup' },
  message: 'Move "Tomato soup" to the recycle bin?',
  confirm_label: 'Delete',
  cancel_label: 'Cancel',
};

describe('chat thread', () => {
  it('appends streamed text to one assistant message', () => {
    const s = run(initialChat(), send('  Hi Wilma  '), text('Hel'), text('lo'), text(' there.'), DONE);
    expect(s.entries).toEqual([
      { kind: 'user', id: '0', text: 'Hi Wilma' },
      { kind: 'assistant', id: '1', text: 'Hello there.' },
    ]);
    expect(s.streaming).toBe(false);
    expect(canSend(s)).toBe(true);
  });

  it('ignores an empty message and a send while an answer is streaming', () => {
    expect(run(initialChat(), send('   ')).entries).toEqual([]);
    const s = run(initialChat(), send('one'), send('two'));
    expect(s.entries.map((e) => e.kind === 'user' && e.text)).toEqual(['one']);
  });

  it('shows the status line, replaces it, and clears it when text starts or the answer ends', () => {
    let s = run(initialChat(), send('find soup'), status('search_items', 'Searching your notes…'));
    expect(s.status).toBe('Searching your notes…');
    s = run(s, status('get_item', 'Reading your note…'));
    expect(s.status).toBe('Reading your note…');
    s = run(s, text('Found it.'));
    expect(s.status).toBeNull();
    s = run(s, status('save_item', 'Saving…'), DONE);
    expect(s.status).toBeNull();
    expect(s.entries.some((e) => JSON.stringify(e).includes('Saving'))).toBe(false);
  });

  it('starts a new bubble for text after a card, without the paragraph break', () => {
    const s = run(initialChat(), send('delete soup'), text('Sure.'), ev(confirm), text('\n\nTap Delete to confirm.'), DONE);
    expect(s.entries.map((e) => [e.kind, e.kind === 'assistant' ? e.text : ''])).toEqual([
      ['user', ''],
      ['assistant', 'Sure.'],
      ['confirm', ''],
      ['assistant', 'Tap Delete to confirm.'],
    ]);
    expect(s.entries[2]).toMatchObject({ kind: 'confirm', state: 'pending', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
  });

  it('keeps vault cards with ids and names only', () => {
    const s = run(
      initialChat(),
      send('bank password'),
      ev({ type: 'vault', action: 'reveal', secret_id: 's1', name: 'Bank login' }),
      ev({ type: 'vault', action: 'enter', secret_id: 's2', name: 'Wi-Fi', secret_type: 'wifi' }),
      DONE,
    );
    expect(s.entries.slice(1)).toEqual([
      { kind: 'vault', id: '1', action: 'reveal', secretId: 's1', name: 'Bank login' },
      { kind: 'vault', id: '2', action: 'enter', secretId: 's2', name: 'Wi-Fi', secretType: 'wifi' },
    ]);
  });

  it('gives each error code its buttons', () => {
    const buttons = (code: string) => {
      const s = run(initialChat(), send('hi'), error(code), DONE);
      const last = s.entries[s.entries.length - 1];
      return last.kind === 'error' ? last.buttons : null;
    };
    expect(buttons('allowance_used')).toEqual(['search', 'vault']);
    expect(buttons('service_paused')).toEqual(['search', 'vault']);
    expect(buttons('connection')).toEqual(['try_again']);
    expect(buttons('something_new')).toEqual([]);
  });

  it('shows the server message and stops sending once the allowance is used up', () => {
    const used = "You've used this month's AI requests. They reset on November 1.";
    const s = run(initialChat(), send('hi'), error('allowance_used', used), DONE);
    expect(s.entries[1]).toMatchObject({ kind: 'error', message: used });
    expect(s.blocked).toBe(used);
    expect(canSend(s)).toBe(false);
    expect(run(s, send('again')).entries).toHaveLength(2);
    // Paused service: sending stays possible.
    expect(canSend(run(initialChat(), send('hi'), error('service_paused'), DONE))).toBe(true);
    // Reopening the app (a fresh state from the saved entries) tries again.
    expect(canSend(initialChat(s.entries))).toBe(true);
  });

  it('shows the allowance banner once and remembers a dismissal for the month', () => {
    const notice = ev({ type: 'notice', code: 'allowance_low', message: "You've used most of this month's requests." });
    let s = run(initialChat(), send('hi'), notice, text('Hello'), notice, DONE);
    expect(s.notice).toBe("You've used most of this month's requests.");
    expect(s.entries).toHaveLength(2);
    expect(noticeVisible(s, '2026-10')).toBe(true);

    s = run(s, { type: 'dismiss_notice', month: '2026-10' }, send('more'), notice, DONE);
    expect(noticeVisible(s, '2026-10')).toBe(false);
    expect(noticeVisible(s, '2026-11')).toBe(true);
    expect(noticeVisible(initialChat([], '2026-10'), '2026-10')).toBe(false);
    expect(monthKey(new Date(2026, 9, 2))).toBe('2026-10');
    expect(monthKey(new Date(2027, 0, 31))).toBe('2027-01');
  });

  it('Try again removes the error and re-sends the last user message, once', () => {
    let s = run(initialChat(), send('Hello'), DONE, send('find soup'), text('Look'), error('connection'), DONE);
    expect(s.entries.map((e) => e.kind)).toEqual(['user', 'user', 'assistant', 'error']);

    s = run(s, { type: 'retry' });
    expect(s.streaming).toBe(true);
    expect(s.entries.map((e) => e.kind)).toEqual(['user', 'user', 'assistant']);
    // The half-written answer stays visible but is not sent; the request ends with the user message.
    expect(messagesToSend(s.entries)).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'find soup' },
    ]);
    // A second tap does nothing.
    expect(run(s, { type: 'retry' })).toBe(s);

    s = run(s, text('Here it is.'), DONE);
    expect(s.entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind))).toEqual(['user', 'user', 'Look', 'Here it is.']);
    // Only a connection error can be retried.
    const paused = run(initialChat(), send('hi'), error('service_paused'), DONE);
    expect(run(paused, { type: 'retry' })).toBe(paused);
  });

  it('adds the "part of this may be done" line only after a tool that may have changed something', () => {
    const note = (...actions: ChatAction[]) => {
      const s = run(initialChat(), send('hi'), ...actions, error('connection'), DONE);
      const last = s.entries[s.entries.length - 1];
      return last.kind === 'error' ? last.note : 'no error';
    };
    expect(note()).toBeUndefined();
    expect(note(status('search_items'), status('get_item'), status('find_secret'), status('get_secret'))).toBeUndefined();
    expect(note(status('search_items'), status('save_item'))).toBe(PARTIAL_NOTE);
    for (const tool of ['update_item', 'create_space', 'link_items', 'attach_file', 'restore_item', 'set_assistant_name', 'new_tool']) {
      expect(note(status(tool))).toBe(PARTIAL_NOTE);
    }
    // A write in an earlier answer does not count.
    const s = run(initialChat(), send('save'), status('save_item'), DONE, send('find'), status('search_items'), error('connection'), DONE);
    expect(s.entries[s.entries.length - 1]).not.toHaveProperty('note');
  });

  it('Stop ends the answer, keeps the text, and ignores late events', () => {
    let s = run(initialChat(), send('long story'), text('Once upon'), { type: 'stop' });
    expect(s.streaming).toBe(false);
    s = run(s, text(' a time'), error('connection'), DONE);
    expect(s.entries).toEqual([
      { kind: 'user', id: '0', text: 'long story' },
      { kind: 'assistant', id: '1', text: 'Once upon' },
    ]);
  });

  it('a new message turns a pending delete card into "not done"', () => {
    let s = run(initialChat(), send('delete soup'), ev(confirm), DONE);
    expect(s.entries[1]).toMatchObject({ kind: 'confirm', state: 'pending' });
    s = run(s, send('never mind'));
    expect(s.entries[1]).toMatchObject({ kind: 'confirm', state: 'not_done' });
  });

  it('sends only user and assistant text', () => {
    const s = run(
      initialChat(),
      send('delete soup'),
      text('Sure.'),
      ev(confirm),
      ev({ type: 'vault', action: 'reveal', secret_id: 's1', name: 'Bank login' }),
      error('service_paused'),
      DONE,
      send('ok'),
    );
    expect(messagesToSend(s.entries)).toEqual([
      { role: 'user', content: 'delete soup' },
      { role: 'assistant', content: 'Sure.' },
      { role: 'user', content: 'ok' },
    ]);
  });

  it('keeps at most 100 entries and cuts very long texts', () => {
    let s = initialChat();
    for (let i = 0; i < 60; i++) s = run(s, send(`q${i}`), text(`a${i}`), DONE);
    expect(s.entries).toHaveLength(MAX_ENTRIES);
    expect(s.entries[0]).toMatchObject({ kind: 'user', text: 'q10' });

    s = run(s, send('x'.repeat(MAX_TEXT + 50)), text('y'.repeat(MAX_TEXT)), text('more'), DONE);
    const [user, answer] = s.entries.slice(-2) as { text: string }[];
    expect(user.text).toHaveLength(MAX_TEXT);
    expect(answer.text).toHaveLength(MAX_TEXT);
  });

  it('continues ids after a reload, so new entries never reuse one', () => {
    const saved: Entry[] = [
      { kind: 'user', id: '7', text: 'old' },
      { kind: 'assistant', id: '8', text: 'old answer' },
    ];
    const s = run(initialChat(saved), send('new'));
    expect(s.entries[2].id).toBe('9');
  });
});
