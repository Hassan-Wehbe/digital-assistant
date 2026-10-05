// The conversation with Wilma for the whole app (docs/phase5-a5c-chat-screen-plan.md "Where the
// state lives"): kept here, not in the screen, so opening another screen and coming back, or
// switching apps while an answer streams, keeps the thread and the running request.
//
// The thread is read from the phone when an account signs in, saved after each finished answer
// (not on every piece of text), and dropped with the running request on sign-out.
//
// A delete card's Delete runs that one delete here, through the existing client methods and only
// as chatDeletes.ts allows; nothing else from the stream is ever run.
//
// A message first goes through the router (chatRoute.ts, docs/phase5-a5d-one-box-plan.md): the
// exact name of one space or secret is answered here with no model call; anything else goes to
// Wilma. Lookups also work when the month's allowance is used up.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { routeMessage } from './chatRoute';
import type { Route } from './router';
import { runConfirm, runTurn } from './chatRun';
import { threadsToKeep } from './chatStore';
import { canLookup, chatReducer, initialChat, monthKey, noticeVisible, type ChatAction, type ChatState } from './chatThread';
import { deviceChatStore } from './deviceStorage';
import { useVault } from './vault';

/** What happened to a message, so the screen can follow it. */
export type SendOutcome =
  /** Sent to Wilma: her answer streams into the thread. */
  | { to: 'wilma' }
  /** The name of a space: the screen opens it (the thread has a short line). */
  | { to: 'space'; id: string; path: string }
  /** The name of a secret: its vault card is in the thread. */
  | { to: 'secret' }
  /** For Wilma, but this month's allowance is used up: nothing was sent (`state.blocked` says why). */
  | { to: 'blocked' }
  /** Nothing happened (empty, not ready, or busy). */
  | { to: 'none' };

interface ChatContextValue {
  state: ChatState;
  /** False until this account's saved thread has been read. */
  ready: boolean;
  /** The box can send now (also when the allowance is used up: lookups still work). */
  canSend: boolean;
  /** The allowance banner shows this month. */
  bannerVisible: boolean;
  /** Routes the message (a lookup, or Wilma) and says what happened. */
  send(text: string): Promise<SendOutcome>;
  stop(): void;
  /** Try again after a connection error: re-sends the last message. */
  retry(): void;
  dismissBanner(): void;
  /** "New conversation": stops any answer and empties the thread. */
  clear(): void;
  /** Delete tapped on a card: runs its one delete (once, however often it is tapped). */
  confirmDelete(id: string): void;
  /** Cancel tapped on a card: nothing runs. */
  cancelDelete(id: string): void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { session, chat, wilma, signOut, signedIn, loading } = useAuth();
  const { remove: removeSecret } = useVault();
  const userId = session?.user.id ?? null;

  // The reducer runs here (not in useReducer) so a send knows the thread it is sending at once.
  const [state, setState] = useState<ChatState>(() => initialChat());
  const current = useRef(state);
  const act = useCallback((action: ChatAction) => {
    current.current = chatReducer(current.current, action);
    setState(current.current);
    return current.current;
  }, []);

  // A message being routed (its names read from the server): a second Send waits for it.
  const routing = useRef(false);
  const [routingNow, setRoutingNow] = useState(false);

  const request = useRef<AbortController | null>(null);
  const abort = useCallback(() => {
    request.current?.abort();
    request.current = null;
  }, []);

  // The account whose saved thread has been read into memory; the thread is ready (shown,
  // sendable, saved) only while this is the signed-in account.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const user = useRef(userId);

  useEffect(() => {
    user.current = userId;
    abort();
    // Another account, or signed out: nothing of the previous thread stays in memory.
    act({ type: 'load', entries: [], noticeDismissed: null });
    if (!userId) return;
    let live = true;
    deviceChatStore.load(userId).then((saved) => {
      if (!live) return;
      act({ type: 'load', entries: saved.entries, noticeDismissed: saved.noticeDismissed });
      setLoadedFor(userId);
    });
    return () => {
      live = false;
      setLoadedFor(null);
    };
  }, [userId, abort, act]);

