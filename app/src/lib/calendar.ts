// The phone's calendar (day planner step 1, docs/phase6-day-planner-step1-plan.md): read on the
// phone, only the calendars the user ticked, only the days Wilma asks about, and only when the user
// asks about their day. Each event is trimmed here to what an answer needs (title, times, place,
// calendar name); descriptions, attendees, links and reminders are never read into what is sent.
// Private events become "Busy" with their times (Q3). Nothing here is stored except which
// calendars are ticked (calendarSettings.ts).
//
// The package is loaded on first use (a require inside a function), as location.ts does, so the
// rest of the app never touches it. The logic takes its phone calls as `deps`, so it is tested
// without a phone.
//
// One write (alarms and calendar entries step 3, design D31): `addEvent` creates one event, only
// from a tap on Add to calendar on the chat's 📅 card, in a calendar the user ticked and the phone
// lets apps write to. It is the only write here, and it only creates: nothing in this file changes
// or deletes an event, including the ones Wilma added (owner, Q6).
import { Platform } from 'react-native';

import { eventProblem, type EventCardData } from './phoneActions';

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
  /** The phone lets apps add events to it (not a holidays or other read-only calendar). */
  writable?: boolean;
  /** The account's main calendar (Android says). */
  primary?: boolean;
}

/** A new event as the phone's calendar takes it. */
export interface NewPhoneEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  location?: string;
  notes?: string;
  /** "UTC" for an all-day event on Android, which stores those at midnight UTC. */
  timeZone?: string;
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
  /** "free": the event is shown as Free (it keeps no time in My day). */
  availability?: string | null;
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
  /** Creates one event and gives its id. Only `addEvent` calls it. */
  createEvent: (calendarId: string, event: NewPhoneEvent) => Promise<string>;
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
  /** The user drops off and picks up here (My day's 🚸 choice, by title). */
  drop_off?: true;
  /** Shown as Free in the calendar. */
  free?: true;
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
  if (!allDay && e.availability === 'free') out.free = true;
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
  /** "New events go to" (Q5): a calendar id; when unset or no longer usable, `defaultTarget`. */
  addTo?: string;
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

// ---- Adding an event (the only write) ----------------------------------------------------------

/** The calendars an event may be added to: ticked in Settings → Calendars and writable. */
export function writableCalendars(calendars: PhoneCalendar[], choice: CalendarChoice): PhoneCalendar[] {
  if (!choice.on) return [];
  return calendars.filter((c) => c.writable === true && choice.ticked.includes(c.id));
}

/**
 * Where new events go (Q5): the user's "New events go to" while it is still ticked and writable;
 * else the phone's primary calendar among those; else the first of them; null when there is none.
 */
export function defaultTarget(calendars: PhoneCalendar[], choice: CalendarChoice): PhoneCalendar | null {
  const usable = writableCalendars(calendars, choice);
  return usable.find((c) => c.id === choice.addTo) ?? usable.find((c) => c.primary) ?? usable[0] ?? null;
}

/**
 * The event as the phone takes it. Timed: the phone's local times. All day: from the first day's
 * midnight to the midnight after the last day; on Android at midnight UTC with the UTC zone, as
 * Android's calendar stores all-day events (readAgenda reads them back the same way).
 */
export function toPhoneEvent(e: EventCardData, allDayInUtc: boolean): NewPhoneEvent | null {
  const place = e.location?.trim();
  const notes = e.notes?.trim();
  const base = { title: e.title.trim(), allDay: e.allDay, ...(place ? { location: place } : {}), ...(notes ? { notes } : {}) };
  if (!e.allDay) {
    const start = localTime(e.start);
    const end = localTime(e.end);
    return start && end ? { ...base, startDate: start, endDate: end } : null;
  }
  const first = startOfDay(e.start);
  const last = startOfDay(e.end);
  if (!first || !last) return null;
  if (allDayInUtc) {
    return {
      ...base,
      startDate: new Date(Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())),
      endDate: new Date(Date.UTC(last.getFullYear(), last.getMonth(), last.getDate() + 1)),
      timeZone: 'UTC',
    };
  }
  return { ...base, startDate: first, endDate: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) };
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
function localTime(text: string): Date | null {
  const m = LOCAL_TIME.exec(text);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return timeText(d) === text ? d : null;
}

export const TURN_ON_TO_ADD = 'To add events, turn on Use my calendar in Settings → Calendars.';
export const NOT_WRITABLE = 'Wilma can’t add events to that calendar. Pick another one.';
export const ADD_FAILED = 'The event could not be added just now. Try again.';

export type AddResult = { added: { eventId: string; calendar: string } } | { problem: string };

/**
 * Adds one event: called only from the tap on Add to calendar. Everything is checked again here,
 * right before writing: the fields (eventProblem), the calendar setting on, the permission (asked
 * now if it can be), and the calendar still on the phone, ticked and writable. Create only: there
 * is no update or delete, and none may be added (owner, Q6).
 */
export async function addEvent(
  deps: CalendarDeps,
  choice: CalendarChoice,
  calendarId: string,
  event: EventCardData,
  now: Date,
): Promise<AddResult> {
  const problem = eventProblem(event, now);
  if (problem) return { problem };
  if (!choice.on) return { problem: TURN_ON_TO_ADD };
  try {
    let p = await deps.permission();
    if (!p.granted && p.canAskAgain) p = await deps.askPermission();
    if (!p.granted) return { problem: NO_PERMISSION };
    const target = writableCalendars(await deps.calendars(), choice).find((c) => c.id === calendarId);
    if (!target) return { problem: NOT_WRITABLE };
    const details = toPhoneEvent(event, deps.allDayInUtc);
    if (!details) return { problem: ADD_FAILED };
    const eventId = await deps.createEvent(target.id, details);
    return { added: { eventId: String(eventId), calendar: clip(target.title, MAX_CALENDAR_NAME) || 'Calendar' } };
  } catch {
    return { problem: ADD_FAILED };
  }
}

type CalendarPackage = typeof import('expo-calendar');

/** The phone's calendar calls (expo-calendar, loaded on first use). Reads, and createEvent for addEvent. */
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
      writable: c.allowsModifications === true,
      primary: c.isPrimary === true,
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
      availability: e.availability,
    }));
  },
  allDayInUtc: Platform.OS === 'android',
  // Create only (Q6). No guests and no reminders of our own: the calendar's default reminder applies (Q9).
  createEvent: async (calendarId, e) => {
    const calendar = await pkg().ExpoCalendar.get(calendarId);
    const created = await calendar.createEvent({
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      allDay: e.allDay,
      ...(e.location ? { location: e.location } : {}),
      ...(e.notes ? { notes: e.notes } : {}),
      ...(e.timeZone ? { timeZone: e.timeZone } : {}),
    });
    return String(created.id);
  },
};

/** "Open in Calendar" after adding: the phone's calendar app shows the event (nothing is changed). */
export async function openEvent(eventId: string): Promise<boolean> {
  try {
    const event = await pkg().ExpoCalendarEvent.get(eventId);
    await event.openInCalendar();
    return true;
  } catch {
    return false;
  }
}

function pkg(): CalendarPackage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cal: CalendarPackage = require('expo-calendar');
  return cal;
}
