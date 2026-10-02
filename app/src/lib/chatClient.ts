// Talks to the `chat` function (supabase/functions/chat/) with the signed-in user's token,
// built like wilmaClient: the token, refresh and fetch are handed in, so tests need no phone.
//
// React Native's own `fetch` does not stream, so the default here is `expo/fetch`, whose
// response body can be read piece by piece (docs/phase5-a5c-chat-screen-plan.md).

import { fetch as expoFetch } from 'expo/fetch';

import { CONNECTION_MESSAGE, readChatEvents, type ChatEvent, type ChunkSource } from './chatStream';
import { messagesToSend, type Entry } from './chatThread';
import { WilmaError } from './wilma';

/** The part of a streaming fetch the client uses. */
export type StreamingFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; body: { getReader(): ChunkSource } | null }>;

export interface ChatClientOptions {
  url: string;
  /** The current access token, or null when signed out. */
  token: () => Promise<string | null>;
  /** Called once after a 401; returns a fresh token, or null if the session is over. */
  refresh: () => Promise<string | null>;
  fetch?: StreamingFetch;
}

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

const connectionLost: ChatEvent[] = [
  { type: 'error', code: 'connection', message: CONNECTION_MESSAGE },
  { type: 'done', counted: false },
];

export function chatClient({ url, token, refresh, fetch: f = expoFetch as unknown as StreamingFetch }: ChatClientOptions) {
  /**
   * Sends the thread (its last 20 user and assistant messages, ending with the newest user
   * message) and yields the answer's events, ending with `done`. Problems become the usual
   * connection error event; only an ended session throws (a WilmaError marked signed out).
   * Aborting `signal` (Stop) ends the events quietly.
   */
  async function* send(entries: Entry[], signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const body = JSON.stringify({ messages: messagesToSend(entries) });
    const post = (accessToken: string) =>
      f(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body,
        signal,
      });

    let accessToken = await token();
    if (!accessToken) throw new WilmaError('Please sign in again.', true);

    let res: Awaited<ReturnType<StreamingFetch>>;
    try {
      res = await post(accessToken);
      if (res.status === 401) {
        accessToken = await refresh();
        if (!accessToken) throw new WilmaError(SESSION_ENDED, true);
        res = await post(accessToken);
        if (res.status === 401) throw new WilmaError(SESSION_ENDED, true);
      }
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      if (signal?.aborted) return;
      yield* connectionLost;
      return;
    }
    if (signal?.aborted) return;
    if (!res.ok || !res.body) {
      yield* connectionLost;
      return;
    }
    yield* readChatEvents(res.body.getReader(), signal);
  }

  return { send };
}

export type ChatClient = ReturnType<typeof chatClient>;
