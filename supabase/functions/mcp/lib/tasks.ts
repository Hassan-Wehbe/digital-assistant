// Wilma tasks (docs/phase6-day-planner-step2-plan.md, design D25): an item with item_type "task"
// whose metadata holds what the day plan needs: when it is due, how long it takes, where it is done,
// how important it is and whether it is done. As with places, the server decides the shape (rule 9
// spirit): save_item / update_item pass task metadata through normalizeTask, which rejects unknown
// fields and out-of-range values with a message the model can act on. Credential-looking values are
// refused before this, by rejectCredentials (every metadata value).
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSpaces, type Space } from "./spaces.ts";

export const TASK_TYPE = "task";
/** The space a task goes to when the user names none; created on the first task. */
export const TASKS_SPACE = "Tasks";
export const TASK_PRIORITIES = ["normal", "important"] as const;
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
  /** When the day plan put it (the user picked that option); a time with its UTC offset. */
  planned_at?: string;
}

const FIELDS = [
  "status", "priority", "due_on", "duration_min", "duration_estimated", "place_id", "address", "done_at", "planned_at",
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
 * given, and reopening it clears done_at.
 */
export function normalizeTask(input: Record<string, unknown> | null | undefined, now = new Date()): TaskMetadata {
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

  const planned = moment(m.planned_at, "planned_at");
  if (planned) out.planned_at = planned;

  if (status === "done") out.done_at = moment(m.done_at, "done_at") ?? now.toISOString();
  return out;
}

/** "I picked up the dry cleaning": done now (or open again), the rest of the task kept. */
export function setTaskDone(current: Record<string, unknown> | null | undefined, done: boolean, now = new Date()): TaskMetadata {
  const m = { ...(current ?? {}) };
  m.status = done ? "done" : "open";
  delete m.done_at;
  return normalizeTask(m, now);
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
  ];
  return lines.filter(Boolean).join("\n");
}

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
