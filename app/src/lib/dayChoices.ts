// What My day keeps on the phone (day planner step 2, Q7; docs/phase6-day-planner-step2-plan.md
// "How it works" 3 and 4), never on the server:
//
//   * choices: per day (today and tomorrow, Q5), the events done as one trip (Take both) and the
//     events not driven to (Not driving). A day's choices are dropped once it has passed.
//   * places: the user's answers per event title ("Dentist" is Dr. Lee's office; "Standup" is not
//     a trip), so they are asked once.
//   * drop_off: the event titles the user only drops off and picks up at (🚸; "Lexi school"), so
//     the plan has a drive at the start and one at the end, and free time between.
//   * found: where the phone's own geocoder found an event's location text (the same lookup as "Is
//     this it?"), so it is not looked up again each time My day opens.
//
// Never a plan: Mapbox's terms do not allow keeping Directions results, and nothing here holds a
// drive time, a leave-by time or the weather (the types below have no place for them). Kept per
// account, encrypted like the chat thread (chatStore.ts), and forgotten on sign-out.
import type { AuthStorage } from './sessionStorage';

const PREFIX = 'wilma.day.';
export const memoryKey = (userId: string) => `${PREFIX}${userId}`;

/** At most this many remembered titles and looked-up texts (the oldest go first). */
export const MAX_REMEMBERED = 200;
const MAX_KEY = 300;
const MAX_LABEL = 200;

export interface DayChoice {
  date: string;
  /** Events done as one trip (Take both), by the app's event key. */
  together: string[][];
  /** Events the user does not drive to. */
  not_driving: string[];
}

/** The user's answer for an event title: a place, or "not a trip". */
export type EventPlace = { lat: number; lng: number; label: string } | { not_a_trip: true };

/** The phone's geocoder result for a location text: a point, or nothing found. */
export type FoundPlace = { lat: number; lng: number } | { none: true };

export interface DayMemory {
  choices: DayChoice[];
  places: Record<string, EventPlace>;
  found: Record<string, FoundPlace>;
  /** Titles (textKey) the user drops off and picks up at. */
  drop_off: string[];
}

export const EMPTY_MEMORY: DayMemory = { choices: [], places: {}, found: {}, drop_off: [] };

/** "Dentist  " and "dentist" are the same title (and the same location text). */
export const textKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_KEY);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const key = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const onMap = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function toChoice(raw: unknown): DayChoice | null {
  if (!isObject(raw) || !isDay(raw.date)) return null;
  const together = (Array.isArray(raw.together) ? raw.together : [])
    .filter(Array.isArray)
    .map((g) => [...new Set((g as unknown[]).filter(key))].slice(0, 6))
    .filter((g) => g.length >= 2)
    .slice(0, 20);
  const notDriving = [...new Set((Array.isArray(raw.not_driving) ? raw.not_driving : []).filter(key))].slice(0, 100);
  return { date: raw.date, together, not_driving: notDriving };
}

function toPlace(raw: unknown): EventPlace | null {
  if (!isObject(raw)) return null;
  if (raw.not_a_trip === true) return { not_a_trip: true };
  if (!onMap(raw.lat, raw.lng) || typeof raw.label !== 'string' || !raw.label.trim()) return null;
  return { lat: raw.lat as number, lng: raw.lng as number, label: raw.label.trim().slice(0, MAX_LABEL) };
}

function toFound(raw: unknown): FoundPlace | null {
  if (!isObject(raw)) return null;
  if (raw.none === true) return { none: true };
  return onMap(raw.lat, raw.lng) ? { lat: raw.lat as number, lng: raw.lng as number } : null;
}

/** The newest `MAX_REMEMBERED` entries (objects keep the order they were written in). */
function newest<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED));
}

function checkedMap<T>(raw: unknown, check: (v: unknown) => T | null): Record<string, T> {
  if (!isObject(raw)) return {};
  return newest(
    Object.entries(raw)
      .filter(([k]) => k.length > 0 && k.length <= MAX_KEY)
      .map(([k, v]): [string, T | null] => [k, check(v)])
      .filter((e): e is [string, T] => e[1] !== null),
  );
}

/** The saved memory, checked: anything odd is dropped, and so are the choices of days before `today`. */
export function parseMemory(raw: unknown, today: string): DayMemory {
  if (!isObject(raw)) return EMPTY_MEMORY;
  const choices = (Array.isArray(raw.choices) ? raw.choices : [])
    .map(toChoice)
    .filter((c): c is DayChoice => c !== null && c.date >= today)
    .slice(0, 4);
  const dropOff = [...new Set((Array.isArray(raw.drop_off) ? raw.drop_off : []).filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY))];
  return { choices, places: checkedMap(raw.places, toPlace), found: checkedMap(raw.found, toFound), drop_off: dropOff.slice(-MAX_REMEMBERED) };
}

// ---- Changes (pure) ----------------------------------------------------------------------------

/** A day's choices as the planner takes them (event keys). */
export function choicesFor(m: DayMemory, date: string): { together?: string[][]; not_driving?: string[] } {
  const c = m.choices.find((x) => x.date === date);
  if (!c) return {};
  return { ...(c.together.length ? { together: c.together } : {}), ...(c.not_driving.length ? { not_driving: c.not_driving } : {}) };
}

