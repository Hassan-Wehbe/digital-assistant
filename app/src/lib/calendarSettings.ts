// Which calendars Wilma may read (Settings → Calendars): kept on this phone only, per account,
// never sent to the server (docs/phase6-day-planner-step1-plan.md, "How it works" 5). Only the
// on/off switch and the ticked calendars' ids are stored; never a calendar's events.
import type { CalendarChoice } from './calendar';

export interface SettingsStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
}

export const OFF: CalendarChoice = { on: false, ticked: [] };
const MAX_TICKED = 100;

const key = (userId: string) => `wilma.calendars.v1.${userId}`;

/** The choice read back, checked: anything odd is "off". */
export function parseChoice(raw: string | null): CalendarChoice {
  if (!raw) return OFF;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return OFF;
    const { on, ticked } = v as Record<string, unknown>;
    if (on !== true || !Array.isArray(ticked)) return OFF;
    const ids = [...new Set(ticked.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 200))];
    return { on: true, ticked: ids.slice(0, MAX_TICKED) };
  } catch {
    return OFF;
  }
}

export async function loadChoice(store: SettingsStore, userId: string): Promise<CalendarChoice> {
  if (!userId) return OFF;
  try {
    return parseChoice(await store.get(key(userId)));
  } catch {
    return OFF;
  }
}

/** Saves the choice; false when the phone could not write it. Off keeps no calendar ids. */
export async function saveChoice(store: SettingsStore, userId: string, choice: CalendarChoice): Promise<boolean> {
  if (!userId) return false;
  const value: CalendarChoice = choice.on ? { on: true, ticked: [...new Set(choice.ticked)].slice(0, MAX_TICKED) } : OFF;
  try {
    await store.set(key(userId), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The ticked calendars after a tap on one of them. */
export function toggleCalendar(choice: CalendarChoice, id: string): CalendarChoice {
  const ticked = choice.ticked.includes(id) ? choice.ticked.filter((t) => t !== id) : [...choice.ticked, id];
  return { on: choice.on, ticked };
}
