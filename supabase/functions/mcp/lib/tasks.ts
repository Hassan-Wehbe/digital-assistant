// Wilma tasks (docs/phase6-day-planner-step2-plan.md, design D25): an item with item_type "task"
// whose metadata holds what the day plan needs: when it is due, how long it takes, where it is done,
// how important it is and whether it is done. As with places, the server decides the shape (rule 9
// spirit): save_item / update_item pass task metadata through normalizeTask, which rejects unknown
// fields and out-of-range values with a message the model can act on. Credential-looking values are
// refused before this, by rejectCredentials (every metadata value).
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSpaces, type Space } from "./spaces.ts";
import { momentOf } from "../../_shared/dayplan/time.ts";

export const TASK_TYPE = "task";
/** The space a task goes to when the user names none; created on the first task. */
export const TASKS_SPACE = "Tasks";
export const TASK_PRIORITIES = ["normal", "important"] as const;
/** How a task comes back (owner, 2026-10-08): none means one time, on its due date. */
export const TASK_REPEATS = ["daily", "weekdays", "weekly", "biweekly", "monthly"] as const;
export type TaskRepeat = (typeof TASK_REPEATS)[number];
export const MIN_DURATION = 5;
export const MAX_DURATION = 480;

export interface TaskMetadata {
  status: "open" | "done";
  priority: (typeof TASK_PRIORITIES)[number];
  due_on?: string;
  duration_min?: number;
  /** True when Wilma estimated the duration ("about 20 min"); the user did not say it. */
  duration_estimated?: boolean;
  /** A saved place (item id) where the task is done; checked against the user's places on save. */
  place_id?: string;
  address?: string;
  done_at?: string;
  /** A repeating task: done moves due_on to the next time instead of closing it. */
  repeat?: TaskRepeat;
  /** A repeating task's last day done. */
  last_done_on?: string;
  /** When it is done: the user picked a time (the app's form, a day plan option, or told Wilma); a time with its UTC offset. */
  planned_at?: string;
}

const FIELDS = [
  "status", "priority", "due_on", "duration_min", "duration_estimated", "place_id", "address", "done_at", "planned_at",
  "repeat", "last_done_on",
];

export class TaskError extends Error {}

const fail = (msg: string): never => {
  throw new TaskError(`Task not saved: ${msg}`);
};

export function isTask(itemType: string | null | undefined): boolean {
  return (itemType ?? "").trim().toLowerCase() === TASK_TYPE;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A moment with its offset: 2026-10-09T17:05:00-04:00 or ...Z. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function word<T extends string>(v: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return fail(`${field} must be text`);
  const w = v.trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(w)) return fail(`${field} must be ${allowed.map((a) => `"${a}"`).join(" or ")}`);
  return w as T;
}

/** A calendar date, YYYY-MM-DD, between 1900 and 2100. */
export function taskDate(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return fail(`${field} must be a date like 2026-10-12`);
  const d = v.trim();
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return fail(`${field} is not a real date`);
  const year = t.getUTCFullYear();
  if (year < 1900 || year > 2100) return fail(`${field} must be between 1900 and 2100`);
  return d;
}