function withChoice(m: DayMemory, date: string, change: (c: DayChoice) => DayChoice): DayMemory {
  const before = m.choices.find((x) => x.date === date) ?? { date, together: [], not_driving: [] };
  const after = change(before);
  const rest = m.choices.filter((x) => x.date !== date);
  const empty = !after.together.length && !after.not_driving.length;
  return { ...m, choices: empty ? rest : [...rest, after] };
}

/** Take both: these events become one trip (joined with any trip either is already in). */
export function takeBoth(m: DayMemory, date: string, keys: string[]): DayMemory {
  return withChoice(m, date, (c) => {
    const joined = new Set(keys);
    const rest: string[][] = [];
    for (const g of c.together) {
      if (g.some((k) => joined.has(k))) g.forEach((k) => joined.add(k));
      else rest.push(g);
    }
    // The server takes at most 20 trips of at most 6 events (chat/agenda.ts choicesSchema).
    return { ...c, together: (joined.size >= 2 ? [...rest, [...joined].slice(0, 6)] : rest).slice(-20) };
  });
}

/** Undo Take both for the trip this event is in. */
export function separate(m: DayMemory, date: string, eventKey: string): DayMemory {
  return withChoice(m, date, (c) => ({ ...c, together: c.together.filter((g) => !g.includes(eventKey)) }));
}

/** Not driving on, or off again. */
export function toggleNotDriving(m: DayMemory, date: string, eventKey: string): DayMemory {
  return withChoice(m, date, (c) => ({
    ...c,
    not_driving: c.not_driving.includes(eventKey) ? c.not_driving.filter((k) => k !== eventKey) : [...c.not_driving, eventKey].slice(-100),
  }));
}

/** Start over: the day's choices go. */
export function resetChoices(m: DayMemory, date: string): DayMemory {
  return { ...m, choices: m.choices.filter((x) => x.date !== date) };
}

/** The user's answer for an event title ("Where is this?", "Not a trip", "Is this right?" → Yes). */
export function answerPlace(m: DayMemory, title: string, answer: EventPlace): DayMemory {
  const k = textKey(title);
  if (!k) return m;
  const checked = toPlace(answer);
  if (!checked) return m;
  const { [k]: _, ...rest } = m.places;
  return { ...m, places: newest([...Object.entries(rest), [k, checked]]) };
}

/** 🚸 Drop off & pick up for an event title, or back to staying there. */
export function toggleDropOff(m: DayMemory, title: string): DayMemory {
  const k = textKey(title);
  if (!k) return m;
  const on = m.drop_off.includes(k);
  return { ...m, drop_off: on ? m.drop_off.filter((x) => x !== k) : [...m.drop_off, k].slice(-MAX_REMEMBERED) };
}

export const isDropOff = (m: DayMemory, title: string) => m.drop_off.includes(textKey(title));

/** Forget the answer for a title (ask again). */
export function forgetPlace(m: DayMemory, title: string): DayMemory {
  const { [textKey(title)]: _, ...rest } = m.places;
  return { ...m, places: rest };
}

/** Geocoder results to remember (per location text). */
export function rememberFound(m: DayMemory, found: Record<string, FoundPlace>): DayMemory {
  const fresh = Object.entries(found).filter(([k, v]) => k && toFound(v));
  if (!fresh.length) return m;
  const keys = new Set(fresh.map(([k]) => k));
  return { ...m, found: newest([...Object.entries(m.found).filter(([k]) => !keys.has(k)), ...fresh]) };
}

// ---- On the phone ------------------------------------------------------------------------------

export interface DayMemoryStore {
  load(userId: string, today: string): Promise<DayMemory>;
  save(userId: string, memory: DayMemory): Promise<void>;
  /** Forgets every account's memory except the signed-in one (all of it when signed out). */
  forgetOthers(userId: string | null): Promise<void>;
}

/** `storage` encrypts (encryptedStorage in sessionStorage.ts), as for the chat thread. */
export function dayMemoryStore(storage: AuthStorage, listKeys: () => Promise<string[]>): DayMemoryStore {
  return {
    async load(userId, today) {
      try {
        const text = await storage.getItem(memoryKey(userId));
        if (!text) return EMPTY_MEMORY;
        const saved = JSON.parse(text) as unknown;
        if (!isObject(saved) || saved.user !== userId) return EMPTY_MEMORY;
        return parseMemory(saved, today);
      } catch {
        return EMPTY_MEMORY;
      }
    },
    async save(userId, memory) {
      // Only the three known parts are written, checked again, whatever else the object holds.
      const checked = parseMemory(memory, '0000-00-00');
      const { choices, places, found } = checked;
      await storage.setItem(memoryKey(userId), JSON.stringify({ v: 1, user: userId, choices, places, found }));
    },
    async forgetOthers(userId) {
      let keys: string[];
      try {
        keys = await listKeys();
      } catch {
        return;
      }
      const keep = userId ? memoryKey(userId) : null;
      for (const k of keys) {
        if (k.startsWith(PREFIX) && k !== keep) await storage.removeItem(k).catch(() => {});
      }
    },
  };
}
