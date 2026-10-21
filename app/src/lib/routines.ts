// Routines (routines step 3b, docs/routines-plan.md; design D39): Tasks → Routines and the routine
// screen. A routine is an item (item_type "routine") the server keeps in the Tasks space; its tasks
// are ordinary tasks with routine_id, and the server gives them their dates (window_from to due_on)
// from the routine. The app only reads those dates to say how a routine is going ("2 of 4 done this
// week"), so `periodOn` here mirrors the server's (supabase/functions/mcp/lib/routines.ts): weeks
// run Sunday to Saturday; every two weeks counts from the week the routine starts in; "by the 31st"
// is the month's last day when shorter; a daily routine's period is one day, a weekdays one's the
// Monday after a weekend ("Daily routines", 2026-10-21). The server checks every field again on save.
import type { TaskRow } from './tasks';

export const ROUTINE_TYPE = 'routine';
export type RoutineRepeat = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
/** Every day (weekends included) or every weekday: one day at a time, one line in My day. */
export const isDaily = (repeat: RoutineRepeat): boolean => repeat === 'daily' || repeat === 'weekdays';
/** any_day: the whole week, fortnight or month (a daily kind: that day); same_day: only `day` (0 Sunday … 6 Saturday); by_day: by `day` of the month. */
export type RoutineWhen = 'any_day' | 'same_day' | 'by_day';

export interface RoutineMetadata {
  repeat: RoutineRepeat;
  when: RoutineWhen;
  day?: number;
  starts_on?: string;
  suggest: boolean;
  /** Daily kinds only: when My day offers it, "HH:MM". */
  at?: string;
}

