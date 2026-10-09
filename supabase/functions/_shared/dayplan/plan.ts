// The day planner (docs/phase6-day-planner-step2-plan.md, "How it works"): plain code, no model.
// "The model judges, code calculates" (D25): every number on My day (leave-by times, drive minutes,
// overlaps, free gaps, task options) comes from here, with tests (tests/deno/dayplan_test.ts).
//
// Times are the user's local wall clock ("2026-10-09T16:30", in the request's time zone) and are
// worked out as minutes from the plan day's midnight, so a day is the user's own day. Drive times
// come from a DriveTimes provider (Mapbox on the server, mapbox.ts; Apple's MapKit on iPhone later;
// without one every drive says "drive time unavailable"). Weather comes from a Weather provider (the
// US National Weather Service, nws.ts), for the places driven to. A provider only ever gets points
// and times: never a title, a calendar or who is going.
import { distanceKm, type Point } from "../../mcp/lib/places.ts";
import type { PlaceWeather, Weather } from "./nws.ts";

export type { Point };

/** Minutes to park and walk in, added before every arrival (Q1). */
export const BUFFER_MIN = 5;
/** Free gaps shorter than this are not shown. */
export const MIN_GAP = 30;
/** Go home between two events only when at least this long would be spent at home (Q6). */
export const MIN_TIME_HOME = 30;
/** Two places this close (km) are the same place: one trip, or no drive between them. */
export const SAME_PLACE_KM = 0.2;
/** The planned day, for free gaps: 7:00 to 22:00, widened by anything earlier or later. */
export const DAY_START = 7 * 60;
export const DAY_END = 22 * 60;
/** Task options offered for one task; at most MAX_ON_THE_WAY of them stops on a drive already planned. */
export const MAX_OPTIONS = 4;
export const MAX_ON_THE_WAY = 2;
/** A meal's usual hours (local minutes): a task named for one is offered then when it fits (owner, 2026-10-09). */
export const MEAL_HOURS: { word: RegExp; from: number; to: number }[] = [
  { word: /\bbreakfast\b/i, from: 7 * 60, to: 9 * 60 + 30 },
  { word: /\bbrunch\b/i, from: 10 * 60, to: 12 * 60 + 30 },
  { word: /\blunch\b/i, from: 11 * 60 + 30, to: 13 * 60 + 30 },
  { word: /\b(dinner|supper)\b/i, from: 17 * 60 + 30, to: 20 * 60 },
];

/** The usual hours of the meal a task is named for ("Lunch at Craft & Commons"), or null. */
export function mealHours(title: string): { from: number; to: number } | null {
  const m = MEAL_HOURS.find((h) => h.word.test(title));
  return m ? { from: m.from, to: m.to } : null;
}
/** A rain row from this chance of rain (Q2). */
export const RAIN_MIN_PCT = 50;
/** Hours of rain looked at around an event: from this long before it starts to its end. */
export const RAIN_BEFORE_MIN = 60;

export interface PlanPlace extends Point {
  label: string;
  /** Found from the event's location text by name only: the app asks the user to check it. */
  by_name_only?: boolean;
}

export interface PlanEvent {
  /** The app's id for the event, so its choices (Take both, Not driving) can name it. */
  key: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location?: string | null;
  place?: PlanPlace | null;
  /** The user said this event is not a trip (a call, at home). */
  not_a_trip?: boolean;
  busy_only?: boolean;
  declined?: boolean;
}

export interface PlanTask {
  id: string;
  title: string;
  priority: "normal" | "important";
  duration_min?: number;
  duration_estimated?: boolean;
  due_on?: string;
  /** A repeating task (daily, weekly, ...): shown with its repeat. */
  repeat?: string;
  /** When the user put it in the day, local time. */
  planned_at?: string;
  place?: PlanPlace | null;
}

export interface Leg {
  minutes: number;
  /** Minutes without today's traffic, when the provider knows them. */
  typical_minutes?: number;
}

export interface DriveTimes {
  /** A drive's minutes leaving at departLocal (local time in tz); null when unknown. */
  leg(from: Point, to: Point, departLocal: string, tz: string): Promise<Leg | null>;
}

