// Routines (docs/routines-plan.md, design D39): a named group of tasks that comes back every day,
// every weekday, every week, every two weeks or every month. A routine is an item (item_type "routine") in the Tasks space;
// its tasks are ordinary tasks with routine_id. The routine holds the schedule; this module works
// out, in code, which period ("window") a task is in: window_from is the first day it may be done,
// due_on the last. Its tasks get those dates from here, so the planner and the Tasks screen keep
// reading tasks only.
//
// Owner's answers (2026-10-18): a weekly (or every-2-weeks) routine is "any day that week" or "the
// same day each time" (Q1); a monthly one is any day of the month, or by a day of the month (Q2); a
// missed one is passed by, not carried over, as the next one comes up (Q6). Daily routines (added
// 2026-10-21, "Daily routines"): every day, weekends included, or weekdays (Q-D1); the period is one
// day; an optional time, "at" (Q-D3), where My day offers them.
//
// Dates are calendar dates (YYYY-MM-DD) in the user's own days; weeks run Sunday to Saturday, as the
// app's day picker does.
import { normalizeTask, taskDate, TaskError, type TaskMetadata } from "./tasks.ts";

export const ROUTINE_TYPE = "routine";
export const ROUTINE_REPEATS = ["daily", "weekdays", "weekly", "biweekly", "monthly"] as const;
export type RoutineRepeat = (typeof ROUTINE_REPEATS)[number];
/** Every day or every weekday: one day at a time, offered as one line in My day (Q-D2). */
export const isDailyRepeat = (repeat: string | undefined): boolean => repeat === "daily" || repeat === "weekdays";
/** any_day: the whole week, fortnight or month (a daily kind: that day); same_day: only `day` (weekly, biweekly); by_day: by `day` of the month. */
export const ROUTINE_WHENS = ["any_day", "same_day", "by_day"] as const;
export type RoutineWhen = (typeof ROUTINE_WHENS)[number];

export interface RoutineMetadata {
  repeat: RoutineRepeat;
  when: RoutineWhen;
  /** same_day: 0 Sunday … 6 Saturday; by_day: 1-31 (the month's last day when shorter). */
  day?: number;
  /** The first day the routine runs from; for every two weeks, which weeks are "on". */
  starts_on: string;
  /** Offered in My day's From your routines (on unless turned off). */
  suggest: boolean;
  /** Daily kinds only: when My day offers it, "HH:MM" (Q-D3). */
  at?: string;
}

export interface Period {
  /** The first day a task of the routine may be done. */
  window_from: string;
  /** The last day; after it the task is missed and moves on (Q6). */
  due_on: string;
}

const FIELDS = ["repeat", "when", "day", "starts_on", "suggest", "at"];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const fail = (msg: string): never => {
  throw new TaskError(`Routine not saved: ${msg}`);
};

/** A date field of a routine, with the routine's own message. */
function routineDate(v: unknown): string | undefined {
  try {
    return taskDate(v, "starts_on");
  } catch (e) {
    return fail((e as Error).message.replace(/^Task not saved: /, ""));
  }
}

export function isRoutine(itemType: string | null | undefined): boolean {
  return (itemType ?? "").trim().toLowerCase() === ROUTINE_TYPE;
}

// ---- dates ------------------------------------------------------------------------------------

/** A task's fields checked again (the same rules as when it was saved). */
const recheck = (t: TaskMetadata): TaskMetadata => normalizeTask(t as unknown as Record<string, unknown>);

const DAY_MS = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromTime(toTime(d) + n * DAY_MS);
const dow = (d: string) => new Date(toTime(d)).getUTCDay();
/** The Sunday on or before `d`. */
const weekStart = (d: string) => addDays(d, -dow(d));
function monthBounds(d: string): { first: string; last: string; lastDay: number } {
  const t = new Date(toTime(d));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { first: fromTime(Date.UTC(y, m, 1)), last: fromTime(Date.UTC(y, m, lastDay)), lastDay };
}
const firstOfNextMonth = (d: string) => addDays(monthBounds(d).last, 1);

