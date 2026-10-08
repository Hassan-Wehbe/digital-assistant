// Wilma tasks in the app (day planner step 2, step 5; docs/phase6-day-planner-step2-plan.md
// "Wilma tasks", mockups section 4): a task is a note with item_type "task" whose fields the server
// checks (supabase/functions/mcp/lib/tasks.ts normalizeTask). The app checks the same limits first,
// so the person gets a plain sentence instead of a refusal written for the model, and the server
// refuses anything that looks like a password in any field (rule 9). Pure logic, tested.

export const TASK_TYPE = 'task';
export const MIN_DURATION = 5;
export const MAX_DURATION = 480;
export const TASK_REPEATS = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'] as const;
export type TaskRepeat = (typeof TASK_REPEATS)[number];
export const REPEAT_LABELS: Record<TaskRepeat, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

/** A task's fields as the server keeps them. */
export interface TaskMetadata {
  status: 'open' | 'done';
  priority: 'normal' | 'important';
  due_on?: string;
  duration_min?: number;
  duration_estimated?: boolean;
  place_id?: string;
  address?: string;
  done_at?: string;
  repeat?: TaskRepeat;
  last_done_on?: string;
  planned_at?: string;
}

/** One task as find_tasks lists it. */
export interface TaskRow {
  id: string;
  title: string;
  space: string | null;
  status: 'open' | 'done';
  priority: 'normal' | 'important';
  due_on?: string;
  overdue?: boolean;
  duration_min?: number;
  duration_estimated?: boolean;
  place?: { id: string; title: string };
  address?: string;
  planned_at?: string;
  repeat?: string;
  done_at?: string;
}

