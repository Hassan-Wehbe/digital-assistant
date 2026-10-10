// What My day shows for a plan (the mockups' screens 2, 3 and 5, docs/day-planner-mockups.html):
// the words for each row, the chips at the top, and the sum behind an event's leave-by time. Every
// number comes from the planner (dayPlan.ts); this only puts it into words. Pure functions.
import type { DayDriveRow, DayEventRow, DayPlan, DayRow, NotPlacedTask, TaskOption } from './dayPlan';
import { addDays, timeText } from './tasks';

const two = (n: number) => String(n).padStart(2, '0');

/** "2026-10-09T16:05" → "4:05 pm"; a plain day → "". */
export function clock(local: string): string {
  const m = /T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/** "4:30–6:30 pm", or "11:30 am–1:30 pm" across noon. */
export function range(start: string, end: string): string {
  const a = clock(start);
  const b = clock(end);
  if (!a || !b) return a || b;
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

/** 25 → "25 min", 145 → "2 h 25 min", 120 → "2 h". */
export function minutesText(n: number): string {
  const m = Math.max(0, Math.round(n));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/** "Thursday, Oct 9" for "2026-10-09". */
export function dayTitle(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The phone's day and the next one ("2026-10-09"), from a local Date. */
export function todayAndTomorrow(now: Date): { today: string; tomorrow: string } {
  const day = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return { today: day(now), tomorrow: day(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) };
}

/** Event titles by key (private events read "Busy"). */
export function titles(plan: DayPlan): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of plan.rows) if (r.kind === 'event') out.set(r.key, r.private ? 'Busy' : r.title);
  for (const e of plan.all_day) out.set(e.key, e.title);
  return out;
}

const names = (keys: string[], t: Map<string, string>) => {
  const list = [...new Set(keys.map((k) => t.get(k) ?? 'an event'))];
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
};

/** The time shown left of a row (the leave-by time for a drive). */
export function rowTime(r: DayRow): string {
  if (r.kind === 'drive') return clock(r.leave_at ?? r.arrive_by ?? '');
  if (r.kind === 'free') return '';
  return clock(r.start);
}

/** A drive row's two lines. */
export function driveText(r: DayDriveRow, t: Map<string, string>): { title: string; detail?: string; warn?: string } {
  const home = !r.for_keys.length;
  const title = home ? `🚗 Home from ${r.from}` : `🚗 Leave ${r.pick_up ? 'to pick up from' : 'for'} ${names(r.for_keys, t)}`;
  if (r.unavailable === 'no_home') return { title, detail: 'Set your Home place to time this drive.' };
  if (r.unavailable === 'no_drive_times' || r.minutes === undefined) return { title, detail: 'Drive time unavailable right now.' };
  let detail = `${r.minutes} min${home ? '' : ' with traffic'}`;
  if (r.typical_minutes !== undefined) detail += ` (usually ${r.typical_minutes})`;
  if (r.buffer_min) detail += ` + ${r.buffer_min} to park`;
  if (home && r.arrive_by) detail += `, home by ${clock(r.arrive_by)}`;
  return {
    title,
    detail,
    ...(r.tight ? { warn: 'Tight: this means leaving before the event before it ends.' } : {}),
  };
}

/** An overlap row's words, and whether Take both is offered. */
export function overlapText(r: Extract<DayRow, { kind: 'overlap' }>, t: Map<string, string>): { title: string; detail: string; takeBoth: boolean } {
  return {
    title: `⚠ Overlap ${range(r.start, r.end)}`,
    detail: r.same_place
      ? `${names(r.keys, t)} are at the same place. One trip can do both.`
      : `${names(r.keys, t)} are in two places at once.`,
    takeBoth: r.suggestion === 'take_both',
  };
}

export function rainText(r: Extract<DayRow, { kind: 'rain' }>): string {
  return `🌧 ${r.chance_pct}% chance of rain at ${clock(r.start)} at ${r.place}.`;
}

export function alertText(r: Extract<DayRow, { kind: 'alert' }>): string {
  const where = r.places.length ? ` at ${r.places.join(', ')}` : '';
  return `⚠ ${r.event}${where}${r.end ? `, until ${clock(r.end) || r.end}` : ''}.`;
}

export function freeText(r: Extract<DayRow, { kind: 'free' }>): string {
  return `Free ${range(r.start, r.end)} · ${minutesText(r.minutes)}`;
}

/** What an event row says under its title. */
export function eventLine(r: DayEventRow, t: Map<string, string>): string {
  const parts = [range(r.start, r.end)];
  if (r.private) return parts[0];
  if (r.place && !r.by_name_only) parts.push(`📍 ${r.place}`);
  if (r.not_a_trip) parts.push('not a trip');
  if (r.drop_off) parts.push('🚸 drop off & pick up');
  if (r.free) parts.push('shown as free');
  if (r.together_with?.length) parts.push(`one trip with ${names(r.together_with, t)}`);
  return parts.join(' · ');
}

export interface DayChip {
  text: string;
  tone: 'plain' | 'rain' | 'warn' | 'good';
}

/** The chips under the day's title: drives, rain, alerts, what to sort. */
export function dayChips(plan: DayPlan): DayChip[] {
  const drives = plan.rows.filter((r) => r.kind === 'drive' && r.for_keys.length).length;
  const rain = plan.rows.filter((r): r is Extract<DayRow, { kind: 'rain' }> => r.kind === 'rain');
  const alerts = plan.rows.filter((r) => r.kind === 'alert').length;
  const toSort = plan.rows.filter((r) => r.kind === 'overlap' || (r.kind === 'drive' && r.tight)).length;
  const out: DayChip[] = [];
  if (drives) out.push({ text: `🚗 ${drives} ${drives === 1 ? 'drive' : 'drives'}`, tone: 'plain' });
  if (rain.length) {
    const wettest = rain.reduce((a, b) => (b.chance_pct > a.chance_pct ? b : a));
    out.push({ text: `🌧 Rain ${clock(wettest.start)}, ${wettest.chance_pct}%`, tone: 'rain' });
  }
  if (alerts) out.push({ text: `⚠ ${alerts} weather ${alerts === 1 ? 'alert' : 'alerts'}`, tone: 'warn' });
  out.push(toSort ? { text: `⚠ ${toSort} to sort`, tone: 'warn' } : { text: '✓ Nothing to sort', tone: 'good' });
  return out;
}

/** Notes shown once under the timeline (drive times or weather missing, outside the US). */
export function dayNotes(plan: DayPlan): string[] {
  const out: string[] = [];
  if (plan.drive_times === 'unavailable') out.push('Drive times are unavailable right now.');
  if (plan.weather === 'outside_us') out.push('Weather is only available in the US.');
  else if (plan.weather === 'unavailable' && plan.rows.some((r) => r.kind === 'drive' && r.minutes !== undefined)) {
    out.push('Weather is unavailable right now.');
  }
  return out;
}

export interface EventDetail {
  event: DayEventRow;
  /** The sum behind the leave-by time, when there is a timed drive to it. */
  drive?: { from: string; minutes: number; typical?: number; buffer: number; leaveAt: string };
  /** Why there is no drive time. */
  noDrive?: string;
  /** 🚸 The leave-by time to go back for the pick-up. */
  pickUpLeaveAt?: string;
  /** Hourly chance of rain at its place ("3 pm", 30). */
  rain: { hour: string; pct: number; high: boolean }[];
  notDriving: boolean;
}

/** The detail for one event (screen 3): the sum, the hourly rain. `notDriving`: the user's choice. */
export function eventDetail(plan: DayPlan, key: string, notDriving: boolean): EventDetail | null {
  const event = plan.rows.find((r): r is DayEventRow => r.kind === 'event' && r.key === key);
  if (!event) return null;
  const d = plan.rows.find((r): r is DayDriveRow => r.kind === 'drive' && r.for_keys.includes(key) && !r.pick_up);
  const pickUp = plan.rows.find((r): r is DayDriveRow => r.kind === 'drive' && r.for_keys.includes(key) && !!r.pick_up);
  const w = plan.weather_at.find((x) => x.for_keys.includes(key));
  const rain = (w?.hourly ?? []).map((h) => {
    const c = clock(h.at);
    return { hour: c.replace(':00 ', ' '), pct: h.rain_pct, high: h.rain_pct >= 50 };
  });
  const out: EventDetail = { event, rain, notDriving, ...(pickUp?.leave_at ? { pickUpLeaveAt: pickUp.leave_at } : {}) };
  if (d && d.minutes !== undefined && d.leave_at) {
    out.drive = { from: d.from, minutes: d.minutes, ...(d.typical_minutes !== undefined ? { typical: d.typical_minutes } : {}), buffer: d.buffer_min ?? 0, leaveAt: d.leave_at };
  } else if (d?.unavailable === 'no_home') out.noDrive = 'Set your Home place to time the drive.';
  else if (d) out.noDrive = 'Drive time unavailable right now.';
  else if (event.together_with?.length && !notDriving) out.noDrive = 'One trip with the event it is grouped with.';
  return out;
}

/** Google Maps directions to a point or a place's words (opens the maps app). */
export function directionsLink(to: { lat: number; lng: number } | string): string {
  const dest = typeof to === 'string' ? encodeURIComponent(to.trim().slice(0, 300)) : `${to.lat},${to.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

/** A suggested time for a task (＋ Add → Find a time; mockups screen 2's sheet). */
export function optionText(o: TaskOption, t: Map<string, string>): { title: string; detail: string } {
  if (o.kind === 'on_the_way') {
    const trip = o.for_keys?.length ? names(o.for_keys, t) : 'a drive';
    const leave = o.leave_at && o.was_leave_at ? `Leave at ${clock(o.leave_at)} instead of ${clock(o.was_leave_at)}. ` : '';
    return { title: `On the way to ${trip}, ${clock(o.start)}`, detail: `${leave}${o.extra_drive_min ? `${o.extra_drive_min} min more driving.` : 'No extra driving.'}` };
  }
  return {
    title: `In free time, ${range(o.start, o.end)}`,
    detail: o.extra_drive_min ? `${o.extra_drive_min} min of driving there and back.` : 'No driving.',
  };
}

// ---- Left open (D35, docs/task-day-end-plan.md) ------------------------------------------------

/** The plan's tasks without a time: those left open on an earlier day (asked about first), and the rest. */
export function splitNotPlaced(plan: DayPlan): { leftOpen: NotPlacedTask[]; notPlaced: NotPlacedTask[] } {
  return {
    leftOpen: plan.tasks_not_placed.filter((t) => t.left_from),
    notPlaced: plan.tasks_not_placed.filter((t) => !t.left_from),
  };
}

const monthDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Left open yesterday" when every one is from the day before `date`, else "Left open". */
export function leftOpenHeading(tasks: NotPlacedTask[], date: string): string {
  return tasks.length && tasks.every((t) => t.left_from === addDays(date, -1)) ? 'Left open yesterday' : 'Left open';
}

/** "planned yesterday at 3:00 pm" / "planned Oct 8 at 3:00 pm". */
export function leftOpenWhen(t: NotPlacedTask, date: string): string {
  if (!t.left_from) return '';
  const day = t.left_from === addDays(date, -1) ? 'yesterday' : monthDay(t.left_from);
  return `planned ${day}${t.planned_time ? ` at ${timeText(t.planned_time)}` : ''}`;
}
