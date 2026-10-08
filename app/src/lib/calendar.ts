// The phone's calendar (day planner step 1, docs/phase6-day-planner-step1-plan.md): read on the
// phone, only the calendars the user ticked, only the days Wilma asks about, and only when the user
// asks about their day. Each event is trimmed here to what an answer needs (title, times, place,
// calendar name); descriptions, attendees, links and reminders are never read into what is sent.
// Private events become "Busy" with their times (Q3). Nothing here is stored except which
// calendars are ticked (calendarSettings.ts).
//
// The package is loaded on first use (a require inside a function), as location.ts does, so the
// rest of the app never touches it. The logic takes its phone calls as `deps`, so it is tested
// without a phone. Wilma only reads: no function here creates, changes or deletes anything.
import { Platform } from 'react-native';

/** At most this many days per question (Q5; the server refuses more). */
export const MAX_AGENDA_DAYS = 14;
/** At most this many events per answer (the server refuses more). */
export const MAX_AGENDA_EVENTS = 300;
const MAX_TEXT = 300;
const MAX_CALENDAR_NAME = 100;

export interface PhoneCalendar {
  id: string;
  title: string;
  /** The account it belongs to (e.g. a Gmail address), when the phone says. */
  account: string | null;
  /** The calendar's time zone, when the phone says (e.g. "America/New_York"). */
  timeZone?: string | null;
}

/** An event as the phone gives it (only the fields read here). */
export interface PhoneEvent {
  calendarId: string;
  title?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  allDay?: boolean;
  location?: string | null;
  /** "private" or "confidential": shown as Busy only. */
  accessLevel?: string | null;
  /** "canceled" events are left out. */
  status?: string | null;
}

export interface Permission {
  granted: boolean;
  canAskAgain: boolean;
}

export interface CalendarDeps {
  permission: () => Promise<Permission>;
  askPermission: () => Promise<Permission>;
  calendars: () => Promise<PhoneCalendar[]>;
  events: (calendarIds: string[], start: Date, end: Date) => Promise<PhoneEvent[]>;
  /** All-day events are stored at midnight UTC (Android), not local midnight (iPhone). */
  allDayInUtc: boolean;
}

/** One event as the app sends it to Wilma (the server checks it again). */
export interface AgendaEvent {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location?: string;
  calendar: string;
  busy_only?: true;
  /** Where the phone found the event's place (day planner; never shown to the model). */
  point?: { lat: number; lng: number; by_name_only?: true };
  /** The user said this event is not a trip (or it is a video call). */
  not_a_trip?: true;
}

export interface Agenda {
  from: string;
  to: string;
  time_zone: string;
  calendars: number;
  events: AgendaEvent[];
  /** One day only: the choices kept on the phone (Take both, Not driving), events named "e0", "e1", ... */
  choices?: { together?: string[][]; not_driving?: string[] };
}

export const NO_PERMISSION =
  'Wilma may not read your calendar. To allow it: phone Settings → Apps → Wilma → Permissions → Calendar → Allow.';
export const READ_FAILED = 'Your calendar could not be read just now. Try again.';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const two = (n: number) => String(n).padStart(2, '0');