  // Writes to the phone run one after another, so forgetting on sign-out always comes after a
  // save that was still under way (and cannot be undone by it).
  const writes = useRef<Promise<void>>(Promise.resolve());
  const queue = useCallback((write: () => Promise<void>) => {
    writes.current = writes.current.then(write).catch(() => {});
  }, []);

  // Saved after each finished answer and each change between answers; never mid-answer, and
  // never before this account's saved thread was read (that would overwrite it).
  useEffect(() => {
    if (state.streaming || !loadedFor || loadedFor !== user.current) return;
    const saved = { entries: state.entries, noticeDismissed: state.noticeDismissed };
    queue(() => deviceChatStore.save(loadedFor, saved));
  }, [state.streaming, state.entries, state.noticeDismissed, loadedFor, queue]);

  // Signed out or another account: forget the other threads after any save in progress
  // (AuthProvider does the same at once; this one runs after this provider's own writes).
  const keep = threadsToKeep(loading, signedIn, userId);
  useEffect(() => {
    if (keep !== undefined) queue(() => deviceChatStore.forgetOthers(keep));
  }, [keep, queue]);

  const start = useCallback(
    (entries: ChatState['entries']) => {
      const controller = new AbortController();
      request.current = controller;
      const forUser = user.current;
      runTurn(chat.send, entries, controller.signal, (a) => {
        // An answer for an account that has since signed out is dropped.
        if (user.current === forUser && !controller.signal.aborted) act(a);
      }).then((end) => {
        if (request.current === controller) request.current = null;
        if (end === 'signed_out') signOut();
      });
    },
    [chat, act, signOut],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      ready: loadedFor !== null && loadedFor === userId,
      canSend: canLookup(state) && !routingNow && loadedFor !== null && loadedFor === userId,
      bannerVisible: noticeVisible(state, monthKey(new Date())),
      async send(text) {
        const none: SendOutcome = { to: 'none' };
        if (!loadedFor || loadedFor !== userId || routing.current || !text.trim() || !canLookup(current.current)) return none;
        const forUser = user.current;
        routing.current = true;
        setRoutingNow(true);
        let route: Route;
        try {
          route = await routeMessage(text, {
            spaces: wilma.listSpaces,
            findSecrets: (query) => wilma.findSecrets({ query }),
          });
        } finally {
          routing.current = false;
          setRoutingNow(false);
        }
        // Signed out or another account while the names were read: nothing is written.
        if (user.current !== forUser) return none;
        const before = current.current;
        if (route.to !== 'wilma') {
          if (act({ type: 'lookup', text, route }) === before) return none;
          return route.to === 'space' ? { to: 'space', id: route.space.id, path: route.space.path } : { to: 'secret' };
        }
        if (before.blocked !== null) return { to: 'blocked' };
        const next = act({ type: 'send', text });
        if (next === before) return none;
        start(next.entries);
        return { to: 'wilma' };
      },
      stop() {
        abort();
        act({ type: 'stop' });
      },
      retry() {
        const before = current.current;
        const next = act({ type: 'retry' });
        if (next !== before) start(next.entries);
      },
      dismissBanner() {
        act({ type: 'dismiss_notice', month: monthKey(new Date()) });
      },
      clear() {
        abort();
        act({ type: 'clear' });
      },
      confirmDelete(id) {
        if (!loadedFor || loadedFor !== userId) return;
        const forUser = user.current;
        const runners = {
          deleteItem: wilma.deleteItem,
          purgeItem: wilma.purgeItem,
          deleteSpace: wilma.deleteSpace,
          deleteAttachment: wilma.deleteAttachment,
          removeSecret,
        };
        runConfirm(() => current.current, act, id, runners, () => user.current === forUser).then((end) => {
          if (end === 'signed_out') signOut();
        });
      },
      cancelDelete(id) {
        act({ type: 'confirm_cancel', id });
      },
    }),
    [state, routingNow, loadedFor, userId, act, start, abort, wilma, removeSecret, signOut],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
