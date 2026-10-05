// The chat thread kept on the phone, and how each streamed event changes it
// (docs/phase5-a5c-chat-screen-plan.md "Each event, and what the screen does"). Pure logic:
// a reducer the chat screen's provider will use, plus what is sent to the server.
//
// Only user and assistant *text* ever goes to the server: cards, errors, status lines and the
// allowance banner stay on the phone.
//
// A lookup from the one box (docs/phase5-a5d-one-box-plan.md) is written into the same thread
// with no model call: the message, a short assistant line, and for a secret the usual vault card.

import { cancelledMessage, checkDelete, deletedMessage } from './chatDeletes';
import type { ChatEvent } from './chatStream';
import type { Route } from './router';

/** At most this many entries are kept (oldest dropped). */
export const MAX_ENTRIES = 100;
/** Longer user or assistant texts are cut (the server reads at most this much of each). */
export const MAX_TEXT = 20_000;
/** At most this many messages are sent with each new one. */
export const MAX_SENT = 20;

/** Added to the connection message when a tool that may have changed something already ran. */
export const PARTIAL_NOTE = 'Part of this may already be done. Check your notes before trying again.';

/**
 * Tools that only read. Any other tool seen during a turn (save, update, create, link, attach,
 * restore, set name, or one this app does not know) means part of the request may be done.
 */
const READ_ONLY_TOOLS = new Set([
  'list_spaces',
  'search_items',
  'get_item',
  'find_secret',
  'get_secret',
  'get_attachment_link',
  'list_deleted_items',
]);

export type ErrorButton = 'search' | 'vault' | 'try_again';

/** The buttons each error code gets. An unknown code shows its message with no buttons. */
export function errorButtons(code: string): ErrorButton[] {
  switch (code) {
    case 'allowance_used':
    case 'service_paused':
      return ['search', 'vault'];
    case 'connection':
      return ['try_again'];
    default:
      return [];
  }
}

/**
 * A delete card: waiting for a tap (pending), its delete under way (running), then deleted,
 * cancelled, not done (the conversation moved on) or failed (Delete and Cancel stay).
 */
export type ConfirmState = 'pending' | 'running' | 'deleted' | 'cancelled' | 'not_done' | 'failed';

export type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | {
      kind: 'confirm';
      id: string;
      tool: string;
      args: Record<string, unknown>;
      target: { id: string; title: string };
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      state: ConfirmState;
      /** Why the delete failed (state failed): the client's own plain message. */
      error?: string;
    }
  /** Ids and names only: the vault link never reaches the thread. */
  | {
      kind: 'vault';
      id: string;
      action: 'reveal' | 'enter';
      secretId: string;
      name: string;
      secretType?: string;
      /** A secret that does not exist yet: its card opens "save a new secret". */
      newSecret?: true;
    }
  | { kind: 'error'; id: string; code: string; message: string; buttons: ErrorButton[]; note?: string };

export interface ChatState {
  entries: Entry[];
  /** Next entry id. */
  seq: number;
  /** An answer is streaming: Send shows as Stop. */
  streaming: boolean;
  /** The grey "Searching your notes…" line, while a tool runs. */
  status: string | null;
  /** The current answer's text entry, while it is being written. */
  answerId: string | null;
  /** Tools seen during the current answer. */
  tools: string[];
  /** The allowance banner's text, once the server sent it. */
  notice: string | null;
  /** The month ("2026-10") in which the banner was dismissed. */
  noticeDismissed: string | null;
  /**
   * Set when this month's allowance is used up: nothing goes to Wilma (lookups still work), and
   * this is the message to show.
   */
  blocked: string | null;
}

/** What the router found: a space or a secret (never Wilma). */
export type LookupRoute = Exclude<Route, { to: 'wilma' }>;

export type ChatAction =
  | { type: 'send'; text: string }
  /** A message the router answered without Wilma: written into the thread, nothing sent. */
  | { type: 'lookup'; text: string; route: LookupRoute }
  | { type: 'event'; event: ChatEvent }
  /** Stop tapped, or the request was abandoned (leaving, signing out). */
  | { type: 'stop' }
  /** Try again: removes the connection error; the caller then sends `messagesToSend` again. */
  | { type: 'retry' }
  | { type: 'dismiss_notice'; month: string }
  /** A saved thread was read from the phone (or the account changed): start from it. */
  | { type: 'load'; entries: Entry[]; noticeDismissed: string | null }
  /** "New conversation": an empty thread; the banner choice for this month is kept. */
  | { type: 'clear' }
  /** Delete tapped on a card: it starts running (the caller then runs its one delete). */
  | { type: 'confirm_start'; id: string }
  /** The card's delete finished. */
  | { type: 'confirm_done'; id: string }
  /** The card's delete failed; Delete and Cancel stay. */
  | { type: 'confirm_failed'; id: string; error: string }
  /** Cancel tapped on a card. */
  | { type: 'confirm_cancel'; id: string };

