// Where the chat thread lives on the phone (docs/phase5-a5c-chat-screen-plan.md "The thread on
// the phone"): encrypted per account, with the same mechanism as the sign-in session
// (sessionStorage.ts), because the thread can hold note contents Wilma read out.
//
// One saved thread per account, under `wilma.chat.<userId>`. A thread is only ever read back
// for the account that wrote it, is cleared on sign-out and when another account signs in, and
// anything unreadable or malformed opens as an empty thread rather than crashing.
//
// The pieces are passed in so the logic can be unit-tested without a phone.

import { errorButtons, MAX_ENTRIES, MAX_TEXT, PARTIAL_NOTE, type ConfirmState, type Entry } from './chatThread';
import type { AuthStorage } from './sessionStorage';

const PREFIX = 'wilma.chat.';
export const threadKey = (userId: string) => `${PREFIX}${userId}`;

/** What is kept between app launches. Status lines and the banner text are never saved. */
export interface SavedChat {
  entries: Entry[];
  /** The month ("2026-10") in which the allowance banner was dismissed. */
  noticeDismissed: string | null;
}

export const EMPTY_CHAT: SavedChat = { entries: [], noticeDismissed: null };

export interface ChatStore {
  load(userId: string): Promise<SavedChat>;
  save(userId: string, chat: SavedChat): Promise<void>;
  /** Forgets this account's thread ("New conversation" saves an empty one instead, keeping the banner choice). */
  clear(userId: string): Promise<void>;
  /** Forgets every saved thread except the signed-in account's (all of them when signed out). */
  forgetOthers(userId: string | null): Promise<void>;
}

const str = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cut = (text: string) => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
const CONFIRM_STATES: ConfirmState[] = ['pending', 'running', 'deleted', 'cancelled', 'not_done', 'failed'];

/** A card saved while its delete was under way (the app closed): it may or may not have happened. */
export const INTERRUPTED = 'The app closed before this finished. Check whether it was deleted before trying again.';

/** One saved entry → a well-formed entry with only the known fields (texts cut), or null. */
export function toEntry(raw: unknown): Entry | null {
  if (!isObject(raw) || !str(raw.id)) return null;
  const id = raw.id;
  switch (raw.kind) {
    case 'user':
    case 'assistant':
      return str(raw.text) && raw.text ? { kind: raw.kind, id, text: cut(raw.text) } : null;
    case 'confirm': {
      const t = raw.target;
      if (!str(raw.tool) || !isObject(raw.args) || !isObject(t) || !str(t.id) || !str(t.title)) return null;
      if (!str(raw.message) || !str(raw.confirmLabel) || !str(raw.cancelLabel)) return null;
      if (!CONFIRM_STATES.includes(raw.state as ConfirmState)) return null;
      // Delete arguments are ids: anything that is not a string is dropped.
      const args = Object.fromEntries(Object.entries(raw.args).filter(([, v]) => str(v)));
      const interrupted = raw.state === 'running';
      const state = interrupted ? 'failed' : (raw.state as ConfirmState);
      const error = interrupted ? INTERRUPTED : state === 'failed' && str(raw.error) ? cut(raw.error) : null;
      return {
        kind: 'confirm',
        id,
        tool: raw.tool,
        args,
        target: { id: t.id, title: cut(t.title) },
        message: cut(raw.message),
        confirmLabel: raw.confirmLabel,
        cancelLabel: raw.cancelLabel,
        state,
        ...(error ? { error } : {}),
      };
    }
    case 'vault':
      // Ids and names only, whatever else was written.
      if ((raw.action !== 'reveal' && raw.action !== 'enter') || !str(raw.secretId) || !str(raw.name)) return null;
      return {
        kind: 'vault',
        id,
        action: raw.action,
        secretId: raw.secretId,
        name: raw.name,
        ...(str(raw.secretType) ? { secretType: raw.secretType } : {}),
        ...(raw.newSecret === true ? { newSecret: true as const } : {}),
      };
    case 'error':
      if (!str(raw.code) || !str(raw.message)) return null;
      return {
        kind: 'error',
        id,
        code: raw.code,
        message: cut(raw.message),
        buttons: errorButtons(raw.code),
        ...(raw.note === PARTIAL_NOTE ? { note: PARTIAL_NOTE } : {}),
      };
    default:
      return null;
  }
}

function toSaved(entries: unknown, noticeDismissed: unknown): SavedChat {
  const list = Array.isArray(entries) ? entries.map(toEntry).filter((e): e is Entry => e !== null) : [];
  return {
    entries: list.slice(-MAX_ENTRIES),
    noticeDismissed: str(noticeDismissed) && /^\d{4}-\d{2}$/.test(noticeDismissed) ? noticeDismissed : null,
  };
}

/**
 * `storage` encrypts (encryptedStorage in sessionStorage.ts); `listKeys` lists the local
 * store's keys, so threads left behind by another account can be found and forgotten.
 */
export function chatStore(storage: AuthStorage, listKeys: () => Promise<string[]>): ChatStore {
  const clear = async (userId: string) => {
    await storage.removeItem(threadKey(userId)).catch(() => {});
  };

  return {
    async load(userId) {
      let text: string | null;
      try {
        text = await storage.getItem(threadKey(userId));
      } catch {
        return EMPTY_CHAT;
      }
      if (!text) return EMPTY_CHAT;
      try {
        const saved = JSON.parse(text);
        // Written for another account (it should never be under this key): never shown.
        if (!isObject(saved) || saved.user !== userId) throw new Error('not this account');
        return toSaved(saved.entries, saved.noticeDismissed);
      } catch {
        await clear(userId);
        return EMPTY_CHAT;
      }
    },
    async save(userId, chat) {
      const { entries, noticeDismissed } = toSaved(chat.entries, chat.noticeDismissed);
      await storage.setItem(threadKey(userId), JSON.stringify({ v: 1, user: userId, entries, noticeDismissed }));
    },
    clear,
    async forgetOthers(userId) {
      let keys: string[];
      try {
        keys = await listKeys();
      } catch {
        return;
      }
      const keep = userId ? threadKey(userId) : null;
      for (const key of keys) {
        if (key.startsWith(PREFIX) && key !== keep) await storage.removeItem(key).catch(() => {});
      }
    },
  };
}

/**
 * Which saved threads to forget when the sign-in changes, like the vault's kept key:
 * `undefined` = nothing to do; otherwise the account to keep (null = forget all).
 * While the saved session is still being read at launch the app only looks signed out, and
 * opened offline the session can be missing for a moment while still signed in: both keep
 * everything.
 */
export function threadsToKeep(loading: boolean, signedIn: boolean, userId: string | null): string | null | undefined {
  if (loading) return undefined;
  if (!signedIn) return null;
  return userId ?? undefined;
}
