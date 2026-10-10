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
// Wilma. Lookups also work when the month's allowance is used up. A short message that matches no
// name may be a search: the server's classifier decides (step 6), and the notes found are shown
// with "Ask Wilma instead". The classifier is not asked when the allowance is used up.
//
// A message sent with the 📍 location (places step 7) goes straight to Wilma, past the router and
// the classifier, and the location goes with that one message only. It is kept in memory just for
// Try again on that message, and is never saved with the thread. The same holds for Wilma's
// "📍 Share where I am" card (places step 8): one reading on the tap, then the card's question
// goes to Wilma again with the point.
//
// The phone's calendar (day planner step 1, "ask, then re-send"): when Wilma's answer ends with
// an `agenda_request`, the ticked calendars are read for those days (chatCalendar.ts) and the same
// question goes to Wilma again with them, once; when the calendar is off, not allowed or cannot be
// read, a card says why. The calendar lines are never kept: not in the thread, not on the phone.
// For one day ("plan my day"), the events go with the places the phone found for them and the
// day's choices from My day (dayAgenda.ts); an answer that used a day plan ends with Open my day.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { deviceCalendar, phoneTimeZone, readAgenda, type Agenda } from './calendar';
import { loadChoice } from './calendarSettings';
import type { SharedPoint } from './chatClient';
import { MAX_NOTES, routeMessage, type MessageRoute } from './chatRoute';
import { calendarFollowUp } from './chatCalendar';
import { agendaForChat, phoneGeocode } from './dayAgenda';
import { todayAndTomorrow } from './dayView';
import { shareFromCard } from './chatHere';
import { runConfirm, runTurn } from './chatRun';
import { threadsToKeep } from './chatStore';
import { findCredential } from './credentials';
import { canLookup, chatReducer, initialChat, monthKey, noticeVisible, type ChatAction, type ChatState } from './chatThread';
import { deviceChatStore, deviceDayMemory, deviceSettingsStore } from './deviceStorage';
import { deviceGeocoder, deviceLocation } from './location';
import { undoMemory } from './memory';
import { WilmaError } from './wilma';
import { useVault } from './vault';