export function isTask(itemType: string | null | undefined): boolean {
  return (itemType ?? '').trim().toLowerCase() === TASK_TYPE;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const two = (n: number) => String(n).padStart(2, '0');

/** A real calendar day "YYYY-MM-DD" (not 2026-02-30). */
export function isDay(v: string): boolean {
  const m = DAY.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v && Number(m[1]) >= 1900 && Number(m[1]) <= 2100;
}

/** `day` plus `n` days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 Sunday … 6 Saturday. */
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** "Fri" for a day within the week, else "Oct 12". */
export function shortDay(day: string, today: string): string {
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  const d = new Date(`${day}T12:00:00Z`);
  const within = day > today && day <= addDays(today, 6);
  return d.toLocaleDateString('en-US', within ? { weekday: 'short', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---- The form ----------------------------------------------------------------------------------

export interface TaskForm {
  title: string;
  /** Minutes as typed ("20"); empty for none. */
  duration: string;
  /** A saved place (its note id and name), or a typed address, or neither. */
  place: { id: string; title: string } | null;
  address: string;
  /** "YYYY-MM-DD", or empty for no date. */
  dueOn: string;
  /** A set time to do it (planned_at): its day "YYYY-MM-DD" and time "HH:MM", both or neither. */
  plannedDay: string;
  plannedTime: string;
  repeat: TaskRepeat | null;
  important: boolean;
}

export const EMPTY_TASK: TaskForm = { title: '', duration: '', place: null, address: '', dueOn: '', plannedDay: '', plannedTime: '', repeat: null, important: false };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A planned_at moment as written, "2026-10-09T17:05:00-04:00" → day and time (its own clock, as My day shows it). */
export function plannedParts(at: string | undefined): { day: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(at ?? '');
  return m && isDay(m[1]) && TIME.test(m[2]) ? { day: m[1], time: m[2] } : null;
}

/** A Date from the phone's picker as "YYYY-MM-DD" and "HH:MM" on this phone's clock. */
export function localParts(d: Date): { day: string; time: string } {
  return { day: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(d.getHours())}:${two(d.getMinutes())}` };
}

/** "12:30 pm" for "12:30". */
export function timeText(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${two(m)} ${h < 12 ? 'am' : 'pm'}`;
}

/** The form for a task as saved (its place's name when known). */
export function taskForm(title: string, m: Partial<TaskMetadata> | null, placeTitle?: string): TaskForm {
  return {
    title,
    duration: m?.duration_min ? String(m.duration_min) : '',
    place: m?.place_id ? { id: m.place_id, title: placeTitle ?? 'A saved place' } : null,
    address: m?.address ?? '',
    dueOn: m?.due_on ?? '',
    plannedDay: plannedParts(m?.planned_at)?.day ?? '',
    plannedTime: plannedParts(m?.planned_at)?.time ?? '',
    repeat: m?.repeat && (TASK_REPEATS as readonly string[]).includes(m.repeat) ? m.repeat : null,
    important: m?.priority === 'important',
  };
}

/**
 * The fields to save, or why they cannot be. Fields the form does not show (done, the last day a
 * repeating one was done) are kept from `base`; a set time left as it was keeps its saved moment;
 * a duration the user typed is no longer Wilma's estimate.
 */
export function taskMetadata(form: TaskForm, base: Partial<TaskMetadata> | null = null): { metadata: TaskMetadata } | { error: string } {
  if (!form.title.trim()) return { error: 'Say what the task is.' };
  if (form.title.trim().length > 300) return { error: 'The task can be at most 300 characters.' };
  const out: TaskMetadata = { status: base?.status === 'done' && !form.repeat ? 'done' : 'open', priority: form.important ? 'important' : 'normal' };
  const typed = form.duration.trim();
  if (typed) {
    const n = Number(typed);
    if (!Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
      return { error: `How long: a whole number of minutes from ${MIN_DURATION} to ${MAX_DURATION}.` };
    }
    out.duration_min = n;
    if (base?.duration_estimated && base.duration_min === n) out.duration_estimated = true;
  }
  const due = form.dueOn.trim();
  if (due) {
    if (!isDay(due)) return { error: 'By when: a date like 2026-10-12.' };
    out.due_on = due;
  }
  const address = form.address.trim().replace(/\s+/g, ' ');
  if (form.place && address) return { error: 'Choose a saved place or type an address, not both.' };
  if (address.length > 300) return { error: 'The address can be at most 300 characters.' };
  if (form.place) out.place_id = form.place.id;
  else if (address) out.address = address;
  if (form.repeat) {
    out.repeat = form.repeat;
    if (!out.due_on) return { error: 'A repeating task needs its first date (By when).' };
    if (base?.last_done_on) out.last_done_on = base.last_done_on;
  }
  if (out.status === 'done' && base?.done_at) out.done_at = base.done_at;
  const day = form.plannedDay.trim();
  const time = form.plannedTime.trim();
  if (day || time) {
    if (!isDay(day) || !TIME.test(time)) return { error: 'At a set time: pick both a day and a time, or remove it.' };
    const saved = plannedParts(base?.planned_at);
    const at = saved && saved.day === day && saved.time === time ? base!.planned_at! : plannedAt(`${day}T${time}`);
    if (!at) return { error: 'At a set time: pick both a day and a time, or remove it.' };
    out.planned_at = at;
  }
  return { metadata: out };
}

/** Quick picks for By when: today, tomorrow, the coming Saturday, next Monday (each day once). */
export function duePicks(today: string): { label: string; day: string }[] {
  const toSat = (6 - weekday(today) + 7) % 7 || 7;
  const toMon = (1 - weekday(today) + 7) % 7 || 7;
  const picks = [
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: addDays(today, 1) },
    { label: 'Saturday', day: addDays(today, toSat) },
    { label: 'Next Monday', day: addDays(today, toMon) },
  ];
  // On a Friday, tomorrow is Saturday (and on a Sunday, Monday): one chip per day.
  return picks.filter((p, i) => picks.findIndex((q) => q.day === p.day) === i);
}

// ---- The list ----------------------------------------------------------------------------------

export interface TaskGroups {
  today: TaskRow[];
  week: TaskRow[];
  later: TaskRow[];
  done: TaskRow[];
}

/** Today (overdue, due today, or put in today's plan), this week, later or no date, done. */
export function groupTasks(tasks: TaskRow[], today: string): TaskGroups {
  const out: TaskGroups = { today: [], week: [], later: [], done: [] };
  const weekEnd = addDays(today, 6);
  for (const t of tasks) {
    if (t.status === 'done') out.done.push(t);
    else if ((t.due_on && t.due_on <= today) || t.planned_at?.startsWith(today)) out.today.push(t);
    else if (t.due_on && t.due_on <= weekEnd) out.week.push(t);
    else out.later.push(t);
  }
  return out;
}

/** "20 min · Bright Cleaners · today at 12:30 pm · by Fri · ↻ weekly · important" (whatever the task has). */
export function taskLine(t: TaskRow, today: string): string {
  const parts: string[] = [];
  if (t.duration_min) parts.push(`${t.duration_estimated ? 'about ' : ''}${t.duration_min} min`);
  if (t.place) parts.push(t.place.title);
  else if (t.address) parts.push(t.address);
  const at = plannedParts(t.planned_at);
  if (t.status === 'open' && at) parts.push(`${shortDay(at.day, today)} at ${timeText(at.time)}`);
  if (t.status === 'open' && t.due_on) parts.push(t.overdue || t.due_on < today ? `overdue (${shortDay(t.due_on, today)})` : `by ${shortDay(t.due_on, today)}`);
  if (t.repeat && t.repeat in REPEAT_LABELS) parts.push(`↻ ${REPEAT_LABELS[t.repeat as TaskRepeat].toLowerCase()}`);
  if (t.priority === 'important') parts.push('important');
  return parts.join(' · ');
}

/** find_tasks' answer, checked: unknown fields dropped, anything malformed left out. */
export function toTaskRows(raw: unknown): TaskRow[] {
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : [];
  const out: TaskRow[] = [];
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue;
    const t = r as Record<string, unknown>;
    if (typeof t.id !== 'string' || typeof t.title !== 'string' || !t.title) continue;
    const s = (k: string) => (typeof t[k] === 'string' && t[k] ? (t[k] as string) : undefined);
    const p = t.place as Record<string, unknown> | undefined;
    out.push({
      id: t.id,
      title: t.title.slice(0, 300),
      space: s('space') ?? null,
      status: t.status === 'done' ? 'done' : 'open',
      priority: t.priority === 'important' ? 'important' : 'normal',
      ...(s('due_on') && isDay(s('due_on')!) ? { due_on: s('due_on') } : {}),
      ...(t.overdue === true ? { overdue: true } : {}),
      ...(typeof t.duration_min === 'number' && Number.isInteger(t.duration_min) ? { duration_min: t.duration_min } : {}),
      ...(t.duration_estimated === true ? { duration_estimated: true } : {}),
      ...(p && typeof p.id === 'string' && typeof p.title === 'string' ? { place: { id: p.id, title: p.title } } : {}),
      ...(s('address') ? { address: s('address') } : {}),
      ...(s('planned_at') ? { planned_at: s('planned_at') } : {}),
      ...(s('repeat') ? { repeat: s('repeat') } : {}),
      ...(s('done_at') ? { done_at: s('done_at') } : {}),
    });
  }
  return out;
}

// ---- Putting a task in the day -----------------------------------------------------------------

/**
 * "2026-10-09T17:05" (local, as the planner gives times) as the moment the server keeps for
 * planned_at, with this phone's offset at that time: "2026-10-09T17:05:00-04:00".
 */
export function plannedAt(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (!Number.isFinite(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${local}:00${sign}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`;
}