/** A thread as loaded from the phone (or empty). Status, banner and limits start fresh. */
export function initialChat(entries: Entry[] = [], noticeDismissed: string | null = null): ChatState {
  const seq = entries.reduce((max, e) => Math.max(max, Number(e.id) + 1 || 0), 0);
  return {
    entries: cap(entries),
    seq,
    streaming: false,
    status: null,
    answerId: null,
    tools: [],
    notice: null,
    noticeDismissed,
    blocked: null,
  };
}

/** "2026-10": the month a banner dismissal applies to, in the phone's own time. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Whether the allowance banner shows this month. */
export function noticeVisible(state: ChatState, month: string): boolean {
  return state.notice !== null && state.noticeDismissed !== month;
}

/** A delete is under way: nothing else is sent until it ends, so its follow-up comes in order. */
const deleting = (state: ChatState) => state.entries.some((e) => e.kind === 'confirm' && e.state === 'running');

/** Whether a message can go to Wilma now. */
export function canSend(state: ChatState): boolean {
  return canLookup(state) && state.blocked === null;
}

/** Whether a lookup can be written now: also when the allowance is used up (D22). */
export function canLookup(state: ChatState): boolean {
  return !state.streaming && !deleting(state);
}

/** The assistant's line after a lookup (the model reads it with the next message). */
export function lookupMessage(route: LookupRoute): string {
  return route.to === 'space' ? `Opened “${route.space.path}”.` : `Here is “${route.secret.name}” in your vault.`;
}

/**
 * Whether a card's Delete and Cancel can be tapped: it waits for an answer (pending, or failed),
 * the app accepts what it asks for, and no answer is streaming (the follow-up message would land
 * in the middle of it).
 */
export function cardActive(state: ChatState, entry: Entry): boolean {
  return (
    entry.kind === 'confirm' &&
    (entry.state === 'pending' || entry.state === 'failed') &&
    checkDelete(entry) !== null &&
    !state.streaming
  );
}

/**
 * What goes to the server: user and assistant text only, up to and including the last user
 * message (a half-written answer before a Try again is left out), at most the last 20.
 */
export function messagesToSend(entries: Entry[]): { role: 'user' | 'assistant'; content: string }[] {
  const lastUser = entries.findLastIndex((e) => e.kind === 'user');
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const e of entries.slice(0, lastUser + 1)) {
    if ((e.kind === 'user' || e.kind === 'assistant') && e.text) out.push({ role: e.kind, content: e.text });
  }
  return out.slice(-MAX_SENT);
}

const cut = (text: string) => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
const cap = (entries: Entry[]) => (entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries);

/** The conversation moved on: a delete card left unanswered can no longer be tapped. */
function moveOn(entries: Entry[]): Entry[] {
  return entries.map((e) => {
    if (e.kind !== 'confirm' || (e.state !== 'pending' && e.state !== 'failed')) return e;
    const { error: _, ...rest } = e;
    return { ...rest, state: 'not_done' as const };
  });
}

function startAnswer(state: ChatState): ChatState {
  return { ...state, streaming: true, status: null, answerId: null, tools: [] };
}

function endAnswer(state: ChatState): ChatState {
  return { ...state, streaming: false, status: null, answerId: null, tools: [] };
}

function add(state: ChatState, entry: Entry): ChatState {
  return { ...state, entries: cap([...state.entries, entry]), seq: state.seq + 1 };
}

type ConfirmEntry = Extract<Entry, { kind: 'confirm' }>;

/** Replaces one card (by id) with its next state; unchanged when there is no such card or `change` says no. */
function withCard(state: ChatState, id: string, change: (card: ConfirmEntry) => ConfirmEntry | null): ChatState {
  const at = state.entries.findIndex((e) => e.id === id);
  const card = state.entries[at];
  if (!card || card.kind !== 'confirm') return state;
  const next = change(card);
  if (!next) return state;
  return { ...state, entries: state.entries.map((e, i) => (i === at ? next : e)) };
}

/** A card answered: its new state, and the assistant's short follow-up (no model call). */
function answerCard(state: ChatState, id: string, from: ConfirmState[], to: ConfirmState, say: (title: string) => string) {
  let title: string | null = null;
  const next = withCard(state, id, (card) => {
    if (!from.includes(card.state)) return null;
    title = card.target.title;
    const { error: _, ...rest } = card;
    return { ...rest, state: to };
  });
  return title === null ? state : add(next, { kind: 'assistant', id: String(next.seq), text: cut(say(title)) });
}

