import { z } from "zod";
import { resolveSpace, type Space } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { placeScope, visiblePlaces } from "../lib/places.ts";
import { normalizeTask, type TaskMetadata, TASK_TYPE, taskDate } from "../lib/tasks.ts";
import { atDayEnd } from "../lib/day_end.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

/** At most this many tasks are read per call; plenty for one person's list. */
export const MAX_TASKS_SCANNED = 1000;

interface TaskRow {
  id: string;
  title: string;
  space_id: string;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

/** The space and every space below it. */
function subtree(spaces: Space[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of spaces) {
      if (s.parent_id && out.has(s.parent_id) && !out.has(s.id)) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

/** A task's fields as stored, or a plain open task when an older or hand-edited one does not check. */
function fieldsOf(metadata: Record<string, unknown> | null): TaskMetadata {
  try {
    return normalizeTask(metadata ?? {});
  } catch {
    return { status: metadata?.status === "done" ? "done" : "open", priority: "normal" };
  }
}

/**
 * The user's tasks (docs/phase6-day-planner-step2-plan.md): open ones by default, overdue first,
 * then by due date (important first on the same day), tasks without a date last. Only the user's
 * own tasks in searchable spaces are read: restricted spaces (and spaces under them) never (rule 3).
 */
export const registerFindTasks: RegisterTool = (server, { db, assistantName, timeZone }) => {
  server.registerTool(
    "find_tasks",
    {
      title: "Find tasks",
      description:
        'The user\'s tasks (items with item_type "task"): what they have to do, with due date, duration, ' +
        "priority and place. Open tasks by default; due_by (YYYY-MM-DD) keeps those due on or before that " +
        "date (overdue ones included), plus tasks with no due date unless include_undated is false. " +
        "today (the user's local date) marks overdue ones. summary says the answer in one sentence. " +
        "Restricted spaces are never searched." +
        addressedAs(assistantName, "what do I have to do today?"),
      inputSchema: {
        status: z.enum(["open", "done", "all"]).optional().describe('Default "open"'),
        due_by: z.string().optional().describe("Only tasks due on or before this date, YYYY-MM-DD"),
        include_undated: z.boolean().optional().describe("With due_by: also tasks with no due date (default true)"),
        today: z.string().optional().describe("The user's local date, YYYY-MM-DD, to mark overdue tasks"),
        space: z.string().optional().describe("Only this space and its sub-spaces (name, path or id)"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        const status = args.status ?? "open";
        const dueBy = taskDate(args.due_by, "due_by");
        const today = taskDate(args.today, "today");
        const includeUndated = args.include_undated ?? true;
        const limit = args.limit ?? 30;

        const { spaces, allowed } = await placeScope(db);
        let scope = new Set(allowed);
        if (args.space?.trim()) {
          const root = resolveSpace(spaces, args.space);
          const under = subtree(spaces, root.id);
          scope = new Set(allowed.filter((id) => under.has(id)));
        }
        const empty = { summary: "No tasks found.", tasks: [], count: 0 };
        if (!scope.size) return ok(empty);

        const { data, error } = await db
          .from("item")
          .select("id, title, space_id, item_type, metadata, updated_at, deleted_at")
          .eq("item_type", TASK_TYPE)
          .is("deleted_at", null)
          .in("space_id", [...scope])
          .limit(MAX_TASKS_SCANNED);
        if (error) throw dbError("Could not read tasks", error);

        const pathOf = new Map(spaces.map((s) => [s.id, s.path]));
        // Checked again here, whatever the database returned (rule 3).
        const rows = ((data ?? []) as (TaskRow & { item_type: string; deleted_at: string | null })[])
          .filter((r) => r.item_type === TASK_TYPE && !r.deleted_at && scope.has(r.space_id));
        // A task whose day ended is shown done or moved, as the user chose (D35); read-only here,
        // My day writes it.
        const now = Date.now();
        const matching = rows
          .map((r) => ({ row: r, t: atDayEnd(fieldsOf(r.metadata), { now, tz: timeZone, today }).task }))
          .filter(({ t }) => status === "all" || t.status === status)
          .filter(({ t }) => !dueBy || (t.due_on ? t.due_on <= dueBy : includeUndated));

        const rank = (t: TaskMetadata) => t.due_on ?? "9999-99-99";
        matching.sort((a, b) =>
          rank(a.t).localeCompare(rank(b.t)) ||
          (a.t.priority === b.t.priority ? 0 : a.t.priority === "important" ? -1 : 1) ||
          a.row.title.localeCompare(b.row.title)
        );
        const shown = matching.slice(0, limit);

        const placeIds = shown.map(({ t }) => t.place_id).filter((id): id is string => !!id);
        const places = await visiblePlaces(db, placeIds);
        const tasks = shown.map(({ row, t }) => {
          const place = t.place_id ? places.get(t.place_id) : undefined;
          return {
            id: row.id,
            title: row.title,
            space: pathOf.get(row.space_id) ?? null,
            status: t.status,
            priority: t.priority,
            ...(t.due_on ? { due_on: t.due_on } : {}),
            ...(today && t.status === "open" && t.due_on && t.due_on < today ? { overdue: true } : {}),
            ...(t.duration_min ? { duration_min: t.duration_min } : {}),
            ...(t.duration_estimated ? { duration_estimated: true } : {}),
            // A place the user can no longer see (deleted, moved to a restricted space) is left out.
            ...(place ? { place: { id: place.id, title: place.title } } : {}),
            ...(t.address ? { address: t.address } : {}),
            ...(t.planned_at ? { planned_at: t.planned_at } : {}),
            ...(t.repeat ? { repeat: t.repeat } : {}),
            ...(t.last_done_on ? { last_done_on: t.last_done_on } : {}),
            ...(t.done_at ? { done_at: t.done_at } : {}),
          };
        });

        const n = matching.length;
        const overdue = tasks.filter((t) => "overdue" in t).length;
        const what = status === "done" ? "done" : status === "all" ? "" : "open";
        const summary = n === 0
          ? `No ${what ? what + " " : ""}tasks${dueBy ? ` due by ${dueBy}` : ""}.`
          : `${n} ${what ? what + " " : ""}task${n === 1 ? "" : "s"}${dueBy ? ` due by ${dueBy}${includeUndated ? " or with no date" : ""}` : ""}` +
            `${overdue ? `, ${overdue} overdue` : ""}${n > shown.length ? `; the first ${shown.length} are listed` : ""}.`;
        return ok({ summary, count: n, tasks });
      }),
  );
};