/** A local wall-clock time without an offset: "2026-10-09T12:30". */
const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * planned_at as the user said it: a moment with its offset, or (with the phone's time zone) a
 * local time, given the offset that zone has on that day ("2026-11-02T12:30" in New York:
 * -05:00, after the clocks go back). The model never works out an offset itself.
 */
function plannedMoment(v: unknown, timeZone: string | undefined): string | undefined {
  const local = typeof v === "string" ? LOCAL.exec(v.trim()) : null;
  if (!local) return moment(v, "planned_at");
  if (!timeZone) return fail("planned_at must be a time with its offset, like 2026-10-09T17:05:00-04:00");
  taskDate(local[1], "planned_at");
  const wall = v as string;
  const t = momentOf(wall.trim(), timeZone);
  if (t === null) return fail("planned_at must be a local time like 2026-10-09T12:30");
  const off = Math.round((Date.parse(`${wall.trim()}:00Z`) - t) / 60_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${wall.trim()}:00${off < 0 ? "-" : "+"}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`;
}

function moment(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !MOMENT.test(v.trim()) || Number.isNaN(Date.parse(v.trim()))) {
    return fail(`${field} must be a time with its offset, like 2026-10-09T17:05:00-04:00`);
  }
  return v.trim();
}

/**
 * The checked, tidied metadata of a task. Throws TaskError with a short reason when a field is
 * unknown or wrong. A new task is open and normal; marking it done stamps done_at (now) unless
 * given, and reopening it clears done_at. `timeZone`: the phone's, for a local planned_at.
 */
export function normalizeTask(input: Record<string, unknown> | null | undefined, now = new Date(), timeZone?: string): TaskMetadata {
  const m = input ?? {};
  if (typeof m !== "object" || Array.isArray(m)) fail("metadata must be an object");
  const unknown = Object.keys(m).find((k) => !FIELDS.includes(k));
  if (unknown) fail(`unknown task field "${unknown}" (known: ${FIELDS.join(", ")})`);

  const status = word(m.status, "status", ["open", "done"] as const) ?? "open";
  const out: TaskMetadata = { status, priority: word(m.priority, "priority", TASK_PRIORITIES) ?? "normal" };

  const due = taskDate(m.due_on, "due_on");
  if (due) out.due_on = due;

  if (m.duration_min !== undefined && m.duration_min !== null && m.duration_min !== "") {
    const n = typeof m.duration_min === "string" ? Number(m.duration_min) : m.duration_min;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
      fail(`duration_min must be a whole number of minutes from ${MIN_DURATION} to ${MAX_DURATION}`);
    }
    out.duration_min = n as number;
    if (m.duration_estimated !== undefined && m.duration_estimated !== null) {
      if (typeof m.duration_estimated !== "boolean") fail("duration_estimated must be true or false");
      if (m.duration_estimated) out.duration_estimated = true;
    }
  } else if (m.duration_estimated) {
    fail("duration_estimated goes with duration_min");
  }

  if (m.place_id !== undefined && m.place_id !== null && m.place_id !== "") {
    if (typeof m.place_id !== "string" || !UUID.test(m.place_id.trim())) fail("place_id must be the id of a saved place");
    out.place_id = (m.place_id as string).trim().toLowerCase();
  }
  if (m.address !== undefined && m.address !== null) {
    if (typeof m.address !== "string") fail("address must be text");
    const a = (m.address as string).trim().replace(/\s+/g, " ");
    if (a.length > 300) fail("address is longer than 300 characters");
    if (a) out.address = a;
  }
  if (out.place_id && out.address) fail("give either place_id (a saved place) or address, not both");

  const planned = plannedMoment(m.planned_at, timeZone);
  if (planned) out.planned_at = planned;

  const repeat = word(m.repeat === "none" ? undefined : m.repeat, "repeat", TASK_REPEATS);
  if (repeat) {
    // A repeating task is never done for good: it starts on its due date (today when none is given).
    if (status === "done") fail("a repeating task is not done for good; use task_done to move it to its next date");
    out.repeat = repeat;
    out.due_on ??= now.toISOString().slice(0, 10);
    const last = taskDate(m.last_done_on, "last_done_on");
    if (last) out.last_done_on = last;
  } else if (m.last_done_on !== undefined && m.last_done_on !== null && m.last_done_on !== "") {
    fail("last_done_on is only for a repeating task");
  }

  if (status === "done") out.done_at = moment(m.done_at, "done_at") ?? now.toISOString();
  return out;
}

/**
 * "I picked up the dry cleaning": done now (or open again), the rest of the task kept. A repeating
 * task stays open and moves to its next date after today (or after its due date, done early).
 * `today` is the user's local date when known.
 */
export function setTaskDone(
  current: Record<string, unknown> | null | undefined,
  done: boolean,
  now = new Date(),
  today = now.toISOString().slice(0, 10),
): TaskMetadata {
  const m = { ...(current ?? {}) };
  const repeat = typeof m.repeat === "string" && (TASK_REPEATS as readonly string[]).includes(m.repeat) ? m.repeat as TaskRepeat : null;
  if (repeat && done) {
    const due = typeof m.due_on === "string" ? m.due_on : today;
    let next = nextDue(due, repeat);
    while (next <= today) next = nextDue(next, repeat);
    m.status = "open";
    m.due_on = next;
    m.last_done_on = today;
    delete m.done_at;
    delete m.planned_at; // the next time is placed afresh
    return normalizeTask(m, now);
  }
  m.status = done ? "done" : "open";
  delete m.done_at;
  return normalizeTask(m, now);
}

/** The next date a repeating task comes back after `day`. Monthly keeps the day, or the month's last. */
export function nextDue(day: string, repeat: TaskRepeat): string {
  const d = new Date(`${day}T00:00:00Z`);
  const add = (n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  switch (repeat) {
    case "daily":
      return add(1);
    case "weekdays": {
      const dow = d.getUTCDay(); // 0 Sunday … 6 Saturday
      return add(dow === 5 ? 3 : dow === 6 ? 2 : 1);
    }
    case "weekly":
      return add(7);
    case "biweekly":
      return add(14);
    case "monthly": {
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + 1;
      const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, mo, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
    }
  }
}

/**
 * The task's fields as plain lines, added to the text that meaning search reads (item_chunk), so
 * "what's due Friday" or "important things to do" find it.
 */
export function taskText(t: TaskMetadata): string {
  const lines = [
    `Task: ${t.status === "done" ? `done${t.done_at ? ` ${t.done_at.slice(0, 10)}` : ""}` : "to do"}`,
    t.priority === "important" && "Important",
    t.due_on && `Due: ${t.due_on}`,
    t.duration_min && `Takes ${t.duration_estimated ? "about " : ""}${t.duration_min} min`,
    t.address && `Where: ${t.address}`,
    t.repeat && `Repeats: ${REPEAT_WORDS[t.repeat]}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const REPEAT_WORDS: Record<TaskRepeat, string> = {
  daily: "every day", weekdays: "every weekday", weekly: "every week", biweekly: "every two weeks", monthly: "every month",
};

/** The body as meaning search reads it: a task's fields follow the text. */
export function withTask(body: string, task: TaskMetadata | null): string {
  if (!task) return body;
  const fields = taskText(task);
  return body.trim() ? `${body}\n\n${fields}` : fields;
}

/**
 * The space a task is saved in when the user named none: the Tasks space, created on the first
 * task. Never a restricted one: a restricted space called Tasks is the user's own and is left alone,
 * and the error asks which space to use.
 */
export async function tasksSpace(db: SupabaseClient, spaces?: Space[]): Promise<{ space: Space; created: boolean }> {
  const all = spaces ?? await loadSpaces(db);
  const top = all.find((s) => !s.parent_id && s.name.trim().toLowerCase() === TASKS_SPACE.toLowerCase());
  if (top) {
    if (top.is_restricted) throw new Error(`The space "${top.name}" is restricted; ask which space to save the task in.`);
    return { space: top, created: false };
  }
  const { data, error } = await db
    .from("space")
    .insert({ name: TASKS_SPACE, description: "Things to do, with due dates", parent_id: null, is_restricted: false })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create the ${TASKS_SPACE} space: ${error.message}`);
  return {
    space: { id: data.id, name: TASKS_SPACE, description: "Things to do, with due dates", parent_id: null, is_restricted: false, path: TASKS_SPACE },
    created: true,
  };
}