export interface Choices {
  /** Events done as one trip (Take both). */
  together?: string[][];
  /** Events the user does not drive to. */
  not_driving?: string[];
}

export interface PlanInput {
  date: string;
  tz: string;
  /** Local time now, when planning today: gaps and options start from it. */
  now?: string;
  home: PlanPlace | null;
  events: PlanEvent[];
  tasks: PlanTask[];
  choices?: Choices;
  drives: DriveTimes | null;
  /** Rain and alerts at the places driven to; none: no weather rows. */
  weather?: Weather | null;
  /** Options for this task (＋ Add → Find a time). */
  optionsFor?: string;
}

export type Row =
  | {
    kind: "event"; key: string; title: string; start: string; end: string; place?: string; by_name_only?: true;
    needs_place?: true; not_a_trip?: true; private?: true; together_with?: string[];
  }
  | {
    kind: "drive"; to: string; from: string; for_keys: string[]; arrive_by?: string; leave_at?: string;
    minutes?: number; typical_minutes?: number; buffer_min?: number; tight?: true; unavailable?: "no_home" | "no_drive_times";
  }
  | { kind: "free"; start: string; end: string; minutes: number }
  | { kind: "task"; id: string; title: string; start: string; end: string; place?: string }
  | {
    kind: "overlap"; keys: [string, string]; start: string; end: string; minutes: number; same_place: boolean;
    suggestion?: "take_both";
  }
  /** Rain likely (RAIN_MIN_PCT or more) at a place driven to, around its event: the likeliest hour. */
  | { kind: "rain"; place: string; for_keys: string[]; start: string; end: string; chance_pct: number }
  /** A weather alert in force at a place driven to today (NWS: storms, heat, flood). */
  | { kind: "alert"; event: string; severity: string; start: string; end?: string; places: string[]; for_keys: string[] };

export interface TaskOption {
  kind: "on_the_way" | "free_time";
  start: string;
  end: string;
  /** Extra minutes of driving this option adds. */
  extra_drive_min: number;
  /** on_the_way: the drive it joins, and its new leave-by time. */
  for_keys?: string[];
  leave_at?: string;
  was_leave_at?: string;
}

export interface DayPlan {
  date: string;
  time_zone: string;
  home: { set: boolean; label?: string };
  drive_times: "available" | "unavailable";
  /** "outside_us": none of the places has a NWS forecast (the app says so once). */
  weather: "available" | "unavailable" | "outside_us";
  /** Hourly chance of rain at each place driven to, around its event (event detail). */
  weather_at: { place: string; for_keys: string[]; hourly: { at: string; rain_pct: number }[] }[];
  /** Where the numbers come from, to show on the screen. */
  credits: string[];
  rows: Row[];
  all_day: { key: string; title: string }[];
  tasks_not_placed: {
    id: string; title: string; priority: string; duration_min?: number; due_on?: string; overdue?: true; repeat?: string;
  }[];
  options?: { task_id: string; options: TaskOption[]; note?: string };
}

// ---- Local time as minutes from the plan day's midnight ------------------------------------------

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** "2026-10-09T16:30" (or a day) as minutes from `date`'s midnight; null when not a time. */
export function toMin(date: string, local: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!m) return null;
  const days = dayNum(m[1]) - dayNum(date);
  if (!Number.isFinite(days)) return null;
  return days * 1440 + (m[2] ? Number(m[2]) * 60 + Number(m[3]) : 0);
}

/** Minutes from `date`'s midnight back to "2026-10-09T16:30". */
export function fromMin(date: string, min: number): string {
  const t = new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(min) * 60_000);
  return t.toISOString().slice(0, 16);
}

const samePlace = (a: Point | null | undefined, b: Point | null | undefined) =>
  !!a && !!b && distanceKm(a, b) <= SAME_PLACE_KM;

// ---- The plan ----------------------------------------------------------------------------------

interface Timed extends PlanEvent {
  s: number;
  e: number;
}

/** One trip: an event, or events done together (Take both). */
interface Stop {
  keys: string[];
  s: number;
  e: number;
  place: PlanPlace;
}

