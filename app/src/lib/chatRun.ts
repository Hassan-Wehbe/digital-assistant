// One answer from Wilma, played into the thread: sends the thread, hands each streamed event
// to the reducer, and makes sure the answer always ends (Send comes back) whatever happens.

import type { ChatClient } from './chatClient';
import { CONNECTION_MESSAGE } from './chatStream';
import type { ChatAction, Entry } from './chatThread';
import { WilmaError } from './wilma';

/** How an answer ended: normally (`done`, including an error message), by Stop, or signed out. */
export type TurnEnd = 'done' | 'stopped' | 'signed_out';

export async function runTurn(
  send: ChatClient['send'],
  entries: Entry[],
  signal: AbortSignal,
  act: (action: ChatAction) => void,
): Promise<TurnEnd> {
  try {
    for await (const event of send(entries, signal)) {
      if (signal.aborted) break;
      act({ type: 'event', event });
      if (event.type === 'done') return 'done';
    }
  } catch (e) {
    if (e instanceof WilmaError && e.signedOut) {
      act({ type: 'stop' });
      return 'signed_out';
    }
    // Anything unexpected: the usual message, never the error's own text.
  }
  if (signal.aborted) {
    act({ type: 'stop' });
    return 'stopped';
  }
  act({ type: 'event', event: { type: 'error', code: 'connection', message: CONNECTION_MESSAGE } });
  act({ type: 'event', event: { type: 'done', counted: false } });
  return 'done';
}
