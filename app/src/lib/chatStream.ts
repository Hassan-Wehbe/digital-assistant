// Reads the `chat` function's answer: newline-delimited JSON, one event per line, the answer
// always ending with `done` (docs/phase5-a5b-chat-function-plan.md "As built: step 3"). After
// `done`, only `remembered` may still come (automatic memory, docs/memory-plan.md step 2): it is
// read while the server keeps the stream open, and anything else after `done` is ignored. Pure logic:
// the caller hands in the response body's reader (or any chunks), so the tests need no phone.
//
// Lines that are not valid JSON and event types this app does not know are skipped, so the
// server can add events later without breaking older app versions. A stream that ends (or
// breaks) without `done` becomes the usual "trouble connecting" error. A vault event's `link`
// is dropped here, as it is read: the app opens its own vault screen and never keeps the link.

import { toRemembered, type RememberedMemory } from './memory';

/** The server's own wording for a lost connection (supabase/functions/chat/messages.ts). */
export const CONNECTION_MESSAGE = "I'm having trouble connecting. Try again in a moment.";

export type ChatEvent =
  | { type: 'notice'; code: string; message: string }
  | { type: 'status'; tool: string; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'confirm';
      tool: string;
      args: Record<string, unknown>;
      target: { id: string; title: string };
      message: string;
      confirm_label: string;
      cancel_label: string;
    }
  | {
      type: 'vault';
      action: 'reveal' | 'enter';
      secret_id: string;
      name: string;
      secret_type?: string;
      /** The id is for a secret that exists only once its value is entered (save_secret). */
      new_secret?: true;
    }
  /** Place cards for Wilma's answer (places step 8; the server checked every place as the user). */
  | { type: 'places'; cards: PlaceCardData[] }
  /** Wilma asks for the location: the "📍 Share where I am" card. */
  | { type: 'location_request' }
  /** Wilma asks for these days of the phone's calendar (day planner step 1): the app reads the
   * ticked calendars and sends the question again with them (chat.tsx). */
  | { type: 'agenda_request'; from: string; to: string }
  /** The answer used a day plan (day planner step 3): the app shows Open my day for that date. */
  | { type: 'day_plan'; date: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; counted: boolean }
  /** After `done`: what Wilma kept from this message (memory on): "🧠 Remembered · Undo". */
  | { type: 'remembered'; memories: RememberedMemory[] };

/** One place card as the server sends it. `distance` is measured by the server, in the user's unit. */
export interface PlaceCardData {
  id: string;
  title: string;
  kind?: string;
  cuisine: string[];
  address?: string;
  maps_url?: string;
  lat?: number;
  lng?: number;
  distance?: { value: number; unit: 'mi' | 'km' };
}

/** The server sends at most 5 cards per answer; more is never shown. */
export const MAX_PLACE_CARDS = 5;

/** A response body reader, or any source of byte chunks (tests). */
export type ChunkSource = Pick<ReadableStreamDefaultReader<Uint8Array>, 'read' | 'cancel'> | AsyncIterable<Uint8Array>;