/** Where the user is between stops. */
interface Here {
  place: PlanPlace | null;
  home: boolean;
  /** Free to leave from this minute. */
  from: number;
}

export async function planDay(input: PlanInput): Promise<DayPlan> {
  const { date, tz, home, drives } = input;
  const at = (min: number) => fromMin(date, min);
  const now = input.now ? toMin(date, input.now) ?? -Infinity : -Infinity;
  const notDriving = new Set(input.choices?.not_driving ?? []);

  // Events: declined ones are not happening; all-day ones get no drive and no time.
  const live = input.events.filter((e) => !e.declined);
  const all_day = live.filter((e) => e.all_day).map((e) => ({ key: e.key, title: e.busy_only ? "Busy" : e.title }));
  const timed: Timed[] = [];
  for (const e of live) {
    if (e.all_day) continue;
    const s = toMin(date, e.start);
    const end = toMin(date, e.end);
    if (s === null || end === null) continue;
    timed.push({ ...e, s, e: Math.max(s, end) });
  }
  timed.sort((a, b) => a.s - b.s || a.e - b.e);

  // Take both: events the user chose to do as one trip (only real, timed events with a place).
  const groupOf = new Map<string, string[]>();
  for (const keys of input.choices?.together ?? []) {
    const members = [...new Set(keys)].filter((k) => timed.some((t) => t.key === k && t.place));
    if (members.length < 2) continue;
    const merged = new Set(members.flatMap((k) => groupOf.get(k) ?? [k]));
    for (const k of merged) groupOf.set(k, [...merged]);
  }

  const rows: Row[] = [];
  for (const t of timed) {
    const row: Row = { kind: "event", key: t.key, title: t.busy_only ? "Busy" : t.title, start: at(t.s), end: at(t.e) };
    if (t.busy_only) row.private = true;
    if (t.place && !t.busy_only) {
      row.place = t.place.label;
      if (t.place.by_name_only) row.by_name_only = true;
    } else if (!t.busy_only && t.location?.trim() && !t.not_a_trip) {
      row.needs_place = true;
    }
    if (t.not_a_trip) row.not_a_trip = true;
    const group = groupOf.get(t.key);
    if (group) row.together_with = group.filter((k) => k !== t.key);
    rows.push(row);
  }

  // Overlaps: two events at the same time. At the same place, one trip may do (Take both).
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j].s < timed[i].e; j++) {
      const a = timed[i];
      const b = timed[j];
      if (groupOf.get(a.key)?.includes(b.key)) continue;
      const end = Math.min(a.e, b.e);
      if (end <= b.s) continue;
      const same = samePlace(a.place, b.place);
      rows.push({
        kind: "overlap", keys: [a.key, b.key], start: at(b.s), end: at(end), minutes: end - b.s, same_place: same,
        ...(same && !notDriving.has(a.key) && !notDriving.has(b.key) ? { suggestion: "take_both" as const } : {}),
      });
    }
  }

  // Trips: events with a place the user drives to, in order; a group is one trip.
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (const t of timed) {
    if (seen.has(t.key) || !t.place || t.not_a_trip || t.busy_only || notDriving.has(t.key)) continue;
    const members = (groupOf.get(t.key) ?? [t.key]).map((k) => timed.find((x) => x.key === k)!).filter(Boolean);
    for (const m of members) seen.add(m.key);
    stops.push({ keys: members.map((m) => m.key), s: Math.min(...members.map((m) => m.s)), e: Math.max(...members.map((m) => m.e)), place: t.place });
  }

  const leg = async (from: Point, to: Point, departMin: number): Promise<Leg | null> => {
    if (!drives) return null;
    try {
      // Only the two points: never the place's name (or anything else the caller holds).
      return await drives.leg({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, at(departMin), tz);
    } catch {
      return null; // a provider failure never breaks the plan: that drive says "unavailable"
    }
  };

  const driveRows: DriveRow[] = [];
  // Each drive's end points, for task options; never in the plan the app gets.
  const ends = new Map<DriveRow, { from: PlanPlace; to: PlanPlace }>();
  let here: Here = { place: home, home: true, from: -Infinity };
  for (const stop of stops) {
    let origin = here.place;
    let known: Leg | null = null; // the drive from home, when already asked for below
    // Between two events: go home when there is time to spend there (Q6).
    if (!here.home && home && origin && !samePlace(origin, home)) {
      const back = await leg(origin, home, here.from);
      const out = back ? await leg(home, stop.place, stop.s - (back.minutes + BUFFER_MIN)) : null;
      if (back && out && stop.s - here.from - back.minutes - out.minutes - BUFFER_MIN >= MIN_TIME_HOME) {
        const row: DriveRow = {
          kind: "drive", from: origin.label, to: home.label, for_keys: [], leave_at: at(here.from),
          arrive_by: at(here.from + back.minutes), minutes: back.minutes, ...typical(back),
        };
        driveRows.push(row);
        ends.set(row, { from: origin, to: home });
        here = { place: home, home: true, from: here.from + back.minutes };
        origin = home;
        known = out;
      }
    }
    if (samePlace(origin, stop.place)) {
      // Already there (the same pool, the same office): no drive.
    } else if (!origin) {
      driveRows.push({ kind: "drive", from: "Home", to: stop.place.label, for_keys: stop.keys, arrive_by: at(stop.s), unavailable: "no_home" });
    } else {
      const l = known ?? await leg(origin, stop.place, stop.s - 30);
      if (!l) {
        driveRows.push({ kind: "drive", from: origin.label, to: stop.place.label, for_keys: stop.keys, arrive_by: at(stop.s), unavailable: "no_drive_times" });
      } else {
        const leave = stop.s - l.minutes - BUFFER_MIN;
        const row: DriveRow = {
          kind: "drive", from: origin.label, to: stop.place.label, for_keys: stop.keys, leave_at: at(leave), arrive_by: at(stop.s),
          minutes: l.minutes, ...typical(l), buffer_min: BUFFER_MIN, ...(leave < here.from ? { tight: true as const } : {}),
        };
        driveRows.push(row);
        ends.set(row, { from: origin, to: stop.place });
      }
    }
    here = { place: stop.place, home: false, from: stop.e };
  }
  // Home at the end of the day.
  if (!here.home && home && here.place && !samePlace(here.place, home)) {
    const back = await leg(here.place, home, here.from);
    const row: DriveRow = back
      ? { kind: "drive", from: here.place.label, to: home.label, for_keys: [], leave_at: at(here.from), arrive_by: at(here.from + back.minutes), minutes: back.minutes, ...typical(back) }
      : { kind: "drive", from: here.place.label, to: home.label, for_keys: [], leave_at: at(here.from), unavailable: "no_drive_times" };
    driveRows.push(row);
    if (back) ends.set(row, { from: here.place, to: home });
  }
  rows.push(...driveRows);

  const weather = await weatherRows(input, stops, driveRows, at);
  rows.push(...weather.rows);

  // Tasks: placed ones at their time; the others listed as not placed yet.
  const tasks_not_placed: DayPlan["tasks_not_placed"] = [];
  const taskBusy: [number, number][] = [];
  for (const t of input.tasks) {
    const p = t.planned_at ? toMin(date, t.planned_at) : null;
    if (p !== null && p >= 0 && p < 1440) {
      const end = p + (t.duration_min ?? 15);
      rows.push({ kind: "task", id: t.id, title: t.title, start: at(p), end: at(end), ...(t.place ? { place: t.place.label } : {}) });
      taskBusy.push([p, end]);
    } else {
      tasks_not_placed.push({
        id: t.id, title: t.title, priority: t.priority,
        ...(t.duration_min ? { duration_min: t.duration_min } : {}),
        ...(t.due_on ? { due_on: t.due_on } : {}),
        ...(t.due_on && t.due_on < date ? { overdue: true as const } : {}),
        ...(t.repeat ? { repeat: t.repeat } : {}),
      });
    }
  }

  // Free gaps: the day minus events, drives and placed tasks.
  const busy: [number, number][] = [
    ...timed.map((t): [number, number] => [t.s, t.e]),
    ...driveRows.filter((d) => d.leave_at && d.arrive_by).map((d): [number, number] => [toMin(date, d.leave_at!)!, toMin(date, d.arrive_by!)!]),
    ...taskBusy,
  ];
  const gaps = freeGaps(busy, Math.max(now, Math.min(DAY_START, ...busy.map((b) => b[0]))), Math.max(DAY_END, ...busy.map((b) => b[1])));
  for (const [s, e] of gaps) rows.push({ kind: "free", start: at(s), end: at(e), minutes: e - s });

  rows.sort((a, b) => rowStart(a).localeCompare(rowStart(b)) || ORDER[a.kind] - ORDER[b.kind]);

  const plan: DayPlan = {
    date, time_zone: tz,
    home: home ? { set: true, label: home.label } : { set: false },
    drive_times: drives ? "available" : "unavailable",
    weather: weather.status,
    weather_at: weather.at,
    credits: [
      ...(drives && driveRows.some((d) => d.minutes !== undefined) ? ["Drive times © Mapbox"] : []),
      ...(weather.status === "available" && weather.at.length ? ["Weather: US National Weather Service"] : []),
    ],
    rows, all_day, tasks_not_placed,
  };

  if (input.optionsFor) {
    const task = input.tasks.find((t) => t.id === input.optionsFor);
    if (task) plan.options = { task_id: task.id, ...(await taskOptions(task, { date, home, driveRows, ends, gaps, leg, now })) };
  }
  return plan;
}

