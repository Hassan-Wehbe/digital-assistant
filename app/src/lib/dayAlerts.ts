// The notifications Wilma makes from a day plan (day planner step 4,
// docs/phase6-day-planner-step4-plan.md): leave-by alerts for the drives, the morning greeting,
// and the short summary of a day. Pure functions: every time and name comes from the plan
// (dayPlan.ts) and the settings (briefingSettings.ts); notifications.ts schedules them.
//
// The plan's times are the phone's local time ("2026-10-09T16:10"): the plan is made for the
// phone's own time zone, so they are read as local times here.
import type { BriefingSettings } from './briefingSettings';
import type { DayDriveRow, DayPlan } from './dayPlan';
import { clock, titles, todayAndTomorrow } from './dayView';

/** One notification to schedule. `id` starts with "wilma.<date>." so a day's set can be replaced. */
export interface DayNote {
  id: string;
  at: Date;
  title: string;
  body: string;
  /** The screen a tap opens. */
  url: string;
}

/** How many mornings ahead are scheduled (one-offs, so a day's summary can replace its greeting). */
export const MORNINGS_AHEAD = 7;

export const MORNING_TITLE = 'Good morning';
export const MORNING_BODY = 'Tap to see your day.';

/** "2026-10-09T16:10" → that local time on this phone; null when it is not one. */
export function localTime(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const out = new Date(y, mo - 1, d, h, mi);
  return Number.isFinite(out.getTime()) ? out : null;
}

const names = (keys: string[], t: Map<string, string>) => {
  const list = [...new Set(keys.map((k) => t.get(k) ?? 'an event'))];
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
};

/** A drive to an event, with a leave-by time and a drive time: the ones worth an alert. */
const timedDrive = (r: DayDriveRow) => !!r.leave_at && r.minutes !== undefined && !r.unavailable && r.for_keys.length > 0;

/** "Leave by 4:10 pm for Swim: Sara" (a pick-up: "Leave by 3:50 pm to pick up from Lexigazer"). */
function leaveTitle(r: DayDriveRow, t: Map<string, string>): string {
  return `Leave by ${clock(r.leave_at!)} ${r.pick_up ? 'to pick up from' : 'for'} ${names(r.for_keys, t)}`;
}

/**
 * Leave-by alerts for a plan: one per drive to an event, `lead` minutes before its leave-by time.
 * None when the setting is off; none already past (`now`). Private events read "Busy".
 */
export function leaveAlerts(plan: DayPlan, s: BriefingSettings, now: Date): DayNote[] {
  if (!s.leaveAlerts) return [];
  const t = titles(plan);
  const out: DayNote[] = [];
  plan.rows.forEach((r, n) => {
    if (r.kind !== 'drive' || !timedDrive(r)) return;
    const leave = localTime(r.leave_at!);
    if (!leave) return;
    const at = new Date(leave.getTime() - s.lead * 60_000);
    if (at.getTime() <= now.getTime()) return;
    let body = `${r.minutes} min drive with traffic`;
    if (r.typical_minutes !== undefined && r.typical_minutes < r.minutes!) body += ` (usually ${r.typical_minutes})`;
    if (r.tight) body += '. Tight: you leave before the event before it ends';
    out.push({ id: `wilma.${plan.date}.leave.${n}`, at, title: leaveTitle(r, t), body: `${body}.`, url: `/day?date=${plan.date}` });
  });
  return out;
}

/**
 * The day in one or two sentences: "3 things today. First: leave by 8:10 am for Swim. Rain likely
 * at 4:00 pm at the Aquatic Center." Events (not those shown as Free), tasks placed and all-day
 * events count as things.
 */
export function summaryOf(plan: DayPlan): string {
  const t = titles(plan);
  const things =
    plan.rows.filter((r) => (r.kind === 'event' && !r.free) || r.kind === 'task').length + plan.all_day.length;
  const parts = [things ? `${things} thing${things === 1 ? '' : 's'} today.` : 'Nothing planned today.'];
  const drive = plan.rows.find((r): r is DayDriveRow => r.kind === 'drive' && timedDrive(r));
  if (drive) parts.push(`First: ${leaveTitle(drive, t).replace(/^L/, 'l')} (${drive.minutes} min).`);
  const alert = plan.rows.find((r) => r.kind === 'alert');
  if (alert?.kind === 'alert') parts.push(`⚠ ${alert.event}.`);
  const rain = plan.rows.find((r) => r.kind === 'rain');
  if (rain?.kind === 'rain') parts.push(`Rain likely at ${clock(rain.start)} at ${rain.place}.`);
  return parts.join(' ');
}

/**
 * The morning greetings to keep scheduled: the next MORNINGS_AHEAD days at the briefing time,
 * from today when that time is still ahead. None unless the briefing sends a notification.
 */
export function mornings(s: BriefingSettings, now: Date): DayNote[] {
  if (s.briefing !== 'notify') return [];
  const [h, m] = s.time.split(':').map(Number);
  const out: DayNote[] = [];
  for (let i = 0; out.length < MORNINGS_AHEAD && i <= MORNINGS_AHEAD; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
    if (at.getTime() <= now.getTime()) continue;
    const date = todayAndTomorrow(at).today;
    out.push({ id: `wilma.${date}.morning`, at, title: MORNING_TITLE, body: MORNING_BODY, url: `/day?date=${date}` });
  }
  return out;
}