const str = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const short = (v: unknown, max: number): v is string => str(v) && v.trim().length > 0 && v.length <= max;
const isDay = (v: unknown): v is string => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const inRange = (v: unknown, limit: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;

/** One card, copied field by field; null without an id and a name. */
export function toPlaceCard(raw: unknown): PlaceCardData | null {
  if (!isObject(raw) || !short(raw.id, 100) || !short(raw.title, 500)) return null;
  const d = raw.distance;
  const cuisine = Array.isArray(raw.cuisine) ? raw.cuisine.filter((c): c is string => short(c, 40)).slice(0, 10) : [];
  const located = inRange(raw.lat, 90) && inRange(raw.lng, 180);
  return {
    id: raw.id,
    title: raw.title,
    ...(short(raw.kind, 40) ? { kind: raw.kind } : {}),
    cuisine,
    ...(short(raw.address, 300) ? { address: raw.address } : {}),
    ...(short(raw.maps_url, 500) ? { maps_url: raw.maps_url } : {}),
    ...(located ? { lat: raw.lat as number, lng: raw.lng as number } : {}),
    ...(isObject(d) && typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0 && (d.unit === 'mi' || d.unit === 'km')
      ? { distance: { value: d.value, unit: d.unit } }
      : {}),
  };
}

/** One parsed line → a known, well-formed event (copied field by field), or null. */
export function toChatEvent(raw: unknown): ChatEvent | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'notice':
    case 'error':
      return str(raw.code) && str(raw.message) ? { type: raw.type, code: raw.code, message: raw.message } : null;
    case 'status':
      return str(raw.tool) && str(raw.text) ? { type: 'status', tool: raw.tool, text: raw.text } : null;
    case 'text':
      return str(raw.text) ? { type: 'text', text: raw.text } : null;
    case 'confirm': {
      const t = raw.target;
      if (!str(raw.tool) || !isObject(raw.args) || !isObject(t) || !str(t.id) || !str(t.title)) return null;
      if (!str(raw.message) || !str(raw.confirm_label) || !str(raw.cancel_label)) return null;
      return {
        type: 'confirm',
        tool: raw.tool,
        args: { ...raw.args },
        target: { id: t.id, title: t.title },
        message: raw.message,
        confirm_label: raw.confirm_label,
        cancel_label: raw.cancel_label,
      };
    }
    case 'vault':
      // `link` and `expires_at` are deliberately not copied (CLAUDE.md rule 1).
      if ((raw.action !== 'reveal' && raw.action !== 'enter') || !str(raw.secret_id) || !str(raw.name)) return null;
      return {
        type: 'vault',
        action: raw.action,
        secret_id: raw.secret_id,
        name: raw.name,
        ...(str(raw.secret_type) ? { secret_type: raw.secret_type } : {}),
        ...(raw.new_secret === true ? { new_secret: true as const } : {}),
      };
    case 'places': {
      if (!Array.isArray(raw.cards)) return null;
      const cards = raw.cards.map(toPlaceCard).filter((c): c is PlaceCardData => c !== null).slice(0, MAX_PLACE_CARDS);
      return cards.length ? { type: 'places', cards } : null;
    }
    case 'location_request':
      return { type: 'location_request' };
    case 'agenda_request':
      return isDay(raw.from) && isDay(raw.to) ? { type: 'agenda_request', from: raw.from, to: raw.to } : null;
    case 'day_plan':
      return isDay(raw.date) ? { type: 'day_plan', date: raw.date } : null;
    case 'done':
      return { type: 'done', counted: raw.counted === true };
    case 'remembered': {
      const memories = toRemembered(raw.memories);
      return memories.length ? { type: 'remembered', memories } : null;
    }
    default:
      return null;
  }
}

function parseLine(line: string): ChatEvent | null {
  if (!line.trim()) return null;
  try {
    return toChatEvent(JSON.parse(line));
  } catch {
    return null;
  }
}

function chunksOf(source: ChunkSource): { next(): Promise<Uint8Array | null>; stop(): void } {
  if (Symbol.asyncIterator in source) {
    const it = source[Symbol.asyncIterator]();
    return {
      next: async () => {
        const r = await it.next();
        return r.done ? null : r.value;
      },
      stop: () => void it.return?.()?.catch(() => {}),
    };
  }
  return {
    next: async () => {
      const r = await source.read();
      return r.done ? null : (r.value ?? new Uint8Array());
    },
    stop: () => void source.cancel().catch(() => {}),
  };
}

const connectionLost: ChatEvent[] = [
  { type: 'error', code: 'connection', message: CONNECTION_MESSAGE },
  { type: 'done', counted: false },
];

/**
 * The events of one answer, in order. Always yields `done`, unless `signal` was aborted (Stop,
 * leaving, signing out): then it simply stops, without an error. After `done` it goes on only
 * for `remembered` events, until the server closes the stream (a break or an end there is
 * quiet: the answer is complete). A caller that stops at `done` simply never sees them.
 */
export async function* readChatEvents(source: ChunkSource, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const chunks = chunksOf(source);
  const decoder = new TextDecoder('utf-8');
  let buffered = '';
  let done = false;
  try {
    while (true) {
      if (signal?.aborted) return;
      let chunk: Uint8Array | null;
      try {
        chunk = await chunks.next();
      } catch {
        if (signal?.aborted || done) return;
        yield* connectionLost;
        return;
      }
      if (signal?.aborted) return;
      // `stream: true` keeps a character split across two chunks (é, an Arabic letter) intact.
      buffered += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
      const lines = buffered.split('\n');
      buffered = chunk ? lines.pop()! : '';
      for (const line of lines) {
        const event = parseLine(line);
        if (!event) continue;
        if (done && event.type !== 'remembered') continue;
        if (!done && event.type === 'remembered') continue; // only ever after the answer
        yield event;
        if (event.type === 'done') done = true;
        if (signal?.aborted) return;
      }
      if (!chunk) {
        if (!done) yield* connectionLost;
        return;
      }
    }
  } finally {
    chunks.stop();
  }
}
