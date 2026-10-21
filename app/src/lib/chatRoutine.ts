// The chat's 🔁 Save routine card (routines step 4, docs/routines-plan.md; design D39): Wilma's
// `routine_save` event (chat/phone_actions.ts save_routine) holds a routine's name, schedule and
// tasks; nothing is saved until the user taps Save routine. The tap saves it the way the New
// routine screen does (routineForm.ts: the same checks, password-like text held on the phone, rule
// 9), and the card then keeps the routine's id, so a reopened chat says Saved · Open and never
// offers to save it twice.
import { checkRoutine, type RoutineForm } from './routineForm';
import { toRoutine, type RoutineMetadata, routineWords } from './routines';

export const MAX_CARD_TASKS = 20;

export interface RoutineCardData {
  name: string;
  routine: RoutineMetadata;
  tasks: { title: string; minutes?: number }[];
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The card from the event (or from a saved chat), checked field by field; null when it is not one. */
export function toRoutineCard(raw: unknown): RoutineCardData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !oneLine(r.name) || r.name.length > 200) return null;
  // The server's event has the schedule's fields alongside the name; a saved chat keeps them under `routine`.
  const src = typeof r.routine === 'object' && r.routine !== null ? (r.routine as Record<string, unknown>) : r;
  const routine = toRoutine({ repeat: src.repeat, when: src.when, day: src.day, suggest: src.suggest, at: src.at });
  if (!routine || !Array.isArray(r.tasks) || !r.tasks.length || r.tasks.length > MAX_CARD_TASKS) return null;
  const tasks: RoutineCardData['tasks'] = [];
  for (const t of r.tasks) {
    if (typeof t !== 'object' || t === null) return null;
    const { title, minutes } = t as Record<string, unknown>;
    if (typeof title !== 'string' || !oneLine(title) || title.length > 300) return null;
    const m = typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : undefined;
    tasks.push({ title: oneLine(title), ...(m ? { minutes: m } : {}) });
  }
  return { name: oneLine(r.name), routine, tasks };
}

/** What the card says under the name: "Every Saturday · 3 tasks". */
export function routineCardLine(c: RoutineCardData): string {
  return `${routineWords(c.routine)} · ${c.tasks.length} task${c.tasks.length === 1 ? '' : 's'}${c.routine.suggest ? '' : ' · not suggested in My day'}`;
}

/** The card as the New routine form, for the same checks. */
export function cardForm(c: RoutineCardData): RoutineForm {
  return {
    title: c.name,
    repeat: c.routine.repeat,
    when: c.routine.when,
    weekday: c.routine.when === 'same_day' ? c.routine.day! : 6,
    monthDay: c.routine.when === 'by_day' ? String(c.routine.day) : '',
    at: c.routine.at ?? '',
    suggest: c.routine.suggest,
    tasks: c.tasks.map((t) => ({ title: t.title, duration: t.minutes ? String(t.minutes) : '' })),
  };
}

/** What the tap needs from Wilma's client. */
export interface RoutineSaver {
  saveRoutine(r: { title: string; metadata: Omit<RoutineMetadata, 'starts_on'> }): Promise<{ id: string }>;
  saveTask(t: { title: string; metadata: { status: 'open'; priority: 'normal'; routine_id: string; duration_min?: number } }): Promise<{ id: string }>;
}

/**
 * Save routine: the routine, then each task. Its id comes back as soon as the routine is saved
 * (`onRoutine`), so a stop half way leaves the card knowing it, and Try again (`resume`) adds only
 * the tasks not saved yet.
 */
export async function saveRoutineCard(
  w: RoutineSaver,
  c: RoutineCardData,
  resume: { routineId: string; tasksSaved: number } | null,
  onProgress: (p: { routineId: string; tasksSaved: number }) => void,
): Promise<{ routineId: string } | { error: string }> {
  const checked = checkRoutine(cardForm(c));
  if ('error' in checked) return { error: checked.error };
  let routineId = resume?.routineId;
  let saved = resume?.tasksSaved ?? 0;
  if (!routineId || !UUID.test(routineId)) {
    routineId = (await w.saveRoutine({ title: checked.title, metadata: checked.metadata })).id;
    saved = 0;
    onProgress({ routineId, tasksSaved: 0 });
  }
  for (const t of checked.tasks.slice(saved)) {
    await w.saveTask({ title: t.title, metadata: { status: 'open', priority: 'normal', routine_id: routineId, ...(t.duration_min ? { duration_min: t.duration_min } : {}) } });
    saved += 1;
    onProgress({ routineId, tasksSaved: saved });
  }
  return { routineId };
}
