import { describe, expect, it } from '@jest/globals';

import { CONNECTION_MESSAGE, readChatEvents, type ChatEvent } from './chatStream';

const bytes = (s: string) => new TextEncoder().encode(s);

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield typeof p === 'string' ? bytes(p) : p;
}

async function all(source: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of source) out.push(e);
  return out;
}

const line = (e: object) => JSON.stringify(e) + '\n';
const DONE = line({ type: 'done', counted: true });
const lost = [
  { type: 'error', code: 'connection', message: CONNECTION_MESSAGE },
  { type: 'done', counted: false },
];

describe('readChatEvents', () => {
  it('reads an event split across chunks', async () => {
    const text = line({ type: 'text', text: 'Hello there' });
    const events = await all(readChatEvents(chunks(text.slice(0, 7), text.slice(7, 20), text.slice(20), DONE)));
    expect(events).toEqual([
      { type: 'text', text: 'Hello there' },
      { type: 'done', counted: true },
    ]);
  });

  it('keeps a multi-byte character split across two chunks intact', async () => {
    for (const word of ['café', 'مرحبا', '“quoted”']) {
      const encoded = bytes(line({ type: 'text', text: word }) + DONE);
      // Split inside the first multi-byte character.
      const at = encoded.findIndex((b) => b >= 0x80) + 1;
      const events = await all(readChatEvents(chunks(encoded.slice(0, at), encoded.slice(at))));
      expect(events[0]).toEqual({ type: 'text', text: word });
    }
  });

  it('reads several events from one chunk and skips blank lines', async () => {
    const one =
      line({ type: 'status', tool: 'search_items', text: 'Searching your notes…' }) +
      '\n\r\n' +
      line({ type: 'text', text: 'A' }) +
      line({ type: 'text', text: 'B' }) +
      DONE;
    expect((await all(readChatEvents(chunks(one)))).map((e) => e.type)).toEqual(['status', 'text', 'text', 'done']);
  });

  it('skips a line that is not JSON and an event type it does not know', async () => {
    const events = await all(
      readChatEvents(
        chunks('{not json\n', line({ type: 'sparkle', text: 'new' }), line({ type: 'text' }), line({ type: 'text', text: 'ok' }), DONE),
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'done', counted: true },
    ]);
  });

  it('turns a stream that ends without done into a connection error', async () => {
    expect(await all(readChatEvents(chunks(line({ type: 'text', text: 'Half' }), '{"type":"te')))).toEqual([
      { type: 'text', text: 'Half' },
      ...lost,
    ]);
    expect(await all(readChatEvents(chunks()))).toEqual(lost);
  });

  it('turns a broken stream into a connection error', async () => {
    async function* breaks() {
      yield bytes(line({ type: 'text', text: 'Half' }));
      throw new Error('network lost');
    }
    expect(await all(readChatEvents(breaks()))).toEqual([{ type: 'text', text: 'Half' }, ...lost]);
  });

  it('reads a final line with no newline after it, and stops at done', async () => {
    const events = await all(readChatEvents(chunks(line({ type: 'text', text: 'A' }), '{"type":"done","counted":false}')));
    expect(events).toEqual([
      { type: 'text', text: 'A' },
      { type: 'done', counted: false },
    ]);
    const after = await all(readChatEvents(chunks(DONE + line({ type: 'text', text: 'late' }))));
    expect(after).toEqual([{ type: 'done', counted: true }]);
  });

  it('stops cleanly when aborted, with no error, and releases the reader', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const queue = [bytes(line({ type: 'text', text: 'One' })), bytes(line({ type: 'text', text: 'Two' }))];
    const reader = {
      read: async () => {
        const value = queue.shift();
        if (!value) {
          controller.abort();
          throw new Error('The operation was aborted.');
        }
        return { done: false as const, value };
      },
      cancel: async () => {
        cancelled = true;
      },
    };
    const events: ChatEvent[] = [];
    for await (const e of readChatEvents(reader, controller.signal)) {
      events.push(e);
      if (events.length === 1) controller.abort();
    }
    expect(events).toEqual([{ type: 'text', text: 'One' }]);
    expect(cancelled).toBe(true);

    const before = new AbortController();
    before.abort();
    expect(await all(readChatEvents(chunks(line({ type: 'text', text: 'x' }), DONE), before.signal))).toEqual([]);
  });

  it('keeps only the expected fields of each event', async () => {
    const events = await all(
      readChatEvents(
        chunks(
          line({ type: 'notice', code: 'allowance_low', message: 'Most used.', used_fraction: 0.8 }),
          line({
            type: 'confirm',
            tool: 'delete_item',
            args: { item_id: 'i1' },
            target: { id: 'i1', title: 'Tomato soup', extra: 1 },
            message: 'Move "Tomato soup" to the recycle bin?',
            confirm_label: 'Delete',
            cancel_label: 'Cancel',
          }),
          line({ type: 'confirm', tool: 'delete_item', args: 'i1', target: { id: 'i1', title: 'x' }, message: 'm', confirm_label: 'D', cancel_label: 'C' }),
          DONE,
        ),
      ),
    );
    expect(events).toEqual([
      { type: 'notice', code: 'allowance_low', message: 'Most used.' },
      {
        type: 'confirm',
        tool: 'delete_item',
        args: { item_id: 'i1' },
        target: { id: 'i1', title: 'Tomato soup' },
        message: 'Move "Tomato soup" to the recycle bin?',
        confirm_label: 'Delete',
        cancel_label: 'Cancel',
      },
      { type: 'done', counted: true },
    ]);
  });

  it('drops the vault link as the event is read', async () => {
    const link = 'https://example.com/vault/reveal#one-time-token-abc';
    const events = await all(
      readChatEvents(
        chunks(
          line({ type: 'vault', action: 'reveal', secret_id: 's1', name: 'Bank login', link, expires_at: '2026-10-02T12:00:00Z' }),
          line({ type: 'vault', action: 'enter', secret_id: 's2', name: 'Wi-Fi', secret_type: 'wifi', link }),
          line({ type: 'vault', action: 'open', secret_id: 's3', name: 'x', link }),
          DONE,
        ),
      ),
    );
    expect(events).toEqual([
      { type: 'vault', action: 'reveal', secret_id: 's1', name: 'Bank login' },
      { type: 'vault', action: 'enter', secret_id: 's2', name: 'Wi-Fi', secret_type: 'wifi' },
      { type: 'done', counted: true },
    ]);
    expect(JSON.stringify(events)).not.toContain('one-time-token');
  });
});

