// New routine / edit (routines step 3b, mockup 6; docs/routines-plan.md): a name; Repeats (Weekly ·
// Every 2 weeks · Monthly); When (any day, the same day each time, or by a day of the month; Q1,
// Q2); its tasks, each with an optional duration (none means 30 min in My day, Q7); and Suggest in
// My day. Checked here so the person hears about a problem before anything is sent; the server
// checks every field again. Text that looks like a password is held on the phone (rule 9).
import { findCredential } from './credentials';
import { LOOKS_LIKE_SECRET } from './noteEdit';
import type { RoutineMetadata, RoutineRepeat, RoutineWhen } from './routines';
import type { TaskMetadata } from './tasks';

export const MAX_ROUTINE_TASKS = 20;

export interface RoutineTaskForm {
  /** Set for a task already saved. */
  id?: string;
  title: string;
  /** Minutes, as typed; empty for none. */
  duration: string;
}

export interface RoutineForm {
  title: string;
  repeat: RoutineRepeat;
  when: RoutineWhen;
  /** same_day: 0 Sunday … 6 Saturday; by_day: the day of the month, as typed. */
  weekday: number;
  monthDay: string;
  suggest: boolean;
  tasks: RoutineTaskForm[];
}

export const EMPTY_ROUTINE: RoutineForm = {
  title: '',
  repeat: 'weekly',
  when: 'any_day',
  weekday: 6,
  monthDay: '',
  suggest: true,
  tasks: [{ title: '', duration: '' }],
};

export const REPEAT_CHOICES: { value: RoutineRepeat; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

/** The When choices for a kind of repeat (Q1 for weekly kinds, Q2 for monthly). */
export function whenChoices(repeat: RoutineRepeat): { value: RoutineWhen; label: string }[] {
  return repeat === 'monthly'
    ? [{ value: 'any_day', label: 'Any day' }, { value: 'by_day', label: 'By a day of the month' }]
    : [{ value: 'any_day', label: repeat === 'weekly' ? 'Any day that week' : 'Any day those two weeks' }, { value: 'same_day', label: 'Same day each time' }];
}

/** Repeats changed: When goes back to any day if its choice does not fit the new kind. */
export function withRepeat(f: RoutineForm, repeat: RoutineRepeat): RoutineForm {
  const fits = whenChoices(repeat).some((w) => w.value === f.when);
  return { ...f, repeat, when: fits ? f.when : 'any_day' };
}

/** The form for a saved routine and its tasks. */
export function routineForm(title: string, r: RoutineMetadata, tasks: { id: string; title: string; duration_min?: number }[]): RoutineForm {
  return {
    title,
    repeat: r.repeat,
    when: r.when,
    weekday: r.when === 'same_day' && r.day !== undefined ? r.day : 6,
    monthDay: r.when === 'by_day' && r.day !== undefined ? String(r.day) : '',
    suggest: r.suggest,
    tasks: tasks.length
      ? tasks.map((t) => ({ id: t.id, title: t.title, duration: t.duration_min ? String(t.duration_min) : '' }))
      : [{ title: '', duration: '' }],
  };
}

export interface CheckedRoutine {
  title: string;
  /** What the server keeps; starts_on is the server's (kept as is on an edit). */
  metadata: Omit<RoutineMetadata, 'starts_on'>;
  tasks: { id?: string; title: string; duration_min?: number }[];
}

/** The form checked; a short reason when something is missing or wrong. Empty task rows are left out. */
export function checkRoutine(f: RoutineForm): CheckedRoutine | { error: string } {
  const title = f.title.trim();
  if (!title) return { error: 'Give the routine a name, like “Weekend house reset”.' };
  if (title.length > 200) return { error: 'The name is too long (200 characters at most).' };
  const tasks: CheckedRoutine['tasks'] = [];
  for (const t of f.tasks) {
    const name = t.title.trim();
    if (!name) {
      if (t.duration.trim()) return { error: 'A task with a time needs a name too.' };
      continue;
    }
    if (name.length > 300) return { error: `“${name.slice(0, 40)}…” is too long (300 characters at most).` };
    const d = t.duration.trim();
    let duration_min: number | undefined;
    if (d) {
      const n = Number(d);
      if (!/^\d+$/.test(d) || n < 1 || n > 1440) return { error: `How long “${name}” takes: minutes, from 1 to 1440.` };
      duration_min = n;
    }
    tasks.push({ ...(t.id ? { id: t.id } : {}), title: name, ...(duration_min ? { duration_min } : {}) });
  }
  if (!tasks.length) return { error: 'Add at least one task, like “Vacuum”.' };
  if (tasks.length > MAX_ROUTINE_TASKS) return { error: `A routine holds up to ${MAX_ROUTINE_TASKS} tasks.` };
  if (findCredential(title) || tasks.some((t) => findCredential(t.title))) return { error: LOOKS_LIKE_SECRET };

  const metadata: CheckedRoutine['metadata'] = { repeat: f.repeat, when: f.when, suggest: f.suggest };
  if (f.when === 'same_day') {
    if (f.repeat === 'monthly' || !Number.isInteger(f.weekday) || f.weekday < 0 || f.weekday > 6) return { error: 'Pick the day of the week.' };
    metadata.day = f.weekday;
  } else if (f.when === 'by_day') {
    const n = Number(f.monthDay.trim());
    if (f.repeat !== 'monthly' || !/^\d+$/.test(f.monthDay.trim()) || n < 1 || n > 31) return { error: 'By which day of the month? A number from 1 to 31.' };
    metadata.day = n;
  }
  return { title, metadata, tasks };
}

/** What saving changes, against the tasks as they were saved: add, change (name or minutes), remove. */
export interface RoutineSavePlan {
  add: { title: string; duration_min?: number }[];
  change: { id: string; title?: string; duration_min: number | null }[];
  /** Taken out of the routine: to the Recycle bin (rule 8), restorable. */
  remove: string[];
}

export function routineSavePlan(checked: CheckedRoutine, saved: { id: string; title: string; duration_min?: number }[]): RoutineSavePlan {
  const kept = new Map(checked.tasks.filter((t) => t.id).map((t) => [t.id!, t]));
  const plan: RoutineSavePlan = { add: [], change: [], remove: [] };
  for (const t of checked.tasks) if (!t.id) plan.add.push({ title: t.title, ...(t.duration_min ? { duration_min: t.duration_min } : {}) });
  for (const s of saved) {
    const now = kept.get(s.id);
    if (!now) {
      plan.remove.push(s.id);
      continue;
    }
    const minutes = now.duration_min ?? null;
    if (now.title !== s.title || minutes !== (s.duration_min ?? null)) {
      plan.change.push({ id: s.id, ...(now.title !== s.title ? { title: now.title } : {}), duration_min: minutes });
    }
  }
  return plan;
}

/** A new task of the routine: the server gives it the routine's dates. */
export function routineTaskMetadata(routineId: string, durationMin?: number): TaskMetadata {
  return { status: 'open', priority: 'normal', routine_id: routineId, ...(durationMin ? { duration_min: durationMin } : {}) };
}

/** A saved task's fields with new minutes (null: none), everything else as it was. */
export function withMinutes(m: Partial<TaskMetadata>, minutes: number | null): TaskMetadata {
  const { duration_min: _old, duration_estimated: _est, ...rest } = m;
  return { status: 'open', priority: 'normal', ...rest, ...(minutes ? { duration_min: minutes } : {}) } as TaskMetadata;
}
