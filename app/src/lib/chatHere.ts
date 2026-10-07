// 📍 "Send where I am" in the chat's ＋ menu (docs/places-plan.md step 7; it was a button by the box
// until the UI tidy-up's plan step 5): "near me" with the phone's location. A tap reads the location once (whereAmI: the Save where I am permission, asked only on that tap)
// and keeps it for the next message only; a tap while it is on removes it without reading again.
// Nothing here runs at start-up, and the location is never saved with the thread.

import type { SharedPoint } from './chatClient';
import type { ChatAction, ChatState } from './chatThread';
import { whereAmI, type LocationDeps } from './location';

/** What the 📍 holds between taps: nothing, the location for the next message, or why not. */
export type PinState = { here: SharedPoint } | { error: string } | null;

/** A tap on 📍: on (one reading) or, when already on, off. */
export async function tapPin(current: PinState, deps: LocationDeps): Promise<PinState> {
  if (current && 'here' in current) return null;
  const out = await whereAmI(deps);
  if ('error' in out) return { error: out.error };
  return { here: { lat: out.here.lat, lng: out.here.lng } };
}

/** The location to send with the message being sent now, if 📍 is on. */
export const pinPoint = (p: PinState): SharedPoint | undefined => (p && 'here' in p ? p.here : undefined);

export const PIN_ON = '📍 Your location goes with your next message, to find saved places near you.';
export const LOCATING = 'Finding where you are…';

/** The one status chip above the chat box (docs/ui-review.md, plan step 5): what matters most now. */
export interface Chip {
  text: string;
  tone: 'muted' | 'warn' | 'danger';
  /** What its ✕ clears: the 📍 (on, or its error), or the mic's error. None: no ✕. */
  clears?: 'pin' | 'mic';
}

/** Used up > finding the location / its error > 📍 on > the mic's error. */
export function chatChip(s: { blocked: string | null; locating: boolean; pin: PinState; micError: string | null }): Chip | null {
  if (s.blocked) return { text: s.blocked, tone: 'danger' };
  if (s.locating) return { text: LOCATING, tone: 'muted' };
  if (s.pin && 'error' in s.pin) return { text: s.pin.error, tone: 'warn', clears: 'pin' };
  if (pinPoint(s.pin)) return { text: PIN_ON, tone: 'muted', clears: 'pin' };
  if (s.micError) return { text: s.micError, tone: 'warn', clears: 'mic' };
  return null;
}

/**
 * "📍 Share where I am" on Wilma's card (places step 8, Q11): one reading of the location on the
 * tap (the same permission as above, asked only then), and on success the card's question is
 * returned with the point, for the caller to send again to Wilma for that message only. Nothing
 * is read for a card that cannot be tapped now; `live` says whether the result still belongs to
 * the same account's thread (signed out meanwhile: dropped).
 */
export async function shareFromCard(
  current: () => ChatState,
  act: (action: ChatAction) => ChatState,
  id: string,
  deps: LocationDeps,
  live: () => boolean = () => true,
): Promise<{ question: string; here: SharedPoint } | null> {
  const before = current();
  const next = act({ type: 'location_start', id });
  const card = next.entries.find((e) => e.id === id);
  if (next === before || !card || card.kind !== 'location' || card.state !== 'locating') return null;
  const out = await whereAmI(deps);
  if (!live()) return null;
  if ('error' in out) {
    act({ type: 'location_failed', id, error: out.error });
    return null;
  }
  // Still waiting for this reading (not moved on meanwhile): done, and the question goes again.
  const after = act({ type: 'location_shared', id });
  const done = after.entries.find((e) => e.id === id);
  if (!done || done.kind !== 'location' || done.state !== 'shared') return null;
  return { question: card.question, here: { lat: out.here.lat, lng: out.here.lng } };
}

/** Wilma's "📍 Share where I am" card: what it says, and its line once answered. */
export const LOCATION_ASK = 'Share where you are, once, to find saved places near you. It goes with this one question and is not saved.';
export const LOCATION_DONE: Record<'shared' | 'dismissed' | 'not_done', string> = {
  shared: 'Shared where you were, for that question only',
  dismissed: 'Not now',
  not_done: 'Location not shared',
};