/** "2026-10-08" in the phone's own time, or in UTC. */
export function dayText(d: Date, utc = false): string {
  return utc
    ? `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`
    : `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** "2026-10-08T09:30" in the phone's own time. */
export function timeText(d: Date): string {
  return `${dayText(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Local midnight at the start of a "YYYY-MM-DD" day, or null when it is not a real day. */
export function startOfDay(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayText(d) === day ? d : null;
}

const validZone = (tz: unknown): tz is string => typeof tz === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(tz) && tz.length <= 64;

/** The phone's time zone (e.g. "America/New_York"), or null when the phone does not say. */
export function phoneTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

const asDate = (v: string | Date): Date | null => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The event as sent: what an answer needs, nothing else. Null for a canceled or unreadable one. */
export function trimEvent(e: PhoneEvent, calendarName: string, allDayInUtc: boolean): AgendaEvent | null {
  if (e.status === 'canceled') return null;
  const start = asDate(e.startDate);
  const end = asDate(e.endDate);
  if (!start || !end) return null;
  const allDay = e.allDay === true;
  const busyOnly = e.accessLevel === 'private' || e.accessLevel === 'confidential';
  // An all-day event ends at midnight after its last day: that last day is the one sent.
  const lastDay = allDay ? new Date(Math.max(start.getTime(), end.getTime() - 1)) : end;
  const out: AgendaEvent = {
    title: busyOnly ? 'Busy' : clip(e.title, MAX_TEXT) || '(no title)',
    start: allDay ? dayText(start, allDayInUtc) : timeText(start),
    end: allDay ? dayText(lastDay, allDayInUtc) : timeText(end),
    all_day: allDay,
    calendar: clip(calendarName, MAX_CALENDAR_NAME) || 'Calendar',
  };
  const place = busyOnly ? '' : clip(e.location, MAX_TEXT);
  if (place) out.location = place;
  if (busyOnly) out.busy_only = true;
  return out;
}

export type AgendaResult =
  | { agenda: Agenda }
  /** off: "Use my calendar" is off, or no calendar is ticked; permission: not allowed. */
  | { problem: 'off' | 'permission' | 'failed' | 'bad_days' };

/** What the user chose in Settings → Calendars (calendarSettings.ts). */
export interface CalendarChoice {
  on: boolean;
  ticked: string[];
}

/**
 * The ticked calendars' events from `from` to `to` (local days, both included), trimmed, for
 * Wilma's agenda request. Never asks for the permission: that is Settings → Calendars' job.
 */
export async function readAgenda(
  deps: CalendarDeps,
  choice: CalendarChoice,
  from: string,
  to: string,
  timeZone: string | null,
): Promise<AgendaResult> {
  const first = startOfDay(from);
  const last = startOfDay(to);
  if (!first || !last || last < first) return { problem: 'bad_days' };
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  const days = Math.round((end.getTime() - first.getTime()) / 86_400_000);
  if (days > MAX_AGENDA_DAYS) return { problem: 'bad_days' };
  if (!choice.on || !choice.ticked.length) return { problem: 'off' };
  try {
    if (!(await deps.permission()).granted) return { problem: 'permission' };
    // Only calendars still on the phone and still ticked.
    const calendars = await deps.calendars();
    const names = new Map(calendars.map((c) => [c.id, c.title]));
    const ids = choice.ticked.filter((id) => names.has(id));
    if (!ids.length) return { problem: 'off' };
    // The phone's zone; else the zone of a ticked calendar (the phone's engine may not say).
    const zone = timeZone ?? calendars.find((c) => ids.includes(c.id) && validZone(c.timeZone))?.timeZone ?? null;
    if (!zone) return { problem: 'failed' };
    const events = (await deps.events(ids, first, end))
      .filter((e) => ids.includes(e.calendarId))
      .map((e) => trimEvent(e, names.get(e.calendarId) ?? '', deps.allDayInUtc))
      .filter((e): e is AgendaEvent => e !== null)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
      .slice(0, MAX_AGENDA_EVENTS);
    return { agenda: { from, to, time_zone: zone, calendars: ids.length, events } };
  } catch {
    return { problem: 'failed' };
  }
}

/**
 * "Use my calendar" turned on: asks for the permission (only now, never at install), then lists the
 * phone's calendars, all ticked to start with (Q2: the user unticks what Wilma must not read).
 */
export async function turnOn(deps: CalendarDeps): Promise<{ calendars: PhoneCalendar[]; choice: CalendarChoice } | { error: string }> {
  try {
    let p = await deps.permission();
    if (!p.granted && p.canAskAgain) p = await deps.askPermission();
    if (!p.granted) return { error: NO_PERMISSION };
    const calendars = await deps.calendars();
    return { calendars, choice: { on: true, ticked: calendars.map((c) => c.id) } };
  } catch {
    return { error: READ_FAILED };
  }
}

/** The phone's calendars for Settings → Calendars, or why they cannot be listed. */
export async function listCalendars(deps: CalendarDeps): Promise<{ calendars: PhoneCalendar[] } | { error: string }> {
  try {
    if (!(await deps.permission()).granted) return { error: NO_PERMISSION };
    return { calendars: await deps.calendars() };
  } catch {
    return { error: READ_FAILED };
  }
}

type CalendarPackage = typeof import('expo-calendar');

/** The phone's calendar calls (expo-calendar, loaded on first use). Read-only. */
export const deviceCalendar: CalendarDeps = {
  permission: () => pkg().getCalendarPermissions(),
  askPermission: () => pkg().requestCalendarPermissions(),
  calendars: async () => {
    const cal = pkg();
    const list = await cal.getCalendars(cal.EntityTypes.EVENT);
    return list.map((c) => ({
      id: String(c.id),
      title: String(c.title ?? c.name ?? 'Calendar'),
      account: typeof c.source?.name === 'string' && c.source.name ? c.source.name : null,
      timeZone: typeof c.timeZone === 'string' ? c.timeZone : null,
    }));
  },
  events: async (ids, start, end) => {
    const list = await pkg().listEvents(ids, start, end);
    return list.map((e) => ({
      calendarId: String(e.calendarId),
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      allDay: e.allDay,
      location: e.location,
      accessLevel: e.accessLevel,
      status: e.status,
    }));
  },
  allDayInUtc: Platform.OS === 'android',
};

function pkg(): CalendarPackage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cal: CalendarPackage = require('expo-calendar');
  return cal;
}