// ---- the routine's fields -----------------------------------------------------------------------

/**
 * The checked, tidied metadata of a routine. Throws TaskError with a short reason. `today` (the
 * user's date) is where a new routine starts when no starts_on is given.
 */
export function normalizeRoutine(input: Record<string, unknown> | null | undefined, today: string): RoutineMetadata {
  const m = input ?? {};
  if (typeof m !== "object" || Array.isArray(m)) fail("metadata must be an object");
  const unknown = Object.keys(m).find((k) => !FIELDS.includes(k));
  if (unknown) fail(`unknown routine field "${unknown}" (known: ${FIELDS.join(", ")})`);

  const repeat = typeof m.repeat === "string" ? m.repeat.trim().toLowerCase() : "";
  if (!(ROUTINE_REPEATS as readonly string[]).includes(repeat)) fail(`repeat must be ${ROUTINE_REPEATS.map((r) => `"${r}"`).join(", ")}`);
  const when = typeof m.when === "string" && m.when.trim() ? m.when.trim().toLowerCase() : "any_day";
  if (!(ROUTINE_WHENS as readonly string[]).includes(when)) fail(`when must be ${ROUTINE_WHENS.map((w) => `"${w}"`).join(", ")}`);
  if (repeat === "monthly" && when === "same_day") fail('a monthly routine is "any_day" or "by_day"');
  if (repeat !== "monthly" && when === "by_day") fail('"by_day" is for a monthly routine; a weekly one is "any_day" or "same_day"');
  const daily = isDailyRepeat(repeat);
  if (daily && when !== "any_day") fail(`a ${repeat} routine has no "when" (it is every ${repeat === "daily" ? "day" : "weekday"})`);

  const out: RoutineMetadata = {
    repeat: repeat as RoutineRepeat,
    when: when as RoutineWhen,
    starts_on: routineDate(m.starts_on) ?? today,
    suggest: true,
  };
  if (when !== "any_day") {
    const n = typeof m.day === "string" ? Number(m.day) : m.day;
    const [lo, hi] = when === "same_day" ? [0, 6] : [1, 31];
    if (typeof n !== "number" || !Number.isInteger(n) || n < lo || n > hi) {
      fail(when === "same_day" ? "day must be 0 (Sunday) to 6 (Saturday)" : "day must be a day of the month, 1 to 31");
    }
    out.day = n as number;
  } else if (m.day !== undefined && m.day !== null && m.day !== "") {
    fail('day goes with "same_day" or "by_day"');
  }
  if (m.suggest !== undefined && m.suggest !== null) {
    if (typeof m.suggest !== "boolean") fail("suggest must be true or false");
    out.suggest = m.suggest as boolean;
  }
  if (m.at !== undefined && m.at !== null && m.at !== "") {
    if (!daily) fail('"at" is for a daily or weekdays routine');
    const at = typeof m.at === "string" ? m.at.trim() : "";
    const hm = /^(\d{1,2}):(\d{2})$/.exec(at);
    const padded = hm ? `${hm[1].padStart(2, "0")}:${hm[2]}` : "";
    if (!HHMM.test(padded)) fail('at must be a time of day, "HH:MM" ("07:30")');
    out.at = padded;
  }
  return out;
}

/** "Every day at 07:30", "Every Saturday", "Any day each week", "By the 28th each month": for lists and the chat. */
export function routineWords(r: RoutineMetadata): string {
  if (isDailyRepeat(r.repeat)) return `Every ${r.repeat === "daily" ? "day" : "weekday"}${r.at ? ` at ${r.at}` : ""}`;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  if (r.repeat === "monthly") return r.when === "by_day" ? `By the ${nth(r.day!)} each month` : "Any day each month";
  const every = r.repeat === "weekly" ? "week" : "two weeks";
  return r.when === "same_day" ? `Every ${r.repeat === "weekly" ? "" : "other "}${DAYS[r.day!]}` : `Any day each ${every}`;
}