describe('the calendar request (day planner step 1)', () => {
  it('passes on the days Wilma asked for, and drops a request without real-looking days', async () => {
    const events = await all(readChatEvents(chunks(
      line({ type: 'agenda_request', from: '2026-10-08', to: '2026-10-09', extra: 'dropped' }),
      line({ type: 'agenda_request', from: 'today', to: '2026-10-09' }),
      line({ type: 'agenda_request', from: '2026-10-08' }),
      DONE,
    )));
    expect(events.filter((e) => e.type === 'agenda_request')).toEqual([{ type: 'agenda_request', from: '2026-10-08', to: '2026-10-09' }]);
  });

  it('after done, reads on only for "remembered"; the end of the stream there is quiet', async () => {
    const remembered = { type: 'remembered', memories: [{ id: 'm1', fact: 'Lexi swims on Tuesdays', updated: false }] };
    const events = await all(readChatEvents(chunks(
      line({ type: 'remembered', memories: [{ id: 'early', fact: 'Never before done', updated: false }] }),
      line({ type: 'text', text: 'Nice!' }),
      DONE,
      line({ type: 'text', text: 'ignored after done' }),
      line(remembered),
      line({ type: 'remembered', memories: [] }),
    )));
    expect(events).toEqual([{ type: 'text', text: 'Nice!' }, { type: 'done', counted: true }, remembered]);
  });

  it('a broken connection after done adds no error', async () => {
    async function* breaks(): AsyncGenerator<Uint8Array> {
      yield bytes(line({ type: 'text', text: 'Hi' }) + DONE);
      throw new Error('reset');
    }
    expect(await all(readChatEvents(breaks()))).toEqual([{ type: 'text', text: 'Hi' }, { type: 'done', counted: true }]);
  });
});
