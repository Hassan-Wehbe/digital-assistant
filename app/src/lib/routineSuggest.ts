// My day → From your routines (routines step 3, docs/routines-plan.md; design D39): the routine
// tasks the planner fitted into free time today (plan.suggestions, worked out by code on the
// server, no AI). Add puts one at its time (the same write as picking a Find a time option);
// ✕ Not today is kept on the server for that day (task_not_today, Q5), so it holds on every device,
// and writes no revision. Up to 3 show; the others wait their turn and come in as one is added or
// dismissed (Q4), because the plan is asked for again after each. A daily routine is one line
// ("Daily routines", Q-D2): Add puts each of its tasks at its own time, ✕ is Not today for all of them.
import type { DayPlan, NotPlacedTask, RoutineSuggestion } from './dayPlan';
import { clock, minutesText } from './dayView';

/** "Weekend reset · about 30 min" (Q7: no duration given means 30 min, said as "about"); a daily routine's line: "Make bed, Vitamins, Stretch · 20 min". */
export function suggestionDetail(s: RoutineSuggestion): string {
  const what = s.tasks ? s.tasks.map((t) => t.title).join(', ') : s.routine;
  return `${what} · ${s.duration_assumed ? 'about ' : ''}${minutesText(s.duration_min)}`;
}

/** The tasks a line stands for, each at its time: a daily routine's, or the one task. */
export function suggestionTasks(s: RoutineSuggestion): { task_id: string; title: string; start?: string }[] {
  return s.tasks ? s.tasks.map((t) => ({ task_id: t.task_id, title: t.title, start: t.start })) : [{ task_id: s.task_id, title: s.title, start: s.start }];
}

/** "Add 9:45 am", or "Find a time" for a task with a place (its drive is worked out there). */
export function suggestionAction(s: RoutineSuggestion): string {
  return s.start ? `Add ${clock(s.start)}` : 'Find a time';
}

/** The suggestions that have a time, for Add all (only when there are two or more). */
export function addable(plan: DayPlan): RoutineSuggestion[] {
  return (plan.suggestions?.items ?? []).filter((s) => s.start);
}

/** "2 more waiting: one comes in when you add or dismiss one." */
export function moreText(more: number): string | null {
  if (more <= 0) return null;
  return `${more} more waiting: ${more === 1 ? 'it comes' : 'one comes'} in when you add or dismiss one.`;
}

/** "Not placed yet" without the tasks already offered above it (each shows once). */
export function notSuggested(tasks: NotPlacedTask[], plan: DayPlan): NotPlacedTask[] {
  const offered = new Set((plan.suggestions?.items ?? []).flatMap((s) => suggestionTasks(s).map((t) => t.task_id)));
  return tasks.filter((t) => !offered.has(t.id));
}

/** Your morning's line (Q3): a count only, no titles. Null when nothing fits today. */
export function routineCountLine(plan: DayPlan): string | null {
  const n = addable(plan).reduce((k, s) => k + suggestionTasks(s).length, 0);
  if (!n) return null;
  return `${n} routine task${n === 1 ? '' : 's'} fit${n === 1 ? 's' : ''} today.`;
}

type Insert = (row: { task_id: string; day: string }) => PromiseLike<{ error: { code?: string; message: string } | null }>;

/** The database as ✕ needs it: an insert into task_not_today (RLS: the user's own rows only). */
export interface NotTodayDb {
  from(table: 'task_not_today'): { insert: Insert };
}

/**
 * ✕ Not today: kept on the server for `day`. Already dismissed (a second tap, another device) is
 * fine. Only a task id and a date are sent, never its title.
 */
export async function dismissForDay(db: NotTodayDb, taskId: string, day: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { error } = await db.from('task_not_today').insert({ task_id: taskId, day });
    if (!error || error.code === '23505') return { ok: true };
    return { error: 'Could not save Not today just now. Check your connection and try again.' };
  } catch {
    return { error: 'Could not save Not today just now. Check your connection and try again.' };
  }
}
