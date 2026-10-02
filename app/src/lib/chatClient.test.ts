import { describe, expect, it, jest } from '@jest/globals';

import { chatClient, type StreamingFetch } from './chatClient';
import { CONNECTION_MESSAGE, type ChatEvent } from './chatStream';
import type { Entry } from './chatThread';
import { WilmaError } from './wilma';

const URL = 'https://example.supabase.co/functions/v1/chat';
const TOKEN = 'token-1-very-private';

function streamed(status: number, lines: object[] = []) {
  const queue = lines.map((l) => new TextEncoder().encode(JSON.stringify(l) + '\n'));
  return {
    status,
    ok: status >= 200 && status < 300,
    body: {
      getReader: () => ({
        read: async () => {
          const value = queue.shift();
          return value ? { done: false as const, value } : { done: true as const, value: undefined };
        },
        cancel: async () => {},
      }),
    },
  };
}

type Reply = ReturnType<typeof streamed> | Error;

function setup(replies: Reply[], opts: { token?: string | null; refreshed?: string | null } = {}) {
  const fetch = jest.fn<StreamingFetch>(async () => {
    const r = replies.shift()!;
    if (r instanceof Error) throw r;
    return r;
  });
  const refresh = jest.fn(async () => (opts.refreshed === undefined ? 'token-2' : opts.refreshed));
  const client = chatClient({
    url: URL,
    token: async () => (opts.token === undefined ? TOKEN : opts.token),
    refresh,
    fetch,
  });
  return { client, fetch, refresh };
}

async function all(source: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of source) out.push(e);
  return out;
}

const hello: Entry[] = [{ kind: 'user', id: '0', text: 'Hello' }];
const answer = [
  { type: 'text', text: 'Hi!' },
  { type: 'done', counted: true },
];
const lost = [
  { type: 'error', code: 'connection', message: CONNECTION_MESSAGE },
  { type: 'done', counted: false },
];

describe('chat client', () => {
  it("posts the thread with the user's token and streams the answer", async () => {
    const { client, fetch } = setup([streamed(200, answer)]);
    const signal = new AbortController().signal;
    expect(await all(client.send(hello, signal))).toEqual(answer);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body)).toEqual({ messages: [{ role: 'user', content: 'Hello' }] });
  });

  it('sends only user and assistant text, at most 20, ending with the new message', async () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push({ kind: 'user', id: `u${i}`, text: `question ${i}` });
      entries.push({ kind: 'assistant', id: `a${i}`, text: `answer ${i}` });
    }
    entries.push(
      {
        kind: 'confirm',
        id: 'c',
        tool: 'delete_item',
        args: { item_id: 'i1' },
        target: { id: 'i1', title: 'Soup' },
        message: 'Move "Soup" to the recycle bin?',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        state: 'not_done',
      },
      { kind: 'vault', id: 'v', action: 'reveal', secretId: 's1', name: 'Bank login' },
      { kind: 'error', id: 'e', code: 'connection', message: CONNECTION_MESSAGE, buttons: ['try_again'] },
      { kind: 'user', id: 'last', text: 'newest' },
    );
    const { client, fetch } = setup([streamed(200, answer)]);
    await all(client.send(entries));

    const { messages } = JSON.parse(fetch.mock.calls[0][1].body);
    expect(messages).toHaveLength(20);
    expect(messages[19]).toEqual({ role: 'user', content: 'newest' });
    expect(messages[0]).toEqual({ role: 'assistant', content: 'answer 5' });
    for (const m of messages) expect(Object.keys(m).sort()).toEqual(['content', 'role']);
    const sent = JSON.stringify(messages);
    for (const hidden of ['recycle bin', 'Bank login', 'trouble connecting', 'delete_item']) expect(sent).not.toContain(hidden);
  });

  it('refreshes the session once after a 401 and retries with the new token', async () => {
    const { client, fetch, refresh } = setup([streamed(401), streamed(200, answer)]);
    expect(await all(client.send(hello))).toEqual(answer);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer token-2');
  });

  it('reports a signed-out state after a second 401, or when the session cannot be refreshed', async () => {
    for (const { replies, refreshed } of [
      { replies: [streamed(401), streamed(401)], refreshed: undefined },
      { replies: [streamed(401)], refreshed: null },
    ]) {
      const { client, refresh } = setup(replies, { refreshed });
      const err = await all(client.send(hello)).catch((e) => e);
      expect(err).toBeInstanceOf(WilmaError);
      expect(err.signedOut).toBe(true);
      expect(err.message).toBe('Your session has ended. Please sign in again.');
      expect(refresh).toHaveBeenCalledTimes(1);
    }
  });

  it('asks to sign in without calling the server when there is no session', async () => {
    const { client, fetch } = setup([], { token: null });
    const err = await all(client.send(hello)).catch((e) => e);
    expect(err.signedOut).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns 400, 500, no connection and a failed refresh into the connection message', async () => {
    for (const replies of [[streamed(400)], [streamed(500)], [new TypeError('Network request failed')]]) {
      const { client } = setup(replies);
      expect(await all(client.send(hello))).toEqual(lost);
    }
    const { client, refresh } = setup([streamed(401)]);
    refresh.mockRejectedValueOnce(new Error('offline'));
    expect(await all(client.send(hello))).toEqual(lost);
  });

  it('never puts the token in an event or an error', async () => {
    const seen: string[] = [];
    for (const replies of [[streamed(500)], [new Error(`failed with ${TOKEN}`)], [streamed(401), streamed(401)]]) {
      const { client } = setup(replies, { refreshed: TOKEN });
      try {
        seen.push(JSON.stringify(await all(client.send(hello))));
      } catch (e) {
        seen.push(String(e), (e as Error).message);
      }
    }
    for (const s of seen) expect(s).not.toContain(TOKEN);
  });

  it('ends quietly when Stop aborts the request', async () => {
    const controller = new AbortController();
    const fetch = jest.fn<StreamingFetch>(async () => {
      controller.abort();
      throw new Error('The operation was aborted.');
    });
    const stopped = chatClient({ url: URL, token: async () => TOKEN, refresh: async () => null, fetch });
    expect(await all(stopped.send(hello, controller.signal))).toEqual([]);
  });
});
