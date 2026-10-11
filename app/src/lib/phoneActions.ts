// Alarms and reminders from the chat (docs/alarms-calendar-plan.md step 2, design D31): what the
// cards say, the reminder as a notification, and which reminders "cancel my reminder to call Sam"
// means. Nothing happens until the user taps a card (owner: a card to confirm, on everything).
// Reminders live only on this phone, in its notification schedule (notifications.ts, kind
// "reminder"); the server and the model never see them. Pure logic, tested without a phone.
import type { DayNote } from './dayAlerts';
import { findCredential } from './credentials';

/** What this app can show (sent as "can"; supabase/functions/chat/phone_actions.ts). */
export const CAN_ALARM = 'alarm';
export const CAN_REMINDER = 'reminder';

export const REMINDER_KIND = 'reminder';
const REMINDER_PREFIX = 'wilma.';
const MAX_TEXT = 200;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_NAMES: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const two = (n: number) => String(n).padStart(2, '0');
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** "17:05" → "5:05 pm". */
export function clockText(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${two(m)} ${h < 12 ? 'am' : 'pm'}`;
}

/** "YYYY-MM-DD" of a Date on this phone's clock. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** "2026-10-11T17:00" (the phone's own time) as a Date; null when it is not one. */
export function fromLocal(local: string): Date | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(d.getTime()) && localDay(d) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
}

/** "today", "tomorrow", or "Sat Oct 12". */
function dayWords(d: Date, now: Date): string {
  const day = localDay(d);
  if (day === localDay(now)) return 'today';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === localDay(tomorrow)) return 'tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---- Alarms ------------------------------------------------------------------------------------

export interface AlarmCardData {
  time: string;
  days?: string[];
  label?: string;
}

/** "Mon–Fri", "Sat, Sun", "every day". */
export function daysText(days: string[]): string {
  const set = WEEKDAYS.filter((d) => days.includes(d));
  if (set.length === 7) return 'every day';
  if (set.join() === 'mon,tue,wed,thu,fri') return 'Mon–Fri';
  if (set.join() === 'sat,sun') return 'Sat, Sun';
  return set.map((d) => DAY_NAMES[d]).join(', ');
}

/**
 * "Alarm 6:30 am · tomorrow" (the Clock's rule: the next time it comes), or with days the days.
 * With days, the Clock opens with the time and the user ticks the days there: Android's set-alarm
 * screen takes the days as a list of whole numbers, which this app cannot pass reliably.
 */
export function alarmCardText(a: AlarmCardData, now: Date): { title: string; detail?: string } {
  const [h, m] = a.time.split(':').map(Number);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  const when = a.days?.length ? daysText(a.days) : dayWords(next, now);
  return {
    title: `Alarm ${clockText(a.time)} · ${when}${a.label ? ` · ${a.label}` : ''}`,
    ...(a.days?.length ? { detail: `Your Clock app opens with the time; tick ${daysText(a.days)} there.` } : {}),
  };
}

/** The Clock's set-alarm screen, filled in (android.intent.action.SET_ALARM; SKIP_UI false: the user sees it). */
export function alarmIntent(a: AlarmCardData): { action: string; extra: Record<string, string | number | boolean> } {
  const [h, m] = a.time.split(':').map(Number);
  return {
    action: 'android.intent.action.SET_ALARM',
    extra: {
      'android.intent.extra.alarm.HOUR': h,
      'android.intent.extra.alarm.MINUTES': m,
      'android.intent.extra.alarm.SKIP_UI': false,
      ...(a.label ? { 'android.intent.extra.alarm.MESSAGE': a.label } : {}),
    },
  };
}

/** The Clock's list of alarms (android.intent.action.SHOW_ALARMS), where they are changed or cancelled. */
export const SHOW_ALARMS = 'android.intent.action.SHOW_ALARMS';

// ---- Reminders ---------------------------------------------------------------------------------

export interface ReminderCardData {
  /** The phone's local time, "2026-10-11T17:00". */
  at: string;
  text: string;
}

/** "5:00 pm today: Call Sam" (the card shows its own 🔔). */
export function reminderCardText(r: ReminderCardData, now: Date): string {
  const at = fromLocal(r.at);
  if (!at) return r.text;
  return `${clockText(r.at.slice(11))} ${dayWords(at, now)}: ${r.text}`;
}

/**
 * Why a reminder cannot be set, or null: the time has passed, it is not a time, or the text looks
 * like a password (checked again here; the server refused it already, rule 9: it would show on the
 * lock screen).
 */
export function reminderProblem(r: ReminderCardData, now: Date): string | null {
  const at = fromLocal(r.at);
  if (!at) return 'That time could not be read. Ask Wilma again.';
  if (at.getTime() <= now.getTime()) return 'That time has passed. Ask Wilma for a new reminder.';
  if (!r.text.trim() || r.text.length > MAX_TEXT) return 'Ask Wilma again with a shorter reminder.';
  if (findCredential(r.text)) return 'That looks like a password or code, so it can’t go on the lock screen. Passwords belong in the Vault.';
  return null;
}

/**
 * The reminder as a notification. Its id is fixed by the chat card it came from, so tapping Set
 * again replaces it instead of making a second one.
 */
export function reminderNote(r: ReminderCardData, cardKey: string): DayNote | null {
  const at = fromLocal(r.at);
  if (!at) return null;
  const key = cardKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'r';
  return { id: `${REMINDER_PREFIX}${r.at.slice(0, 10)}.${REMINDER_KIND}.${key}`, at, title: '🔔 Reminder', body: r.text, url: '/', channel: 'reminders' };
}

export const isReminderId = (id: string) => id.startsWith(REMINDER_PREFIX) && id.split('.')[2] === REMINDER_KIND;

export interface ReminderRow {
  id: string;
  /** When it shows, in ms. */
  at: number;
  text: string;
}

const STOP = new Set(['my', 'the', 'a', 'an', 'to', 'for', 'about', 'reminder', 'reminders', 'remind', 'me', 'of', 'that', 'on', 'at', 'cancel']);
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));

/**
 * The reminders a "find" card shows: still ahead, soonest first; with `about`, those whose text
 * holds every word of it ("call Sam" finds "Call Sam back", not "Call the bank").
 */
export function matchReminders(rows: ReminderRow[], about: string | undefined, now: Date): ReminderRow[] {
  const want = about ? words(about) : [];
  return rows
    .filter((r) => r.at > now.getTime())
    .filter((r) => {
      const have = new Set(words(r.text));
      return want.every((w) => have.has(w));
    })
    .sort((a, b) => a.at - b.at);
}

/** "5:00 pm today", "9:00 am Sat Oct 12": a reminder row's time. */
export function reminderWhen(at: number, now: Date): string {
  const d = new Date(at);
  return `${clockText(`${two(d.getHours())}:${two(d.getMinutes())}`)} ${dayWords(d, now)}`;
}

// ---- Reading the cards (the chat stream and the saved thread) ----------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shortText = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;

/** An alarm card's fields, checked field by field (anything else is dropped); null when malformed. */
export function toAlarmData(raw: unknown): AlarmCardData | null {
  if (!isObject(raw) || typeof raw.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) return null;
  const days = Array.isArray(raw.days) ? WEEKDAYS.filter((d) => (raw.days as unknown[]).includes(d)) : [];
  const label = shortText(raw.label, MAX_TEXT);
  return { time: raw.time, ...(days.length ? { days } : {}), ...(label ? { label } : {}) };
}

/** A reminder card's fields; null when malformed. */
export function toReminderData(raw: unknown): ReminderCardData | null {
  if (!isObject(raw) || typeof raw.at !== 'string' || !LOCAL.test(raw.at)) return null;
  const text = shortText(raw.text, MAX_TEXT);
  return text ? { at: raw.at, text } : null;
}

/** A "find reminders" card's words (none: all of them). */
export function toAbout(raw: unknown): string | undefined {
  return shortText(raw, 100);
}