function onEvent(state: ChatState, event: ChatEvent): ChatState {
  const id = String(state.seq);
  switch (event.type) {
    case 'notice':
      return { ...state, notice: event.message };
    case 'status':
      return { ...state, status: event.text, tools: [...state.tools, event.tool] };
    case 'text': {
      const last = state.entries[state.entries.length - 1];
      if (last && last.kind === 'assistant' && last.id === state.answerId) {
        const entries = [...state.entries.slice(0, -1), { ...last, text: cut(last.text + event.text) }];
        return { ...state, entries, status: null };
      }
      // A new piece after a card starts its own bubble; the server's paragraph break is dropped.
      const text = cut(event.text.replace(/^\s+/, ''));
      if (!text) return state;
      return { ...add(state, { kind: 'assistant', id, text }), status: null, answerId: id };
    }
    case 'confirm':
      return add(state, {
        kind: 'confirm',
        id,
        tool: event.tool,
        args: event.args,
        target: event.target,
        message: event.message,
        confirmLabel: event.confirm_label,
        cancelLabel: event.cancel_label,
        state: 'pending',
      });
    case 'vault':
      return add(state, {
        kind: 'vault',
        id,
        action: event.action,
        secretId: event.secret_id,
        name: event.name,
        ...(event.secret_type ? { secretType: event.secret_type } : {}),
        ...(event.new_secret ? { newSecret: true as const } : {}),
      });
    case 'error': {
      const partial = event.code === 'connection' && state.tools.some((t) => !READ_ONLY_TOOLS.has(t));
      const entry: Entry = {
        kind: 'error',
        id,
        code: event.code,
        message: event.message,
        buttons: errorButtons(event.code),
        ...(partial ? { note: PARTIAL_NOTE } : {}),
      };
      const next = { ...add(state, entry), status: null };
      return event.code === 'allowance_used' ? { ...next, blocked: event.message } : next;
    }
    case 'done':
      return endAnswer(state);
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send': {
      const text = cut(action.text.trim());
      if (!text || !canSend(state)) return state;
      return startAnswer(add({ ...state, entries: moveOn(state.entries) }, { kind: 'user', id: String(state.seq), text }));
    }
    case 'lookup': {
      const text = cut(action.text.trim());
      if (!text || !canLookup(state)) return state;
      const { route } = action;
      let next = add({ ...state, entries: moveOn(state.entries) }, { kind: 'user', id: String(state.seq), text });
      next = add(next, { kind: 'assistant', id: String(next.seq), text: cut(lookupMessage(route)) });
      if (route.to === 'secret') {
        // Id, name and kind only: no link, no address (CLAUDE.md rule 1).
        const { id, name, secretType } = route.secret;
        next = add(next, { kind: 'vault', id: String(next.seq), action: 'reveal', secretId: id, name, ...(secretType ? { secretType } : {}) });
      }
      return next;
    }
    case 'event':
      // Anything arriving after Stop belongs to an abandoned answer.
      return state.streaming ? onEvent(state, action.event) : state;
    case 'stop':
      return state.streaming ? endAnswer(state) : state;
    case 'retry': {
      const last = state.entries[state.entries.length - 1];
      if (state.streaming || !last || last.kind !== 'error' || !last.buttons.includes('try_again')) return state;
      return startAnswer({ ...state, entries: state.entries.slice(0, -1) });
    }
    case 'dismiss_notice':
      return { ...state, noticeDismissed: action.month };
    case 'load':
      return initialChat(action.entries, action.noticeDismissed);
    case 'clear':
      return { ...initialChat([], state.noticeDismissed), notice: state.notice, blocked: state.blocked };
    case 'confirm_start': {
      const card = state.entries.find((e) => e.id === action.id);
      // Only once (a second tap finds it running), and only for a card the app accepts.
      if (!card || !cardActive(state, card)) return state;
      return withCard(state, action.id, (c) => {
        const { error: _, ...rest } = c;
        return { ...rest, state: 'running' };
      });
    }
    case 'confirm_done':
      return answerCard(state, action.id, ['running'], 'deleted', deletedMessage);
    case 'confirm_failed':
      return withCard(state, action.id, (c) => (c.state === 'running' ? { ...c, state: 'failed', error: cut(action.error) } : null));
    case 'confirm_cancel': {
      const card = state.entries.find((e) => e.id === action.id);
      if (!card || card.kind !== 'confirm' || state.streaming) return state;
      return answerCard(state, action.id, ['pending', 'failed'], 'cancelled', cancelledMessage);
    }
  }
}