type DriveRow = Extract<Row, { kind: "drive" }>;

const ORDER: Record<Row["kind"], number> = { alert: 0, drive: 1, rain: 2, overlap: 3, event: 4, task: 5, free: 6 };

function rowStart(r: Row): string {
  if (r.kind === "drive") return r.leave_at ?? r.arrive_by ?? "";
  return r.start;
}

/**
 * Weather at the places driven to (each place once): a rain row when the chance is RAIN_MIN_PCT or
 * more from an hour before its event to its end, the hourly chances for the event's detail, and the
 * alerts in force there (each alert once, with every place it covers). A failing provider leaves
 * the plan as it is, with weather "unavailable".
 */
async function weatherRows(
  input: PlanInput, stops: Stop[], driveRows: DriveRow[], at: (min: number) => string,
): Promise<{ status: DayPlan["weather"]; at: DayPlan["weather_at"]; rows: Row[] }> {
  const { date, tz, weather } = input;
  if (!weather) return { status: "unavailable", at: [], rows: [] };
  // The places the user drives to (a drive row names the trip), each looked up once.
  const driven = stops.filter((s) => driveRows.some((d) => d.for_keys.some((k) => s.keys.includes(k))));
  const looked: { place: PlanPlace; w: Promise<PlaceWeather | "outside_us" | null> }[] = [];
  const answerFor = (p: PlanPlace) => {
    let hit = looked.find((l) => samePlace(l.place, p));
    if (!hit) {
      const w = weather.at({ lat: p.lat, lng: p.lng }, date, tz).catch(() => null);
      looked.push(hit = { place: p, w });
    }
    return hit.w;
  };
  const answers = await Promise.all(driven.map((s) => answerFor(s.place)));
  if (!answers.length) return { status: "available", at: [], rows: [] };

  const rows: Row[] = [];
  const atRows: DayPlan["weather_at"] = [];
  const alerts = new Map<string, Extract<Row, { kind: "alert" }>>();
  driven.forEach((stop, i) => {
    const w = answers[i];
    if (!w || w === "outside_us") return;
    const from = stop.s - RAIN_BEFORE_MIN;
    const hours = w.hourly
      .map((h) => ({ ...h, m: toMin(date, h.at) }))
      .filter((h): h is typeof h & { m: number } => h.m !== null && h.m + 60 > from && h.m < Math.max(stop.e, stop.s + 1));
    if (hours.length) {
      atRows.push({ place: stop.place.label, for_keys: stop.keys, hourly: hours.map(({ at, rain_pct }) => ({ at, rain_pct })) });
      const wettest = hours.reduce((a, b) => (b.rain_pct > a.rain_pct ? b : a));
      if (wettest.rain_pct >= RAIN_MIN_PCT) {
        rows.push({
          kind: "rain", place: stop.place.label, for_keys: stop.keys, start: at(wettest.m), end: at(wettest.m + 60),
          chance_pct: wettest.rain_pct,
        });
      }
    }
    for (const a of w.alerts) {
      const seen = alerts.get(a.id);
      if (seen) {
        if (!seen.places.includes(stop.place.label)) seen.places.push(stop.place.label);
        seen.for_keys.push(...stop.keys);
        continue;
      }
      // An alert that began before today shows from the start of the day.
      const starts = a.starts && a.starts > `${date}T00:00` ? a.starts : `${date}T00:00`;
      alerts.set(a.id, {
        kind: "alert", event: a.event, severity: a.severity, start: starts, ...(a.ends ? { end: a.ends } : {}),
        places: [stop.place.label], for_keys: [...stop.keys],
      });
    }
  });
  rows.push(...alerts.values());
  const read = answers.filter((a) => a !== null);
  const status = read.length && read.every((a) => a === "outside_us")
    ? "outside_us"
    : read.some((a) => a !== "outside_us") ? "available" : "unavailable";
  return { status, at: atRows, rows };
}

