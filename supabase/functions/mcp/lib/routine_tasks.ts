// Routines and their tasks in the database (docs/routines-plan.md step 1, D39): loading a routine
// the user owns, the tasks that belong to it, and keeping those tasks in step with the routine's
// schedule. Only the user's own items in searchable spaces are read (rule 3); every write goes
// through update_item, so the previous version is kept (rule 7).
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Chunk, chunkAndEmbed, hasPending } from "./embed.ts";
import { placeScope } from "./places.ts";
import { isRoutine, normalizeRoutine, ROUTINE_TYPE, type RoutineMetadata, withRoutine } from "./routines.ts";
import { normalizeTask, TASK_TYPE, type TaskMetadata, withTask } from "./tasks.ts";
import { localTime } from "../../_shared/dayplan/time.ts";

/** At most this many items are read per call (as find_tasks). */
const MAX_SCANNED = 1000;
/** At most this many tasks are brought in step per routine change; plenty for one routine. */
export const MAX_ROUTINE_TASKS = 50;

/** The user's date: the phone's when sent, else in their time zone, else UTC. */
export function userToday(given: string | undefined, timeZone: string | undefined, now = Date.now()): string {
  if (given) return given;
  return (timeZone && localTime(now, timeZone)?.slice(0, 10)) || new Date(now).toISOString().slice(0, 10);
}

export interface LoadedRoutine {
  id: string;
  title: string;
  routine: RoutineMetadata;
}

/** The user's own, live routine, or null (none, someone else's, in the bin, not a routine). */
export async function findRoutine(db: SupabaseClient, id: string, today: string): Promise<LoadedRoutine | null> {
  const { data, error } = await db.rpc("get_item", { p_item_id: id });
  if (error) throw new Error(`Could not load the routine: ${error.message}`);
  const item = data as { id: string; title: string; item_type: string; metadata: Record<string, unknown> } | null;
  if (!item || !isRoutine(item.item_type)) return null;
  try {
    return { id: item.id, title: item.title, routine: normalizeRoutine(item.metadata, today) };
  } catch {
    return null;
  }
}

/** As findRoutine, with an error the model can act on when there is no such routine. */
export async function loadRoutine(db: SupabaseClient, id: string, today: string): Promise<LoadedRoutine> {
  const found = await findRoutine(db, id, today);
  if (!found) throw new Error("Task not saved: routine_id is not one of your routines");
  return found;
}

interface Row {
  id: string;
  title: string;
  space_id: string;
  item_type: string;
  metadata: Record<string, unknown> | null;
  deleted_at: string | null;
}

/** Live items of one type in the user's searchable spaces. */
async function liveOfType(db: SupabaseClient, type: string): Promise<Row[]> {
  const { allowed } = await placeScope(db);
  if (!allowed.length) return [];
  const scope = new Set(allowed);
  const { data, error } = await db
    .from("item")
    .select("id, title, space_id, item_type, metadata, deleted_at")
    .eq("item_type", type)
    .is("deleted_at", null)
    .in("space_id", allowed)
    .limit(MAX_SCANNED);
  if (error) throw new Error(`Could not read ${type}s: ${error.message}`);
  // Checked again here, whatever the database returned (rule 3).
  return ((data ?? []) as Row[]).filter((r) => r.item_type === type && !r.deleted_at && scope.has(r.space_id));
}

/** The user's routines by id (title and schedule); one that does not check is left out. */
export async function loadRoutines(db: SupabaseClient, today: string): Promise<Map<string, LoadedRoutine>> {
  const out = new Map<string, LoadedRoutine>();
  for (const r of await liveOfType(db, ROUTINE_TYPE)) {
    try {
      out.set(r.id, { id: r.id, title: r.title, routine: normalizeRoutine(r.metadata, today) });
    } catch {
      // A hand-edited routine that no longer checks: its tasks keep the dates they have.
    }
  }
  return out;
}

/** The routine's live tasks, at most MAX_ROUTINE_TASKS. */
export async function tasksOfRoutine(db: SupabaseClient, routineId: string): Promise<Row[]> {
  return (await liveOfType(db, TASK_TYPE)).filter((r) => r.metadata?.routine_id === routineId).slice(0, MAX_ROUTINE_TASKS);
}

/**
 * After a routine is saved or its schedule changes: each of its tasks gets the routine's repeat and
 * the period today is in (the next one if it was done in this one). A task whose dates are already
 * right is left alone. Returns how many were changed, and whether search text waits to be embedded.
 */
export async function bringTasksInStep(
  db: SupabaseClient,
  loaded: LoadedRoutine,
  today: string,
): Promise<{ changed: number; pending: boolean }> {
  let changed = 0;
  let pending = false;
  for (const row of await tasksOfRoutine(db, loaded.id)) {
    let task: TaskMetadata;
    try {
      task = normalizeTask(row.metadata ?? {});
    } catch {
      continue; // a task that no longer checks is left as it is
    }
    const next = withRoutine(task, loaded.id, loaded.routine, today);
    if (sameFields(next, task)) continue;
    if (await saveTaskFields(db, row.id, next, "Kept in step with its routine")) pending = true;
    changed++;
  }
  return { changed, pending };
}

/** The same fields and values, whatever their order. */
export function sameFields(a: object, b: object): boolean {
  const sorted = (o: object) => JSON.stringify(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  return sorted(a) === sorted(b);
}

/**
 * Writes a task's new fields through update_item (a revision first, rule 7) and re-indexes it.
 * Returns whether its search text waits to be embedded (the caller schedules it).
 */
export async function saveTaskFields(db: SupabaseClient, id: string, task: TaskMetadata, note: string): Promise<boolean> {
  const { data, error: getErr } = await db.rpc("get_item", { p_item_id: id });
  if (getErr || !data) throw new Error(`Could not load a task: ${getErr?.message ?? "not found"}`);
  const item = data as { title: string; summary: string | null; body_markdown: string };
  const chunks: Chunk[] = await chunkAndEmbed({ title: item.title, summary: item.summary, body: withTask(item.body_markdown, task) });
  const { error } = await db.rpc("update_item", {
    p_item_id: id, p_title: null, p_body: null, p_summary: null, p_metadata: task, p_item_type: null,
    p_space_id: null, p_tags: null, p_change_note: note, p_chunks: chunks,
  });
  if (error) throw new Error(`Could not update a task: ${error.message}`);
  return hasPending(chunks);
}