// ---- periods ------------------------------------------------------------------------------------

/** The period that holds `day`, or the next one when `day` falls between two (same_day, by_day). */
export function periodOn(r: RoutineMetadata, day: string): Period {
  const from = day < r.starts_on ? r.starts_on : day;
  if (r.repeat === "daily") return { window_from: from, due_on: from };
  if (r.repeat === "weekdays") {
    // Saturday or Sunday: the Monday after.
    const d = addDays(from, dow(from) === 6 ? 2 : dow(from) === 0 ? 1 : 0);
    return { window_from: d, due_on: d };
  }
  if (r.repeat === "monthly") {
    const { first, last, lastDay } = monthBounds(from);
    if (r.when === "any_day") return { window_from: first, due_on: last };
    const by = addDays(first, Math.min(r.day!, lastDay) - 1);
    if (from <= by) return { window_from: first, due_on: by };
    const next = firstOfNextMonth(from);
    const b = monthBounds(next);
    return { window_from: next, due_on: addDays(next, Math.min(r.day!, b.lastDay) - 1) };
  }
  const span = r.repeat === "weekly" ? 7 : 14;
  // Fortnights count from the week the routine starts in, so "every other Saturday" keeps its weeks.
  const anchor = weekStart(r.starts_on);
  const k = Math.floor((toTime(weekStart(from)) - toTime(anchor)) / (span * DAY_MS));
  const start = addDays(anchor, k * span);
  if (r.when === "any_day") return { window_from: start, due_on: addDays(start, span - 1) };
  // same_day: the day in the first week of the block; passed already: the next block's.
  const on = addDays(start, r.day!);
  const d = on >= from ? on : addDays(on, span);
  return { window_from: d, due_on: d };
}

/** The period after `p`. */
export const periodAfter = (r: RoutineMetadata, p: Period): Period => periodOn(r, addDays(p.due_on, 1));

// ---- a routine's tasks --------------------------------------------------------------------------

/** The task with its routine's schedule: repeat, and the period `today` is in (or the next one). */
export function withRoutine(task: TaskMetadata, routineId: string, r: RoutineMetadata, today: string): TaskMetadata {
  const p = periodOn(r, today);
  // Done already in this period (a schedule change, or a task added back): it waits for the next one.
  const period = task.last_done_on && task.last_done_on >= p.window_from ? periodAfter(r, p) : p;
  const out: TaskMetadata = { ...task, status: "open", routine_id: routineId, repeat: r.repeat, window_from: period.window_from, due_on: period.due_on };
  delete out.done_at;
  delete out.day_end; // a routine task moves on by itself, like any repeating task
  return recheck(out);
}

/** Done: the next period, from whichever is later, its own period or today's (done early or late). */
export function routineTaskDone(task: TaskMetadata, r: RoutineMetadata, today: string): TaskMetadata {
  const current: Period = { window_from: task.window_from ?? task.due_on ?? today, due_on: task.due_on ?? today };
  const next = periodAfter(r, current.due_on < today ? periodOn(r, today) : current);
  const out: TaskMetadata = { ...task, status: "open", last_done_on: today, window_from: next.window_from, due_on: next.due_on };
  delete out.done_at;
  delete out.planned_at; // the next one is placed afresh
  delete out.missed_on;
  return recheck(out);
}

/**
 * Missed (Q6): open past its last day, it moves on to the period `today` is in, keeping the day it
 * was missed (missed_on). Nothing changes otherwise. Worked out when read, like a task's day end
 * (D35); the caller decides whether to save it.
 */
export function settleRoutineTask(task: TaskMetadata, r: RoutineMetadata, today: string): { task: TaskMetadata; missed: boolean } {
  if (task.status !== "open" || !task.due_on || task.due_on >= today) return { task, missed: false };
  const p = periodOn(r, today);
  const out: TaskMetadata = { ...task, window_from: p.window_from, due_on: p.due_on, missed_on: task.due_on };
  delete out.planned_at;
  return { task: recheck(out), missed: true };
}
