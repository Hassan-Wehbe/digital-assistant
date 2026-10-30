// Find a place by name (docs/places-space-plan.md step 3, D45 Q9): New place's "Find it on the map"
// sends what the user types to the place-search function, which asks Google's Autocomplete and
// returns up to 5 suggestions (Google's id, the name, the address line, a kind when it is clear).
// Only the typed words are sent, never where the phone is. The spot of the one picked comes from
// the phone's own map lookup of its address (placeLookup.ts), as Google's terms let only the id be
// kept. Without the Google key, or after the day's limit (100 lookups, about 20 places), the
// server says so and the screen offers the phone's free lookup of a full street address instead.
import { SUPABASE_URL } from './config';
import { PLACE_KINDS, type PlaceKind } from './places';
import { WilmaError } from './wilma';

export const PLACE_SEARCH_URL = `${SUPABASE_URL}/functions/v1/place-search`;
/** Suggestions start after 3 letters and a short pause, so typing costs about 4-5 lookups a place. */
export const MIN_LETTERS = 3;
export const MAX_LETTERS = 120;
export const PAUSE_MS = 400;

export interface Suggestion {
  placeId: string;
  name: string;
  address: string;
  kind?: PlaceKind;
}

export type SearchAnswer =
  | { suggestions: Suggestion[] }
  /** The Google key is not set yet, or today's lookups are used up: offer the address lookup. */
  | { unavailable: 'not_set_up' | 'daily_limit' }
  /** Refused (a password-like text, too short or long), with the server's sentence; or no connection. */
  | { problem: 'refused'; message: string }
  | { problem: 'connection' };

export type JsonFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const SESSION_ENDED = 'Your session has ended. Please sign in again.';
const PLACE_ID = /^[A-Za-z0-9_-]{1,300}$/;

/** One id for one search (typing plus the pick), as Google bills a search; letters and digits only. */
export function newSearchSession(random: () => number = Math.random): string {
  let out = '';
  while (out.length < 32) out += Math.floor(random() * 36).toString(36);
  return out.slice(0, 32);
}

/** "12 Elm St, Miami": starts with a house number, so the phone's free lookup is enough. */
export function looksLikeStreetAddress(text: string): boolean {
  return /^\s*\d+[a-z]?\s+\S+/i.test(text);
}

const short = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** The server's answer, checked again: only well-formed suggestions, at most 5. */
export function readSearchAnswer(status: number, body: unknown): SearchAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (status === 200 && b.available === false) {
    return { unavailable: b.reason === 'daily_limit' ? 'daily_limit' : 'not_set_up' };
  }
  if (status === 200 && b.available === true && Array.isArray(b.suggestions)) {
    const suggestions: Suggestion[] = [];
    for (const raw of b.suggestions) {
      const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const placeId = typeof s.place_id === 'string' ? s.place_id : '';
      const name = short(s.name, 200);
      if (!PLACE_ID.test(placeId) || !name) continue;
      const kind = typeof s.kind === 'string' && (PLACE_KINDS as readonly string[]).includes(s.kind) ? (s.kind as PlaceKind) : undefined;
      suggestions.push({ placeId, name, address: short(s.address, 300), ...(kind ? { kind } : {}) });
      if (suggestions.length >= 5) break;
    }
    return { suggestions };
  }
  if (status === 400 && typeof b.error === 'string') return { problem: 'refused', message: b.error.slice(0, 200) };
  return { problem: 'connection' };
}

export function placeSearchClient({ url = PLACE_SEARCH_URL, token, refresh, fetch: f = fetch as unknown as JsonFetch }: {
  url?: string;
  token: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  fetch?: JsonFetch;
}) {
  /** Google's suggestions for `text`. Never throws except when the session has ended (a signed-out WilmaError). */
  async function search(text: string, session: string, signal?: AbortSignal): Promise<SearchAnswer> {
    const body = JSON.stringify({ text: text.trim().slice(0, MAX_LETTERS), session });
    const post = (accessToken: string) =>
      f(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body, signal });
    let accessToken = await token();
    if (!accessToken) throw new WilmaError('Please sign in again.', true);
    try {
      let res = await post(accessToken);
      if (res.status === 401) {
        accessToken = await refresh();
        if (!accessToken) throw new WilmaError(SESSION_ENDED, true);
        res = await post(accessToken);
        if (res.status === 401) throw new WilmaError(SESSION_ENDED, true);
      }
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // an unreadable body is a connection problem
      }
      return readSearchAnswer(res.status, parsed);
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      return { problem: 'connection' };
    }
  }
  return { search };
}

export type PlaceSearchClient = ReturnType<typeof placeSearchClient>;
