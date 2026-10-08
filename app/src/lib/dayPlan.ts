// My day (day planner step 2, step 4; docs/phase6-day-planner-step2-plan.md): the plan the `chat`
// function's day route answers ({"mode":"day"}; supabase/functions/chat/day.ts), checked here field
// by field, and the client that asks for it. No model is called and no AI request is counted.
//
// The plan is kept only in memory while My day is open: Mapbox's terms do not allow storing its
// Directions results, so nothing here writes a plan anywhere (not on the phone, not in the chat
// thread). Above the fair-use limit, "the last plan" is the one still on screen.
//
// The client takes the token, refresh and fetch as `deps`, like chatClient, so tests need no phone.
import { WilmaError } from './wilma';

export interface DayEventRow {
  kind: 'event';
  key: string;
  title: string;
  start: string;
  end: string;
  place?: string;
  by_name_only?: true;
  needs_place?: true;
  not_a_trip?: true;
  private?: true;
  together_with?: string[];
}

export interface DayDriveRow {
  kind: 'drive';
  from: string;
  to: string;
  for_keys: string[];
  arrive_by?: string;
  leave_at?: string;
  minutes?: number;
  typical_minutes?: number;
  buffer_min?: number;
  tight?: true;
  unavailable?: 'no_home' | 'no_drive_times';
}

export type DayRow =
  | DayEventRow
  | DayDriveRow
  | { kind: 'free'; start: string; end: string; minutes: number }
  | { kind: 'task'; id: string; title: string; start: string; end: string; place?: string }
  | { kind: 'overlap'; keys: [string, string]; start: string; end: string; minutes: number; same_place: boolean; suggestion?: 'take_both' }
  | { kind: 'rain'; place: string; for_keys: string[]; start: string; end: string; chance_pct: number }
  | { kind: 'alert'; event: string; severity: string; start: string; end?: string; places: string[]; for_keys: string[] };

export interface DayPlan {
  date: string;
  time_zone: string;
  home: { set: boolean; label?: string };
  drive_times: 'available' | 'unavailable';
  weather: 'available' | 'unavailable' | 'outside_us';
  weather_at: { place: string; for_keys: string[]; hourly: { at: string; rain_pct: number }[] }[];
  credits: string[];
  rows: DayRow[];
  all_day: { key: string; title: string }[];
  tasks_not_placed: { id: string; title: string; priority: string; duration_min?: number; due_on?: string; overdue?: true; repeat?: string }[];
}

/** What the day route answered. `connection`: anything else (offline, 5xx, an unreadable answer). */
export type DayAnswer =
  | { plan: DayPlan; usage: { used?: number; limit?: number } }
  | { problem: 'pro_required' }
  | { problem: 'fair_use'; used?: number; limit?: number }
  | { problem: 'connection' };

/** The request body ({"mode":"day"}); events carry the app's key for each (dayAgenda.ts). */
export interface DayBody {
  mode: 'day';
  date: string;
  tz: string;
  now?: string;
  events: Record<string, unknown>[];
  choices?: { together?: string[][]; not_driving?: string[] };
}

// ---- Checking the answer -----------------------------------------------------------------------

