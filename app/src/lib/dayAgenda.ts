// The calendar for the day planner (day planner step 2, step 4): each event gets a key (so today's
// choices can name it), and a place found on the phone, as the plan describes ("How it works" 3):
//
//   1. the user's own answer for that event title ("Dentist" is Dr. Lee's office, or Not a trip);
//   2. a video call (a link, Zoom, Teams, Meet) is not a trip;
//   3. else the event's location text, looked up with the phone's geocoder (the same lookup as "Is
//      this it?"); a match for a text with no street number is marked "found by name only", so My
//      day asks "Is this right?". The server prefers a saved place named like the text over this.
//
// Only the location text goes to the geocoder, never the title (nor a text that looks like a password). The same events go to My day
// ({"mode":"day"}) and, for "plan my day" in the chat, with the re-sent agenda, where events are
// named "e0", "e1", ... by their order and the choices are renamed to match.
import type { Agenda, AgendaEvent } from './calendar';
import { findCredential } from './credentials';
import { choicesFor, rememberFound, textKey, type DayMemory, type FoundPlace } from './dayChoices';
import type { DayBody } from './dayPlan';
import type { GeocodeDeps } from './placeLookup';

export interface DayEvent extends AgendaEvent {
  key: string;
}

/** At most this many location texts are looked up per plan (the rest wait for the next open). */
export const MAX_LOOKUPS = 15;
export const GEOCODE_TIMEOUT_MS = 8_000;