/** What happened to a message, so the screen can follow it. */
export type SendOutcome =
  /** Sent to Wilma: her answer streams into the thread. */
  | { to: 'wilma' }
  /** The name of a space: the screen opens it (the thread has a short line). */
  | { to: 'space'; id: string; path: string }
  /** The name of a secret: its vault card is in the thread. */
  | { to: 'secret' }
  /** A search the classifier recognised: the notes card is in the thread. */
  | { to: 'notes' }
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
  /** A message is being routed (names read, maybe the classifier asked): Send waits. */
  routing: boolean;
  /** Routes the message (a lookup, a search, or Wilma) and says what happened. With `here` (📍),
   * it goes straight to Wilma with the location. */
  send(text: string, here?: SharedPoint): Promise<SendOutcome>;
  /** "Ask Wilma instead" on a notes card: sends that message to Wilma, past the router. */
  askWilma(text: string): Promise<SendOutcome>;
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
  /** "📍 Share where I am" tapped on Wilma's card: one reading, then the question again with it. */
  shareLocation(id: string): void;
  /** "Not now" tapped on that card. */
  dismissLocation(id: string): void;
  /** Undo on a "🧠 Remembered" line: that memory is deleted (or gets its old text back). False
   * when it did not work. */
  undoMemory(entryId: string, memoryId: string): Promise<boolean>;
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
  // The 📍 location of the last message sent to Wilma, for Try again on it. Memory only.
  const lastHere = useRef<SharedPoint | undefined>(undefined);
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
    lastHere.current = undefined;
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

  // start() calls itself again (through this ref) to send a question back with the calendar.
  const startRef = useRef<(entries: ChatState['entries'], here?: SharedPoint, agenda?: Agenda) => void>(() => {});
  const start = useCallback(
    (entries: ChatState['entries'], here?: SharedPoint, agenda?: Agenda) => {
      const controller = new AbortController();
      request.current = controller;
      lastHere.current = here;
      const forUser = user.current;
      let asked: { from: string; to: string } | null = null;
      runTurn(chat.send, entries, controller.signal, (a) => {
        if (a.type === 'event' && a.event.type === 'agenda_request') asked = { from: a.event.from, to: a.event.to };
        // An answer for an account that has since signed out is dropped.
        if (user.current === forUser && !controller.signal.aborted) act(a);
      }, here, agenda).then(async (end) => {
        if (request.current === controller) request.current = null;
        if (end === 'signed_out') return signOut();
        if (end !== 'done' || !asked || controller.signal.aborted || user.current !== forUser || !forUser) return;
        // Wilma asked for the calendar: read it, then the same question again (once).
        const question = current.current.entries.findLast((e) => e.kind === 'user');
        const out = await calendarFollowUp(asked, {
          choice: () => loadChoice(deviceSettingsStore, forUser),
          read: async (choice, from, to) => {
            const read = await readAgenda(deviceCalendar, choice, from, to, phoneTimeZone());
            if (!('agenda' in read)) return read;
            // One day ("plan my day"): with the places found on the phone and the day's choices
            // (Take both, Not driving), so the chat's plan matches My day.
            return {
              agenda: await agendaForChat(read.agenda, {
                load: () => deviceDayMemory.load(forUser, todayAndTomorrow(new Date()).today),
                save: (m) => deviceDayMemory.save(forUser, m),
                geocode: phoneGeocode(deviceGeocoder),
              }),
            };
          },
        }, !!agenda);
        // Signed out, a new message, or another answer started meanwhile: nothing more.
        if (user.current !== forUser || current.current.streaming || current.current.entries.findLast((e) => e.kind === 'user') !== question) return;
        if ('problem' in out) {
          act({ type: 'calendar_card', problem: out.problem });
          return;
        }
        const before = current.current;
        if (before.blocked !== null) return;
        const next = act({ type: 'resend' });
        if (next !== before) startRef.current(next.entries, here, out.agenda);
      });
    },
    [chat, act, signOut],
  );
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      ready: loadedFor !== null && loadedFor === userId,
      canSend: canLookup(state) && !routingNow && loadedFor !== null && loadedFor === userId,
      routing: routingNow,
      bannerVisible: noticeVisible(state, monthKey(new Date())),
      async send(text, here) {
        const none: SendOutcome = { to: 'none' };
        if (!loadedFor || loadedFor !== userId || routing.current || !text.trim() || !canLookup(current.current)) return none;
        // A password never leaves the phone, whichever screen sent it (plan step 4; the screens
        // show the card, this is the backstop).
        if (findCredential(text)) return none;
        if (here) {
          // "Near me": straight to Wilma. The router and the classifier never see the location.
          const before = current.current;
          if (before.blocked !== null) return { to: 'blocked' };
          const next = act({ type: 'send', text });
          if (next === before) return none;
          start(next.entries, here);
          return { to: 'wilma' };
        }
        const forUser = user.current;
        routing.current = true;
        setRoutingNow(true);
        let route: MessageRoute;
        // Used up this month: the classifier is not asked (it would cost, and answer Wilma anyway).
        const classifier = current.current.blocked === null
          ? {
            classify: chat.classify,
            searchNotes: (query: string) => wilma.search({ query, limit: MAX_NOTES, close_matches_only: true }),
          }
          : {};
        try {
          route = await routeMessage(text, {
            spaces: wilma.listSpaces,
            findSecrets: (query) => wilma.findSecrets({ query }),
            ...classifier,
          });
        } finally {
          routing.current = false;
          setRoutingNow(false);
        }
        // Signed out or another account while the names were read: nothing is written.
        if (user.current !== forUser) return none;
        const before = current.current;
        if (route.to === 'notes') {
          if (act({ type: 'notes', text, query: route.query, notes: route.notes }) === before) return none;
          return { to: 'notes' };
        }
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
      async askWilma(text) {
        const none: SendOutcome = { to: 'none' };
        if (!loadedFor || loadedFor !== userId || routing.current || !text.trim()) return none;
        if (findCredential(text)) return none;
        const before = current.current;
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
        if (next !== before) start(next.entries, lastHere.current);
      },
      dismissBanner() {
        act({ type: 'dismiss_notice', month: monthKey(new Date()) });
      },
      clear() {
        lastHere.current = undefined;
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
      shareLocation(id) {
        if (!loadedFor || loadedFor !== userId) return;
        const forUser = user.current;
        shareFromCard(() => current.current, act, id, deviceLocation, () => user.current === forUser).then((out) => {
          if (!out || user.current !== forUser || findCredential(out.question)) return;
          const before = current.current;
          if (before.blocked !== null) return;
          const next = act({ type: 'send', text: out.question });
          if (next !== before) start(next.entries, out.here);
        });
      },
      dismissLocation(id) {
        act({ type: 'location_dismiss', id });
      },
      async undoMemory(entryId, memoryId) {
        const card = current.current.entries.find((e) => e.id === entryId);
        const memory = card?.kind === 'memory' ? card.memories.find((m) => m.id === memoryId && !m.undone) : undefined;
        if (!memory) return false;
        const forUser = user.current;
        try {
          await undoMemory(wilma, memory);
        } catch (e) {
          if (e instanceof WilmaError && e.signedOut) signOut();
          return false;
        }
        if (user.current === forUser) act({ type: 'memory_undone', id: entryId, memoryId });
        return true;
      },
    }),
    [state, routingNow, loadedFor, userId, act, start, abort, wilma, chat, removeSecret, signOut],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