export interface Period {
  window_from: string;
  due_on: string;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPEATS: RoutineRepeat[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'];

/** A routine's schedule as the server keeps it; null when it is not one. */
export function toRoutine(raw: unknown): RoutineMetadata | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (!REPEATS.includes(m.repeat as RoutineRepeat)) return null;
  const repeat = m.repeat as RoutineRepeat;
  const when = m.when === 'same_day' || m.when === 'by_day' ? m.when : 'any_day';
  if (isDaily(repeat) && when !== 'any_day') return null;
  // "Same day" is for a weekly kind, "by the Nth" for a monthly one.
  if (when === 'same_day' && m.repeat === 'monthly') return null;
  if (when === 'by_day' && m.repeat !== 'monthly') return null;
  const day = typeof m.day === 'number' && Number.isInteger(m.day) ? m.day : undefined;
  if (when === 'same_day' && (day === undefined || day < 0 || day > 6)) return null;
  if (when === 'by_day' && (day === undefined || day < 1 || day > 31)) return null;
  return {
    repeat,
    when,
    ...(when !== 'any_day' ? { day } : {}),
    ...(typeof m.starts_on === 'string' && DATE.test(m.starts_on) ? { starts_on: m.starts_on } : {}),
    suggest: m.suggest !== false,
    ...(isDaily(repeat) && typeof m.at === 'string' && HHMM.test(m.at) ? { at: m.at } : {}),
  };
}

const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "07:30" → "7:30 am". */
export function atWords(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Every day at 7:30 am", "Every Saturday", "Any day each week", "By the 28th each month" (the server's, with a 12-hour time). */
export function routineWords(r: RoutineMetadata): string {
  if (isDaily(r.repeat)) return `Every ${r.repeat === 'daily' ? 'day' : 'weekday'}${r.at ? ` at ${atWords(r.at)}` : ''}`;
  if (r.repeat === 'monthly') return r.when === 'by_day' ? `By the ${nth(r.day!)} each month` : 'Any day each month';
  if (r.when === 'same_day') return `Every ${r.repeat === 'weekly' ? '' : 'other '}${WEEKDAYS[r.day!]}`;
  return `Any day each ${r.repeat === 'weekly' ? 'week' : 'two weeks'}`;
}

// ---- dates (as the server's) --------------------------------------------------------------------

const DAY_MS = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fromTime(toTime(d) + n * DAY_MS);
const weekStart = (d: string) => addDays(d, -new Date(toTime(d)).getUTCDay());
function monthBounds(d: string): { first: string; last: string; lastDay: number } {
  const t = new Date(toTime(d));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { first: fromTime(Date.UTC(y, m, 1)), last: fromTime(Date.UTC(y, m, lastDay)), lastDay };
}

/** The period that holds `day`, or the next one when `day` falls between two (same_day, by_day). */
export function periodOn(r: RoutineMetadata, day: string): Period {
  const startsOn = r.starts_on ?? day;
  const from = day < startsOn ? startsOn : day;
  if (r.repeat === 'daily') return { window_from: from, due_on: from };
  if (r.repeat === 'weekdays') {
    const dow = new Date(toTime(from)).getUTCDay();
    const d = addDays(from, dow === 6 ? 2 : dow === 0 ? 1 : 0);
    return { window_from: d, due_on: d };
  }
  if (r.repeat === 'monthly') {
    const { first, last, lastDay } = monthBounds(from);
    if (r.when === 'any_day') return { window_from: first, due_on: last };
    const by = addDays(first, Math.min(r.day!, lastDay) - 1);
    if (from <= by) return { window_from: first, due_on: by };
    const next = addDays(last, 1);
    return { window_from: next, due_on: addDays(next, Math.min(r.day!, monthBounds(next).lastDay) - 1) };
  }
  const span = r.repeat === 'weekly' ? 7 : 14;
  const anchor = weekStart(startsOn);
  const k = Math.floor((toTime(weekStart(from)) - toTime(anchor)) / (span * DAY_MS));
  const start = addDays(anchor, k * span);
  if (r.when === 'any_day') return { window_from: start, due_on: addDays(start, span - 1) };
  const on = addDays(start, r.day!);
  const d = on >= from ? on : addDays(on, span);
  return { window_from: d, due_on: d };
}

// ---- how a routine is going ---------------------------------------------------------------------

/** One routine on the Routines tab: its schedule, its tasks, and what is done this time. */
export interface RoutineCard {
  id: string;
  title: string;
  routine: RoutineMetadata;
  words: string;
  tasks: (TaskRow & { doneThisTime: boolean })[];
  /** "2 of 4 done this week", "Done for October", "Today: 2 of 3", "No tasks yet". */
  progress: string;
  /** "Missed in September: Wash car" (Q6: passed by, not carried over); never for a daily routine (Q-D4). */
  missed: string[];
}

const monthName = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
const shortDate = (d: string) => `${monthName(d).slice(0, 3)} ${Number(d.slice(8, 10))}`;

/** "this week", "these two weeks", "in October", "for Saturday", "by Oct 28", "for Monday, Oct 26". */
function periodWords(r: RoutineMetadata, p: Period): string {
  if (isDaily(r.repeat)) return `for ${WEEKDAYS[new Date(toTime(p.due_on)).getUTCDay()]}, ${shortDate(p.due_on)}`;
  if (r.repeat === 'monthly') return r.when === 'by_day' ? `by ${shortDate(p.due_on)}` : `in ${monthName(p.due_on)}`;
  if (r.when === 'same_day') return `for ${WEEKDAYS[r.day!]}, ${shortDate(p.due_on)}`;
  return r.repeat === 'weekly' ? 'this week' : 'these two weeks';
}

/**
 * A routine as the Routines tab shows it. A task is done this time when the server has moved it on
 * past the current period (ticking a routine's task moves it to the next one).
 */
export function routineCard(item: { id: string; title: string; routine: RoutineMetadata }, tasks: TaskRow[], today: string): RoutineCard {
  const r = item.routine;
  const p = periodOn(r, today);
  const mine = tasks
    .filter((t) => t.routine?.id === item.id)
    .map((t) => ({ ...t, doneThisTime: !!t.window_from && t.window_from > p.due_on }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const done = mine.filter((t) => t.doneThisTime).length;
  const when = periodWords(r, p);
  // A daily routine today (Q-D4): "Today: 2 of 3", "Done for today"; a weekdays one at the weekend
  // speaks of its Monday.
  const today_ = isDaily(r.repeat) && p.due_on === today;
  const progress = !mine.length
    ? 'No tasks yet'
    : today_
      ? (done === mine.length ? 'Done for today' : `Today: ${done} of ${mine.length}`)
      : done === mine.length
        ? `Done ${r.repeat === 'monthly' && r.when === 'any_day' ? `for ${monthName(p.due_on)}` : when}`
        : `${done} of ${mine.length} done ${when}`;
  // A daily routine has no Missed lines (Q-D4): a missed day simply moves on to the next.
  const missed = mine
    .filter((t) => !isDaily(r.repeat) && t.missed_on && !t.doneThisTime)
    .map((t) => `Missed ${r.repeat === 'monthly' ? `in ${monthName(t.missed_on!)}` : `by ${shortDate(t.missed_on!)}`}: ${t.title}`);
  return { id: item.id, title: item.title, routine: r, words: routineWords(r), tasks: mine, progress, missed };
}

/** Repeating tasks that belong to no routine ("Repeating on their own", at the bottom). */
export function repeatingAlone(tasks: TaskRow[]): TaskRow[] {
  return tasks.filter((t) => t.repeat && !t.routine && t.status === 'open').sort((a, b) => a.title.localeCompare(b.title));
}

/** What the Routines tab reads: routines (search by type), each one's schedule, and all tasks. */
export interface RoutinesReader {
  search(opts: { item_type: string; limit: number }): Promise<{ id: string; title: string; item_type: string }[]>;
  getItem(id: string): Promise<{ id: string; title: string; item_type: string; metadata?: Record<string, unknown> | null }>;
  findTasks(opts: { status: 'all'; today: string }): Promise<TaskRow[]>;
}

/** The Routines tab: each routine (by name) and the repeating tasks that belong to none. */
export async function loadRoutines(w: RoutinesReader, today: string): Promise<{ routines: RoutineCard[]; alone: TaskRow[] }> {
  const [found, tasks] = await Promise.all([w.search({ item_type: ROUTINE_TYPE, limit: 50 }), w.findTasks({ status: 'all', today })]);
  const items = await Promise.all(found.filter((r) => r.item_type === ROUTINE_TYPE).map((r) => w.getItem(r.id)));
  const routines = items
    .map((it) => {
      const routine = it.item_type === ROUTINE_TYPE ? toRoutine(it.metadata) : null;
      return routine ? routineCard({ id: it.id, title: it.title, routine }, tasks, today) : null;
    })
    .filter((r): r is RoutineCard => r !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
  return { routines, alone: repeatingAlone(tasks) };
}
