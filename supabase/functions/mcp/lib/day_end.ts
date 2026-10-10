// Tasks left open at the end of their day (docs/task-day-end-plan.md, design D35). A task given a
// time (planned_at) can say what happens if it is still open when that day ends (day_end):
//
//   "done"      marked done, done_at the end of that day;
//   "next_day"  its time removed and due the next day (or earlier, if it already was), so it comes
//               into the next day's plan to find a time for, and on as an overdue task until done;
//   none        nothing changes; the plan of a later day lists it as left open (left_from) and the
//               app asks: Add to today · Done · Remove.
//
// Nothing runs at midnight: atDayEnd works out a task's state as of now wherever a task is read
// (find_tasks shows it, read-only), and My day writes it (saveDayEnd) the first time it plans a
// later day, through update_item, so the previous version goes to item_revision (rule 7).
import type { SupabaseClient } from "@supabase/supabase-js";
import { localTime } from "../../_shared/dayplan/time.ts";
import { chunkAndEmbed } from "./embed.ts";
import { normalizeTask, type TaskMetadata, withTask } from "./tasks.ts";

/** Tasks My day settles in one plan: each one re-indexes its search text, which costs CPU time. */
export const MAX_SETTLES_PER_PLAN = 3;

export const CHANGE_NOTES = {
  done: "Marked done at the end of its day",
  next_day: "Moved to the next day",
} as const;

export interface DayEnd {
  /** The task as of now: unchanged, or done, or moved to the next day. */
  task: TaskMetadata;
  /** What changed, to be written (My day) or only shown (find_tasks). */
  settle?: "done" | "next_day";
  /** Still open with no choice: the day it was planned for, which has ended. */
  left_from?: string;
}

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

/** "-04:00" → -240; "Z" → 0. */
function offsetMinutes(offset: string): number {
  if (offset === "Z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
}

/** The day after "2026-10-09". */
export function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The local day of planned_at: in the phone's time zone when known (as My day shows it), else in
 * the offset it was saved with (the phone's when the time was picked).
 */
export function plannedDay(plannedAt: string, tz?: string): string | undefined {
  if (tz) return localTime(plannedAt, tz)?.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.exec(plannedAt)?.[0];
}

/** Today: in the phone's time zone when known, else in planned_at's own offset. */
function todayFor(plannedAt: string, now: number, tz?: string): string | undefined {
  if (tz) return localTime(now, tz)?.slice(0, 10);
  const off = OFFSET.exec(plannedAt)?.[1];
  if (!off) return undefined;
  return new Date(now + offsetMinutes(off) * 60_000).toISOString().slice(0, 10);
}

/**
 * A task as of `now`. Only an open task whose planned_at day has ended changes; any other task is
 * returned as it is. `today` (the user's local date) wins over working it out from `now`.
 */
export function atDayEnd(t: TaskMetadata, when: { now: number; tz?: string; today?: string }): DayEnd {
  if (t.status !== "open" || !t.planned_at) return { task: t };
  const day = plannedDay(t.planned_at, when.tz);
  const today = when.today ?? todayFor(t.planned_at, when.now, when.tz);
  if (!day || !today || day >= today) return { task: t };

  if (t.day_end === "done") {
    const off = OFFSET.exec(t.planned_at)?.[1] ?? "Z";
    const { day_end: _, ...rest } = t;
    return { task: { ...rest, status: "done", done_at: `${day}T23:59:00${off}` }, settle: "done" };
  }
  if (t.day_end === "next_day") {
    const { day_end: _, planned_at: __, ...rest } = t;
    const next = nextDay(day);
    return { task: { ...rest, due_on: t.due_on && t.due_on < next ? t.due_on : next }, settle: "next_day" };
  }
  return { task: t, left_from: day };
}

/**
 * Writes a settled task (My day), as the user (RLS). Left alone when the task changed since it was
 * read (edited, done, or settled by another plan at the same moment): returns false. Its search
 * text is rebuilt like any edit (only the current version is chunked, rule 7).
 */
export async function saveDayEnd(db: SupabaseClient, itemId: string, readPlannedAt: string, end: DayEnd): Promise<boolean> {
  if (!end.settle) return false;
  const { data, error } = await db.rpc("get_item", { p_item_id: itemId });
  if (error) throw new Error(`db:${error.code ?? "get_item"}`);
  const current = data as { title: string; summary: string | null; body_markdown: string; metadata: Record<string, unknown> | null } | null;
  if (!current || current.metadata?.planned_at !== readPlannedAt || current.metadata?.status !== "open") return false;
  const task = normalizeTask(end.task as unknown as Record<string, unknown>);
  const chunks = await chunkAndEmbed({ title: current.title, summary: current.summary, body: withTask(current.body_markdown, task) });
  const { error: upErr } = await db.rpc("update_item", {
    p_item_id: itemId,
    p_title: null,
    p_body: null,
    p_summary: null,
    p_metadata: task,
    p_item_type: null,
    p_space_id: null,
    p_tags: null,
    p_change_note: CHANGE_NOTES[end.settle],
    p_chunks: chunks,
  });
  if (upErr) throw new Error(`db:${upErr.code ?? "update_item"}`);
  return true;
}