function typical(l: Leg): { typical_minutes?: number } {
  return l.typical_minutes !== undefined && l.typical_minutes !== l.minutes ? { typical_minutes: l.typical_minutes } : {};
}

/** Gaps of at least MIN_GAP minutes between `from` and `to` that nothing in `busy` covers. */
export function freeGaps(busy: [number, number][], from: number, to: number): [number, number][] {
  const sorted = busy.filter(([s, e]) => e > from && s < to).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = from;
  for (const [s, e] of sorted) {
    if (s - cursor >= MIN_GAP) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (to - cursor >= MIN_GAP) out.push([cursor, to]);
  return out;
}

interface OptionContext {
  date: string;
  home: PlanPlace | null;
  driveRows: DriveRow[];
  ends: Map<DriveRow, { from: PlanPlace; to: PlanPlace }>;
  gaps: [number, number][];
  leg: (from: Point, to: Point, departMin: number) => Promise<Leg | null>;
  now: number;
}

/**
 * Where a task fits (the ＋ Add sheet): a stop on a drive already planned (from → task → to instead of
 * from → to, leaving earlier), or a free gap that holds the task and the drives to and from it, at
 * the gap's start and, when the gap is roomy, in its middle (lunch in the free hours, not only right
 * after the last stop). Free time is always offered when it fits: at most MAX_ON_THE_WAY stops on a
 * drive (least extra driving first), the rest free time (least extra driving, then the middles of
 * the roomiest gaps, then gaps' first minutes), at most MAX_OPTIONS, listed by time.
 * A meal ("lunch at …") is offered only in its usual hours (MEAL_HOURS), as near their middle as each
 * gap allows, when any time then fits; otherwise like any other task. "Not today" is the app's own.
 */
async function taskOptions(task: PlanTask, ctx: OptionContext): Promise<{ options: TaskOption[]; note?: string }> {
  const { date, driveRows, ends, gaps, leg, now } = ctx;
  const at = (m: number) => fromMin(date, m);
  const duration = task.duration_min ?? 15;
  const onTheWay: TaskOption[] = [];
  /** Free time: each gap's best fit (its middle when roomy, else its first minute), and the first minutes of roomy gaps. */
  const best: { option: TaskOption; room: number }[] = [];
  const early: { option: TaskOption; room: number }[] = [];
  const meal = mealHours(task.title);
  const atMeal: { option: TaskOption; room: number }[] = [];
  const mealMore: { option: TaskOption; room: number }[] = [];

  if (task.place) {
    for (const d of driveRows) {
      const end = ends.get(d);
      if (!end || !d.leave_at || d.minutes === undefined) continue;
      const leave = toMin(date, d.leave_at)!;
      const a = await leg(end.from, task.place, leave);
      const b = a ? await leg(task.place, end.to, leave + a.minutes + duration) : null;
      if (!a || !b) continue;
      const extraDrive = Math.max(0, a.minutes + b.minutes - d.minutes);
      const newLeave = leave - extraDrive - duration;
      if (newLeave < now) continue;
      onTheWay.push({
        kind: "on_the_way", start: at(newLeave + a.minutes), end: at(newLeave + a.minutes + duration),
        extra_drive_min: extraDrive, for_keys: d.for_keys, leave_at: at(newLeave), was_leave_at: d.leave_at,
      });
    }
  }

  for (const [s, e] of gaps) {
    // Where the user is when the gap starts: where the last drive before it went, else home.
    const before = driveRows.filter((d) => ends.has(d) && d.arrive_by && toMin(date, d.arrive_by)! <= s).at(-1);
    const where = before ? ends.get(before)!.to : ctx.home;
    let there = 0;
    let back = 0;
    if (task.place && !samePlace(where, task.place)) {
      if (!where) continue;
      const a = await leg(where, task.place, s);
      const b = a ? await leg(task.place, where, s + a.minutes + duration) : null;
      if (!a || !b) continue;
      there = a.minutes;
      back = b.minutes;
    }
    const room = e - s - (there + duration + back);
    if (room < 0) continue;
    const first: TaskOption = { kind: "free_time", start: at(s + there), end: at(s + there + duration), extra_drive_min: there + back };
    if (meal) {
      // Starting in the meal's hours (and ending in them when it is short enough): as near their
      // middle as the gap allows, then the earliest and latest times when half an hour or more apart.
      const lo = Math.max(s + there, meal.from);
      const hi = Math.min(e - back - duration, Math.max(meal.from, meal.to - duration));
      const quarter = (m: number) => {
        const q = Math.round(m / 15) * 15;
        return q >= lo && q <= hi ? q : m;
      };
      const taken: number[] = [];
      for (const m of lo <= hi ? [(meal.from + Math.max(meal.from, meal.to - duration)) / 2, lo, hi] : []) {
        const start = quarter(Math.min(Math.max(m, lo), hi));
        if (taken.some((t) => Math.abs(t - start) < 30)) continue;
        (taken.length ? mealMore : atMeal).push({ option: { ...first, start: at(start), end: at(start + duration) }, room });
        taken.push(start);
      }
    }
    // The middle of the gap, on a quarter hour, when that is at least half an hour later.
    const mid = Math.floor((s + there + room / 2) / 15) * 15;
    if (mid - (s + there) >= 30 && mid + duration + back <= e) {
      best.push({ option: { ...first, start: at(mid), end: at(mid + duration) }, room });
      early.push({ option: first, room });
    } else {
      best.push({ option: first, room });
    }
  }

  onTheWay.sort((a, b) => a.extra_drive_min - b.extra_drive_min || a.start.localeCompare(b.start));
  const byFit = (a: { option: TaskOption; room: number }, b: { option: TaskOption; room: number }) =>
    a.option.extra_drive_min - b.option.extra_drive_min || b.room - a.room || a.option.start.localeCompare(b.option.start);
  // A meal: only times in its hours, when there are any.
  const inMeal = (o: TaskOption) => !!meal && toMin(date, o.start)! >= meal.from && toMin(date, o.start)! <= meal.to;
  const mealTime = atMeal.length > 0 || onTheWay.some(inMeal);
  const ways = mealTime ? onTheWay.filter(inMeal) : onTheWay;
  const free = (mealTime ? [...atMeal.sort(byFit), ...mealMore.sort(byFit)] : [...best.sort(byFit), ...early.sort(byFit)]).map((f) => f.option);
  const picked = [...ways.slice(0, MAX_ON_THE_WAY), ...free].slice(0, MAX_OPTIONS);
  // Fewer free times than room left: more stops on the way fill it.
  picked.push(...ways.slice(MAX_ON_THE_WAY, MAX_ON_THE_WAY + MAX_OPTIONS - picked.length));
  const options = picked.sort((a, b) => a.start.localeCompare(b.start));
  if (options.length) return { options };
  if (task.place && !ctx.home) return { options, note: "Set your Home place so Wilma can time the drive." };
  if (task.place && !driveRows.length && !gaps.length) return { options, note: "No free time today that fits it." };
  return { options, note: task.place ? "No time today that fits it with the drive." : "No free time today that fits it." };
}
