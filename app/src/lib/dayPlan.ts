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
  /** 🚸 The user drops off and picks up here: free between. */
  drop_off?: true;
  /** Shown as Free in the calendar: keeps no time. */
  free?: true;
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
  /** The drive back to pick up after a drop-off. */
  pick_up?: true;
}

export type DayRow =
  | DayEventRow
  | DayDriveRow
  | { kind: 'free'; start: string; end: string; minutes: number }
  | { kind: 'task'; id: string; title: string; start: string; end: string; place?: string }
  | { kind: 'overlap'; keys: [string, string]; start: string; end: string; minutes: number; same_place: boolean; suggestion?: 'take_both' }
  | { kind: 'rain'; place: string; for_keys: string[]; start: string; end: string; chance_pct: number }
  | { kind: 'alert'; event: string; severity: string; start: string; end?: string; places: string[]; for_keys: string[] };

/** Where a task fits (＋ Add → Find a time): on a drive already planned, or in free time. */
export interface TaskOption {
  kind: 'on_the_way' | 'free_time';
  start: string;
  end: string;
  extra_drive_min: number;
  /** on_the_way: the trip it joins, and its new and old leave-by times. */
  for_keys?: string[];
  leave_at?: string;
  was_leave_at?: string;
}

/** A task in the day without a time. left_from: left open on that earlier day, at planned_time (D35). */
export interface NotPlacedTask {
  id: string;
  title: string;
  priority: string;
  duration_min?: number;
  due_on?: string;
  overdue?: true;
  repeat?: string;
  left_from?: string;
  planned_time?: string;
  /** One of a routine's tasks (D39): the routine's name. Never overdue while its week or month runs. */
  routine?: string;
}

/**
 * "From your routines" (D39): a routine task the planner fitted into free time (start and end, local),
 * or, for a task with a place, no time (the app offers Find a time, which knows drives).
 */
export interface RoutineSuggestion {
  task_id: string;
  title: string;
  routine: string;
  duration_min: number;
  /** No duration was given: fitted as 30 min, shown as "about 30 min" (routines Q7). */
  duration_assumed?: true;
  /** The last day of its week or month. */
  due_on?: string;
  start?: string;
  end?: string;
  /**
   * A daily routine's line ("Daily routines", Q-D2): its tasks one after another from `start`; then
   * `title` is the routine's name and `duration_min` the whole line's.
   */
  tasks?: RoutineGroupTask[];
}

export interface RoutineGroupTask {
  task_id: string;
  title: string;
  duration_min: number;
  duration_assumed?: true;
  start: string;
  end: string;
}

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
  tasks_not_placed: NotPlacedTask[];
  /** Up to 3 routine tasks to offer; `more` waiting their turn (routines Q4). Absent when none. */
  suggestions?: { items: RoutineSuggestion[]; more: number };
  /** Only when asked for one task (options_for): at most three, and a note when none fits. */
  options?: { task_id: string; options: TaskOption[]; note?: string };
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
  /** A task's id: the plan also says where it fits. */
  options_for?: string;
  /** Plan from this saved home (home_place id), the day's Change; else the default (D36). */
  start_from?: { home: string };
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
        ...opt('drop_off', raw.drop_off === true, true as const),
        ...opt('free', raw.free === true, true as const),
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
        ...opt('pick_up', raw.pick_up === true, true as const),
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

function toOption(raw: unknown): TaskOption | null {
  if (!isObject(raw) || (raw.kind !== 'on_the_way' && raw.kind !== 'free_time') || !when(raw.start) || !when(raw.end) || !count(raw.extra_drive_min, 1440)) {
    return null;
  }
  return {
    kind: raw.kind, start: raw.start, end: raw.end, extra_drive_min: raw.extra_drive_min,
    ...opt('for_keys', Array.isArray(raw.for_keys), texts(raw.for_keys)),
    ...opt('leave_at', when(raw.leave_at), raw.leave_at as string),
    ...opt('was_leave_at', when(raw.was_leave_at), raw.was_leave_at as string),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A daily routine's tasks, checked: each with an id, a title, minutes and a time; at most 20. */
function toGroup(raw: unknown): { tasks?: RoutineGroupTask[] } {
  if (!Array.isArray(raw)) return {};
  const tasks = raw
    .filter((t): t is Record<string, unknown> & { task_id: string; title: string; duration_min: number; start: string; end: string } =>
      isObject(t) && text(t.task_id) && text(t.title) && count(t.duration_min, 1440) && t.duration_min > 0 &&
      when(t.start) && when(t.end) && String(t.start).includes('T') && String(t.end).includes('T'))
    .slice(0, 20)
    .map((t) => ({
      task_id: t.task_id, title: t.title, duration_min: t.duration_min, start: t.start, end: t.end,
      ...opt('duration_assumed', t.duration_assumed === true, true as const),
    }));
  // Only a whole line: a task dropped would leave the rest at the wrong times.
  return tasks.length && tasks.length === raw.length ? { tasks } : {};
}

/** "From your routines", checked: at most 3 items; a time only as a start and end pair. */
function toSuggestions(raw: unknown): { suggestions?: { items: RoutineSuggestion[]; more: number } } {
  if (!isObject(raw) || !Array.isArray(raw.items)) return {};
  const items = raw.items
    .filter((s): s is Record<string, unknown> & { task_id: string; title: string; routine: string; duration_min: number } =>
      isObject(s) && text(s.task_id) && text(s.title) && text(s.routine) && count(s.duration_min, 1440) && s.duration_min > 0)
    .slice(0, 3)
    .map((s) => ({
      task_id: s.task_id, title: s.title, routine: s.routine, duration_min: s.duration_min,
      ...opt('duration_assumed', s.duration_assumed === true, true as const),
      ...opt('due_on', typeof s.due_on === 'string' && DAY.test(s.due_on), s.due_on as string),
      ...(when(s.start) && when(s.end) && s.start.includes('T') && s.end.includes('T') ? { start: s.start, end: s.end } : {}),
      ...toGroup(s.tasks),
    }));
  if (!items.length) return {};
  return { suggestions: { items, more: count(raw.more, 1000) ? raw.more : 0 } };
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
        ...opt('left_from', typeof t.left_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.left_from), t.left_from as string),
        ...opt('planned_time', typeof t.planned_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.planned_time), t.planned_time as string),
        ...opt('routine', text(t.routine), t.routine as string),
      })),
    ...toSuggestions(raw.suggestions),
    ...(isObject(raw.options) && text(raw.options.task_id)
      ? {
          options: {
            task_id: raw.options.task_id,
            options: (Array.isArray(raw.options.options) ? raw.options.options : []).map(toOption).filter((o): o is TaskOption => o !== null).slice(0, 4),
            ...opt('note', text(raw.options.note), raw.options.note as string),
          },
        }
      : {}),
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
