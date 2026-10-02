import { describe, expect, it } from '@jest/globals';

import { runTurn } from './chatRun';
import { CONNECTION_MESSAGE, type ChatEvent } from './chatStream';
import { chatReducer, initialChat, type ChatAction, type ChatState } from './chatThread';
import { WilmaError } from './wilma';

function play(events: ChatEvent[], opts: { throwAfter?: Error; abortAfter?: number } = {}) {
  const controller = new AbortController();
  let state: ChatState = chatReducer(initialChat(), { type: 'send', text: 'hello' });
  const act = (a: ChatAction) => {
    state = chatReducer(state, a);
  };
  async function* send(): AsyncGenerator<ChatEvent> {
    let n = 0;
    for (const e of events) {
      if (opts.abortAfter !== undefined && n++ === opts.abortAfter) controller.abort();
      yield e;
    }
    if (opts.throwAfter) throw opts.throwAfter;
  }
  return { run: () => runTurn(send, state.entries, controller.signal, act), state: () => state };
}

describe('runTurn', () => {
  it('plays the events into the thread and ends with done', async () => {
    const t = play([
      { type: 'status', tool: 'search_items', text: 'Searching your notes…' },
      { type: 'text', text: 'Found ' },
      { type: 'text', text: 'it.' },
      { type: 'done', counted: true },
    ]);
    expect(await t.run()).toBe('done');
    expect(t.state().streaming).toBe(false);
    expect(t.state().entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind))).toEqual(['user', 'Found it.']);
  });

  it('ends a signed-out answer without an error message', async () => {
    const t = play([], { throwAfter: new WilmaError('Your session has ended. Please sign in again.', true) });
    expect(await t.run()).toBe('signed_out');
    expect(t.state().streaming).toBe(false);
    expect(t.state().entries).toHaveLength(1);
  });

  it('turns anything unexpected into the connection message, never its own text', async () => {
    const t = play([{ type: 'text', text: 'Half' }], { throwAfter: new Error('secret internal detail') });
    expect(await t.run()).toBe('done');
    const last = t.state().entries[t.state().entries.length - 1];
    expect(last).toMatchObject({ kind: 'error', code: 'connection', message: CONNECTION_MESSAGE, buttons: ['try_again'] });
    expect(JSON.stringify(t.state())).not.toContain('secret internal detail');
    expect(t.state().streaming).toBe(false);

    // A stream that stops without done (should not happen) ends the same way.
    const quiet = play([{ type: 'text', text: 'Half' }]);
    expect(await quiet.run()).toBe('done');
    expect(quiet.state().streaming).toBe(false);
  });

  it('stops on Stop and ignores what arrives after it', async () => {
    const t = play(
      [
        { type: 'text', text: 'One' },
        { type: 'text', text: ' two' },
        { type: 'done', counted: true },
      ],
      { abortAfter: 1 },
    );
    expect(await t.run()).toBe('stopped');
    expect(t.state().streaming).toBe(false);
    expect(t.state().entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind))).toEqual(['user', 'One']);
  });
});

describe('thread load and clear', () => {
  it('loads a saved thread, and "New conversation" empties it but keeps the banner choice and the limit', () => {
    let s = chatReducer(initialChat(), {
      type: 'load',
      entries: [
        { kind: 'user', id: '4', text: 'saved' },
        { kind: 'assistant', id: '5', text: 'answer' },
      ],
      noticeDismissed: '2026-10',
    });
    expect(s.entries).toHaveLength(2);
    expect(s.seq).toBe(6);
    s = chatReducer(s, { type: 'send', text: 'more' });
    s = chatReducer(s, { type: 'event', event: { type: 'error', code: 'allowance_used', message: 'Used up.' } });
    s = chatReducer(s, { type: 'clear' });
    expect(s.entries).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.noticeDismissed).toBe('2026-10');
    expect(s.blocked).toBe('Used up.');
  });
});