/** FNV-1a, 32 bits, as hex: a short stable name for an event (not a secret, not a hash of one). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Keys for a day's events: the same event gets the same key each time the calendar is read. */
export function withKeys(events: AgendaEvent[]): DayEvent[] {
  const seen = new Map<string, number>();
  return events.map((e) => {
    const base = `k${fnv(`${e.calendar}\n${e.start}\n${e.end}\n${e.title}`)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...e, key: n ? `${base}-${n}` : base };
  });
}

/** A video call or a link, not a place to drive to. */
export function isOnline(location: string): boolean {
  return /^\s*(https?:\/\/|www\.)/i.test(location) || /\b(zoom|teams|google meet|meet\.google|webex|skype|video call|phone call)\b/i.test(location);
}

/** A location text with a street number reads as an address; without one it is a name only. */
export const looksLikeAddress = (text: string) => /\d/.test(text);

/** The phone's geocoder for one location text: a point, null (nothing found), or undefined (could not ask). */
export type Geocode = (text: string) => Promise<{ lat: number; lng: number } | null | undefined>;

/**
 * The phone's geocoder, only when the location permission is already given (My day never asks for
 * it by itself: the "Where is this?" and Home buttons do, on a tap).
 */
export function phoneGeocode(deps: Pick<GeocodeDeps, 'permission' | 'geocode'>, timeoutMs = GEOCODE_TIMEOUT_MS): Geocode {
  return async (text) => {
    try {
      if (!(await deps.permission()).granted) return undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<'late'>((done) => {
        timer = setTimeout(() => done('late'), timeoutMs);
      });
      const out = await Promise.race([deps.geocode(text.slice(0, 300)), late]).finally(() => clearTimeout(timer));
      if (out === 'late') return undefined;
      const first = Array.isArray(out) ? out[0] : undefined;
      if (!first) return null;
      const { latitude: lat, longitude: lng } = first;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    } catch {
      return undefined;
    }
  };
}

/**
 * The events with their places: `point` and `not_a_trip` as the planner takes them. Returns the
 * new geocoder results too, for the caller to remember (dayChoices.ts rememberFound).
 */
export async function placeEvents(
  events: DayEvent[],
  memory: DayMemory,
  geocode?: Geocode,
): Promise<{ events: DayEvent[]; found: Record<string, FoundPlace> }> {
  const found: Record<string, FoundPlace> = {};
  let lookups = 0;
  const out: DayEvent[] = [];
  for (const e of events) {
    const { point: _p, not_a_trip: _n, ...plain } = e;
    if (e.busy_only || e.all_day) {
      out.push(plain);
      continue;
    }
    const answer = memory.places[textKey(e.title)];
    if (answer) {
      out.push('not_a_trip' in answer ? { ...plain, not_a_trip: true } : { ...plain, point: { lat: answer.lat, lng: answer.lng } });
      continue;
    }
    const text = e.location?.trim() ?? '';
    if (!text) {
      out.push(plain);
      continue;
    }
    if (isOnline(text)) {
      out.push({ ...plain, not_a_trip: true });
      continue;
    }
    // Text that looks like a password never leaves the phone for a lookup (CLAUDE.md rule 1).
    if (findCredential(text)) {
      out.push(plain);
      continue;
    }
    const k = textKey(text);
    let hit: FoundPlace | undefined = memory.found[k] ?? found[k];
    if (!hit && geocode && lookups < MAX_LOOKUPS) {
      lookups += 1;
      const got = await geocode(text);
      if (got !== undefined) hit = found[k] = got ?? { none: true };
    }
    if (hit && !('none' in hit)) {
      out.push({ ...plain, point: { lat: hit.lat, lng: hit.lng, ...(looksLikeAddress(text) ? {} : { by_name_only: true as const }) } });
    } else out.push(plain);
  }
  return { events: out, found };
}

/** The My day request for one day: the events (with keys and places) and that day's choices. */
export function dayBody(date: string, tz: string, now: string | undefined, events: DayEvent[], memory: DayMemory): DayBody {
  const keys = new Set(events.map((e) => e.key));
  const c = choicesFor(memory, date);
  const together = c.together?.map((g) => g.filter((k) => keys.has(k))).filter((g) => g.length >= 2);
  const notDriving = c.not_driving?.filter((k) => keys.has(k));
  return {
    mode: 'day',
    date,
    tz,
    ...(now && now.startsWith(date) ? { now } : {}),
    events: events.map((e) => ({ ...e })),
    ...(together?.length || notDriving?.length
      ? { choices: { ...(together?.length ? { together } : {}), ...(notDriving?.length ? { not_driving: notDriving } : {}) } }
      : {}),
  };
}

/**
 * The agenda Wilma asked for, as re-sent in the chat. For one day ("plan my day") the events carry
 * their places and the day's choices come along, so the chat's plan has drive times for places the
 * phone found too; the server names the events "e0", "e1", ... in this order. Several days: as read.
 */
export async function chatAgenda(
  agenda: Agenda,
  memory: DayMemory,
  geocode?: Geocode,
): Promise<{ agenda: Agenda; found: Record<string, FoundPlace> }> {
  if (agenda.from !== agenda.to) return { agenda, found: {} };
  const keyed = withKeys(agenda.events);
  const { events, found } = await placeEvents(keyed, memory, geocode);
  const index = new Map(keyed.map((e, i) => [e.key, `e${i}`]));
  const c = choicesFor(memory, agenda.from);
  const together = c.together?.map((g) => g.flatMap((k) => index.get(k) ?? [])).filter((g) => g.length >= 2);
  const notDriving = c.not_driving?.flatMap((k) => index.get(k) ?? []);
  const choices = {
    ...(together?.length ? { together } : {}),
    ...(notDriving?.length ? { not_driving: notDriving } : {}),
  };
  return {
    agenda: {
      ...agenda,
      events: events.map(({ key: _, ...e }) => e),
      ...(Object.keys(choices).length ? { choices } : {}),
    },
    found,
  };
}

export interface ChatAgendaDeps {
  load: () => Promise<DayMemory>;
  save: (memory: DayMemory) => Promise<void>;
  geocode?: Geocode;
}

/**
 * chatAgenda with the phone's memory: loaded, used, and the new geocoder results saved. Any
 * failure sends the agenda as read (the chat's plan then finds places by saved-place name only).
 */
export async function agendaForChat(agenda: Agenda, deps: ChatAgendaDeps): Promise<Agenda> {
  if (agenda.from !== agenda.to) return agenda;
  try {
    const memory = await deps.load();
    const out = await chatAgenda(agenda, memory, deps.geocode);
    if (Object.keys(out.found).length) await deps.save(rememberFound(memory, out.found)).catch(() => {});
    return out.agenda;
  } catch {
    return agenda;
  }
}
