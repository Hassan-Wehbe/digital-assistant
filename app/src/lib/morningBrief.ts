// Your morning, on Home (day planner step 4, step 3; docs/phase6-day-planner-step4-plan.md): with
// the briefing on ("In Wilma only" or "In Wilma and as a notification"), the first time Wilma is
// opened after the briefing time, today's plan is made the way My day makes it (the ticked
// calendars, read then; places; the planner) and its summary is shown. Once a day; pull to refresh
// makes it again. With the briefing off, nothing here reads the calendar or asks for a plan.
//
// Kept on the phone: only the day it was made and the day it was hidden (dates, per account). The
// plan and its summary stay in memory, as My day's do (Mapbox's terms, dayPlan.ts).
import type { BriefingSettings } from './briefingSettings';
import type { AgendaResult, CalendarChoice } from './calendar';
import type { SettingsStore } from './calendarSettings';
import { summaryOf } from './dayAlerts';
import { dayBody, placeEvents, withKeys, type Geocode } from './dayAgenda';
import type { DayMemory } from './dayChoices';
import type { DayAnswer, DayBody, DayPlan } from './dayPlan';
import { todayAndTomorrow } from './dayView';

/** What the card does now: nothing, make today's, or offer to make it again (made earlier today). */
export type MorningStep = 'hidden' | 'make' | 'made_earlier';

export interface MorningMarks {
  /** The day the briefing was last made automatically. */
  made?: string;
  /** The day "Hide for today" was tapped. */
  hidden?: string;
}

const key = (userId: string) => `wilma.morning.v1.${userId}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadMarks(store: SettingsStore, userId: string): Promise<MorningMarks> {
  try {
    const v = JSON.parse((await store.get(key(userId))) ?? '{}') as Record<string, unknown>;
    return {
      ...(typeof v.made === 'string' && DATE.test(v.made) ? { made: v.made } : {}),
      ...(typeof v.hidden === 'string' && DATE.test(v.hidden) ? { hidden: v.hidden } : {}),
    };
  } catch {
    return {};
  }
}

export async function saveMarks(store: SettingsStore, userId: string, marks: MorningMarks): Promise<void> {
  try {
    await store.set(key(userId), JSON.stringify(marks));
  } catch {
    // At worst the briefing is made once more today.
  }
}

/** What the card should do at `now`, from the settings and what was done today. */
export function morningStep(s: BriefingSettings, marks: MorningMarks, now: Date): MorningStep {
  if (s.briefing === 'off') return 'hidden';
  const today = todayAndTomorrow(now).today;
  const [h, m] = s.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return 'hidden';
  if (marks.hidden === today) return 'hidden';
  return marks.made === today ? 'made_earlier' : 'make';
}

export interface MorningDeps {
  calendarChoice(): Promise<CalendarChoice>;
  readAgenda(choice: CalendarChoice, date: string, timeZone: string | null): Promise<AgendaResult>;
  memory(): Promise<DayMemory>;
  geocode?: Geocode;
  plan(body: DayBody): Promise<DayAnswer>;
  timeZone: string | null;
}

export type MorningResult =
  | { plan: DayPlan; summary: string }
  | { problem: 'calendar' | 'pro' | 'limit' | 'connection' };

/** Today's plan and its summary, made as My day makes it. Never throws. */
export async function makeMorning(deps: MorningDeps, now: Date, nowText: string): Promise<MorningResult> {
  try {
    const date = todayAndTomorrow(now).today;
    const read = await deps.readAgenda(await deps.calendarChoice(), date, deps.timeZone);
    if ('problem' in read) return { problem: 'calendar' };
    const memory = await deps.memory();
    const placed = await placeEvents(withKeys(read.agenda.events), memory, deps.geocode);
    const got = await deps.plan(dayBody(date, read.agenda.time_zone, nowText, placed.events, memory));
    if ('plan' in got) return { plan: got.plan, summary: summaryOf(got.plan) };
    if (got.problem === 'pro_required') return { problem: 'pro' };
    if (got.problem === 'fair_use') return { problem: 'limit' };
    return { problem: 'connection' };
  } catch {
    return { problem: 'connection' };
  }
}

/** The card's words for a problem. */
export const MORNING_PROBLEM: Record<'calendar' | 'limit' | 'connection', string> = {
  calendar: 'Wilma can’t read your calendar. Turn it on in Settings → Calendars.',
  limit: 'My day has reached today’s limit, so your morning can’t be made again today.',
  connection: 'Couldn’t make your morning just now. Pull down to try again.',
};
