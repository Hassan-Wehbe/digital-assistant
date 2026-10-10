// One answer from Wilma, played into the thread: sends the thread, hands each streamed event
// to the reducer, and makes sure the answer always ends (Send comes back) whatever happens.
// Also a delete card's Delete: its one delete, run once, with the result put in the thread.

import type { Agenda } from './calendar';
import type { ChatClient, SharedPoint } from './chatClient';
import { runDelete, type DeleteRunners } from './chatDeletes';
import { CONNECTION_MESSAGE, type ChatEvent } from './chatStream';
import type { ChatAction, ChatState, Entry } from './chatThread';
import { WilmaError } from './wilma';

/** How an answer ended: normally (`done`, including an error message), by Stop, or signed out. */
export type TurnEnd = 'done' | 'stopped' | 'signed_out';

export async function runTurn(
  send: ChatClient['send'],
  entries: Entry[],
  signal: AbortSignal,
  act: (action: ChatAction) => void,
  /** The 📍 location, for this message only. */
  here?: SharedPoint,
  /** The calendar Wilma asked for, sent with the question again. */
  agenda?: Agenda,
): Promise<TurnEnd> {
  const events = send(entries, signal, here, agenda)[Symbol.asyncIterator]();
  let handedOn = false;
  try {
    for (let r = await events.next(); !r.done; r = await events.next()) {
      const event = r.value;
      if (signal.aborted) break;
      act({ type: 'event', event });
      if (event.type === 'done') {
        // The answer is complete (Send comes back now); "remembered" may still follow.
        handedOn = true;
        void afterDone(events, signal, act);
        return 'done';
      }
    }
  } catch (e) {
    if (e instanceof WilmaError && e.signedOut) {
      act({ type: 'stop' });
      return 'signed_out';
    }
    // Anything unexpected: the usual message, never the error's own text.
  } finally {
    if (!handedOn) void events.return?.(undefined)?.catch(() => {});
  }
  if (signal.aborted) {
    act({ type: 'stop' });
    return 'stopped';
  }
  act({ type: 'event', event: { type: 'error', code: 'connection', message: CONNECTION_MESSAGE } });
  act({ type: 'event', event: { type: 'done', counted: false } });
  return 'done';
}

/** How long the app keeps listening after `done` for "remembered" (the server's own limit is
 * about 8 seconds, plus saving). */
export const REMEMBERED_WAIT_MS = 20_000;

/**
 * After `done`: the "remembered" events of this answer, until the server closes the stream, the
 * wait is over, or the answer was abandoned (signed out). Never shows an error: the answer is
 * already complete, and a memory missed here is still in the Memories space.
 */
export async function afterDone(
  events: AsyncIterator<ChatEvent>,
  signal: AbortSignal,
  act: (action: ChatAction) => void,
  waitMs = REMEMBERED_WAIT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), waitMs)));
  try {
    while (!signal.aborted) {
      const r = await Promise.race([events.next(), timeout]);
      if (r === 'timeout' || r.done || signal.aborted) break;
      if (r.value.type === 'remembered') act({ type: 'remembered', memories: r.value.memories });
    }
  } catch {
    // The connection went: nothing to say.
  } finally {
    clearTimeout(timer);
    void events.return?.(undefined)?.catch(() => {});
  }
}

/** How a tap on a card's Delete ended. */
export type ConfirmEnd = 'not_started' | 'deleted' | 'failed' | 'signed_out';

/**
 * Delete tapped on a card: starts it in the thread and runs its one delete. A second tap (the
 * card is already running), a card the app refuses, or a tap while an answer streams changes
 * nothing in the thread, so nothing runs. `live` says whether the result still belongs to the
 * signed-in account's thread.
 */
export async function runConfirm(
  current: () => ChatState,
  act: (action: ChatAction) => ChatState,
  id: string,
  runners: DeleteRunners,
  live: () => boolean = () => true,
): Promise<ConfirmEnd> {
  const before = current();
  const next = act({ type: 'confirm_start', id });
  const card = next.entries.find((e) => e.id === id);
  if (next === before || !card || card.kind !== 'confirm' || card.state !== 'running') return 'not_started';
  try {
    await runDelete(card, runners);
  } catch (e) {
    if (live()) act({ type: 'confirm_failed', id, error: e instanceof Error ? e.message : 'That did not work. Try again.' });
    return e instanceof WilmaError && e.signedOut ? 'signed_out' : 'failed';
  }
  if (live()) act({ type: 'confirm_done', id });
  return 'deleted';
}