const MAX_TEXT = 300;
const MAX_ROWS = 400;
const LOCAL = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
const when = (v: unknown): v is string => typeof v === 'string' && LOCAL.test(v);
const count = (v: unknown, max = 100_000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const texts = (v: unknown, max = 50): string[] => (Array.isArray(v) ? v.filter(text).slice(0, max) : []);
const opt = <K extends string, V>(key: K, ok: boolean, value: V) => (ok ? ({ [key]: value } as Record<K, V>) : {});

/** One row, copied field by field; null when it is not a row this app knows. */
export function toDayRow(raw: unknown): DayRow | null {
  if (!isObject(raw)) return null;
  switch (raw.kind) {
    case 'event':
      if (!text(raw.key) || !text(raw.title) || !when(raw.start) || !when(raw.end)) return null;
      return {
        kind: 'event', key: raw.key, title: raw.title, start: raw.start, end: raw.end,
        ...opt('place', text(raw.place), raw.place as string),
        ...opt('by_name_only', raw.by_name_only === true, true as const),
        ...opt('needs_place', raw.needs_place === true, true as const),
        ...opt('not_a_trip', raw.not_a_trip === true, true as const),
        ...opt('private', raw.private === true, true as const),
        ...opt('together_with', Array.isArray(raw.together_with), texts(raw.together_with)),
      };
    case 'drive':
      if (!text(raw.from) || !text(raw.to)) return null;
      return {
        kind: 'drive', from: raw.from, to: raw.to, for_keys: texts(raw.for_keys),
        ...opt('arrive_by', when(raw.arrive_by), raw.arrive_by as string),
        ...opt('leave_at', when(raw.leave_at), raw.leave_at as string),
        ...opt('minutes', count(raw.minutes, 1440), raw.minutes as number),
        ...opt('typical_minutes', count(raw.typical_minutes, 1440), raw.typical_minutes as number),
        ...opt('buffer_min', count(raw.buffer_min, 120), raw.buffer_min as number),
        ...opt('tight', raw.tight === true, true as const),
        ...opt('unavailable', raw.unavailable === 'no_home' || raw.unavailable === 'no_drive_times', raw.unavailable as 'no_home' | 'no_drive_times'),
      };
    case 'free':
      return when(raw.start) && when(raw.end) && count(raw.minutes, 2880)
        ? { kind: 'free', start: raw.start, end: raw.end, minutes: raw.minutes }
        : null;
    case 'task':
      if (!text(raw.id) || !text(raw.title) || !when(raw.start) || !when(raw.end)) return null;
      return { kind: 'task', id: raw.id, title: raw.title, start: raw.start, end: raw.end, ...opt('place', text(raw.place), raw.place as string) };
    case 'overlap': {
      const keys = texts(raw.keys);
      if (keys.length !== 2 || !when(raw.start) || !when(raw.end) || !count(raw.minutes, 2880)) return null;
      return {
        kind: 'overlap', keys: [keys[0], keys[1]], start: raw.start, end: raw.end, minutes: raw.minutes, same_place: raw.same_place === true,
        ...opt('suggestion', raw.suggestion === 'take_both', 'take_both' as const),
      };
    }
    case 'rain':
      if (!text(raw.place) || !when(raw.start) || !when(raw.end) || !count(raw.chance_pct, 100)) return null;
      return { kind: 'rain', place: raw.place, for_keys: texts(raw.for_keys), start: raw.start, end: raw.end, chance_pct: raw.chance_pct };
    case 'alert':
      if (!text(raw.event) || !when(raw.start)) return null;
      return {
        kind: 'alert', event: raw.event, severity: text(raw.severity) ? raw.severity : 'Unknown', start: raw.start,
        ...opt('end', when(raw.end), raw.end as string), places: texts(raw.places), for_keys: texts(raw.for_keys),
      };
    default:
      return null;
  }
}

/** The plan, checked; null when it is not one. Unknown rows and fields are dropped. */
export function toDayPlan(raw: unknown): DayPlan | null {
  if (!isObject(raw) || !when(raw.date) || typeof raw.time_zone !== 'string' || !isObject(raw.home) || !Array.isArray(raw.rows)) return null;
  const weather = raw.weather === 'available' || raw.weather === 'outside_us' ? raw.weather : 'unavailable';
  return {
    date: raw.date,
    time_zone: raw.time_zone.slice(0, 64),
    home: raw.home.set === true ? { set: true, ...opt('label', text(raw.home.label), raw.home.label as string) } : { set: false },
    drive_times: raw.drive_times === 'available' ? 'available' : 'unavailable',
    weather,
    weather_at: (Array.isArray(raw.weather_at) ? raw.weather_at : []).filter(isObject).filter((w) => text(w.place)).slice(0, 20).map((w) => ({
      place: w.place as string,
      for_keys: texts(w.for_keys),
      hourly: (Array.isArray(w.hourly) ? w.hourly : [])
        .filter((h): h is { at: string; rain_pct: number } => isObject(h) && when(h.at) && count(h.rain_pct, 100))
        .slice(0, 48)
        .map((h) => ({ at: h.at, rain_pct: h.rain_pct })),
    })),
    credits: texts(raw.credits, 5),
    rows: raw.rows.slice(0, MAX_ROWS).map(toDayRow).filter((r): r is DayRow => r !== null),
    all_day: (Array.isArray(raw.all_day) ? raw.all_day : [])
      .filter((e): e is { key: string; title: string } => isObject(e) && text(e.key) && text(e.title))
      .slice(0, 50)
      .map((e) => ({ key: e.key, title: e.title })),
    tasks_not_placed: (Array.isArray(raw.tasks_not_placed) ? raw.tasks_not_placed : [])
      .filter((t): t is Record<string, unknown> & { id: string; title: string } => isObject(t) && text(t.id) && text(t.title))
      .slice(0, 100)
      .map((t) => ({
        id: t.id, title: t.title, priority: t.priority === 'important' ? 'important' : 'normal',
        ...opt('duration_min', count(t.duration_min, 1440), t.duration_min as number),
        ...opt('due_on', when(t.due_on), t.due_on as string),
        ...opt('overdue', t.overdue === true, true as const),
        ...opt('repeat', text(t.repeat), t.repeat as string),
      })),
  };
}

/** The day route's answer (status and body) as the app reads it. */
export function toDayAnswer(status: number, body: unknown): DayAnswer {
  const b = isObject(body) ? body : {};
  if (status === 403 && b.error === 'pro_required') return { problem: 'pro_required' };
  if (status === 429 && b.error === 'fair_use') {
    return { problem: 'fair_use', ...opt('used', count(b.used), b.used as number), ...opt('limit', count(b.limit), b.limit as number) };
  }
  if (status !== 200) return { problem: 'connection' };
  const plan = toDayPlan(b.plan);
  if (!plan) return { problem: 'connection' };
  const u = isObject(b.usage) ? b.usage : {};
  return { plan, usage: { ...opt('used', count(u.used), u.used as number), ...opt('limit', count(u.limit), u.limit as number) } };
}

// ---- The client --------------------------------------------------------------------------------

export type JsonFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface DayClientOptions {
  url: string;
  token: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  fetch?: JsonFetch;
}

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

export function dayClient({ url, token, refresh, fetch: f = fetch as unknown as JsonFetch }: DayClientOptions) {
  /** Asks for one day's plan. Never throws except when the session has ended (a signed-out WilmaError). */
  async function plan(body: DayBody, signal?: AbortSignal): Promise<DayAnswer> {
    const json = JSON.stringify(body);
    const post = (accessToken: string) =>
      f(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: json,
        signal,
      });
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
        // an unreadable body is a connection problem below
      }
      return toDayAnswer(res.status, parsed);
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      return { problem: 'connection' };
    }
  }
  return { plan };
}

export type DayClient = ReturnType<typeof dayClient>;
