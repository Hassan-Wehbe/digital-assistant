// Alarms, reminders and calendar entries (docs/alarms-calendar-plan.md, design D31): chat-only
// actions that happen on the phone. The server never sets, keeps or cancels anything: it checks
// what the model asked for and sends the app a card; **nothing happens until the user taps it**
// (owner, 2026-10-10: a card to confirm, on everything). Never offered to the Claude connector.
//
//   set_alarm({time, days?, label?})            {"type":"alarm","time","days"?,"label"?}       Set in Clock
//   show_alarms()                               {"type":"show_alarms"}                         Open Clock
//   set_reminder({at, text})                    {"type":"reminder","at","text"}                Set reminder
//   find_reminders({about?})                    {"type":"find_reminders","about"?}             Cancel / list
//   add_calendar_event({title, start, ...})     {"type":"calendar_add","title","start","end","all_day","location"}
//
// Times are the user's local wall-clock times in the phone's time zone. Text that looks like a
// password, PIN or code is refused here (and again on the phone): a reminder shows on the lock
// screen and a calendar may be shared (rule 9). Reminders live only on the phone, so the model never
// sees them: find_reminders lets the app match and show them itself. An app that cannot show a card
// (it does not list the capability in "can") gets a sentence to update Wilma instead.
import type { ToolSpec } from "../_shared/llm/index.ts";
import { localTime } from "../_shared/dayplan/time.ts";
import { findCredential } from "../mcp/lib/credentials.ts";

/** What the app lists in "can" for these cards. */
export const CAN_ALARM = "alarm";
export const CAN_REMINDER = "reminder";
export const CAN_CALENDAR_ADD = "calendar_add";

export const MAX_TEXT = 200;
export const MAX_LOCATION = 300;
/** Reminders and events at most this far ahead. */
export const MAX_DAYS_AHEAD = 366;
/** An event at most this long (a timed one), or this many days (an all-day one). */
export const MAX_EVENT_DAYS = 14;
export const DEFAULT_EVENT_MIN = 60;
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

export const PHONE_ACTION_SPECS: ToolSpec[] = [
  {
    name: "set_alarm",
    description:
      "Chat app only. Shows the user a card to set an alarm in their phone's Clock app (\"wake me at 6:30\", " +
      "\"alarm for 5:45 on weekdays\"). Nothing is set until they tap Set in Clock. Only when the user asks " +
      "for an alarm or to be woken, never on your own. An alarm takes a time of day (the next time it comes) " +
      "or weekdays; for a specific later date use set_reminder and say why. Wilma cannot see, change or " +
      "cancel alarms: for that use show_alarms.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "string", description: "24-hour local time, HH:MM" },
        days: { type: "array", items: { type: "string", enum: [...WEEKDAYS] }, description: "Repeat on these days (optional)" },
        label: { type: "string", description: "A short label, only if the user gave one (optional)" },
      },
      required: ["time"],
      additionalProperties: false,
    },
  },
  {
    name: "show_alarms",
    description:
      "Chat app only. Shows an Open Clock card, for \"cancel my 6:30 alarm\" or \"what alarms do I have\": " +
      "alarms live in the phone's Clock app, where the user changes or cancels them. Changes nothing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_reminder",
    description:
      "Chat app only. Shows the user a card to set a reminder: a Wilma notification on this phone at that time " +
      "(\"remind me at 5 to call Sam\"). Nothing is set until they tap Set reminder. Only when the user asks to " +
      "be reminded. For something to do without a set time, save a task instead.",
    inputSchema: {
      type: "object",
      properties: {
        at: { type: "string", description: "Local time, YYYY-MM-DDTHH:MM, in the future" },
        text: { type: "string", description: "What to remind them of, short, in their words (\"Call Sam\")" },
      },
      required: ["at", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "find_reminders",
    description:
      "Chat app only. Shows the user their reminders on this phone, for \"cancel my reminder to call Sam\" or " +
      "\"what reminders do I have\". The app matches and shows them with Cancel buttons; you never see them, " +
      "and nothing is cancelled unless the user taps.",
    inputSchema: {
      type: "object",
      properties: {
        about: { type: "string", description: "Words to match, e.g. \"call Sam\"; leave out to list them all" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_calendar_event",
    description:
      "Chat app only. Shows the user a card to add an event to a calendar on their phone (\"put the dentist " +
      "on my calendar Tuesday at 3\"). Nothing is added until they tap Add to calendar; they can change the " +
      "details and the calendar on the card. Only when the user asks to put something on their calendar. " +
      "Wilma never changes or deletes calendar events.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The event's title" },
        start: { type: "string", description: "Local start, YYYY-MM-DDTHH:MM; or YYYY-MM-DD for an all-day event" },
        end: { type: "string", description: "Local end, same form as start (optional: one hour, or one day)" },
        all_day: { type: "boolean", description: "True when only a day is given (optional)" },
        location: { type: "string", description: "Where, if the user said (optional)" },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
  },
];

export const PHONE_ACTION_NAMES = new Set(PHONE_ACTION_SPECS.map((s) => s.name));

export interface PhoneOutput {
  isError: boolean;
  text: string;
  events: Record<string, unknown>[];
}

export interface PhoneContext {
  /** What the app said it can do ("can"). */
  can: ReadonlySet<string>;
  /** The phone's time zone; UTC when the app sent none. */
  tz?: string;
  /** The clock (tests set it). */
  now?: () => number;
}

const NEEDS: Record<string, string> = {
  set_alarm: CAN_ALARM, show_alarms: CAN_ALARM,
  set_reminder: CAN_REMINDER, find_reminders: CAN_REMINDER,
  add_calendar_event: CAN_CALENDAR_ADD,
};

const WHAT: Record<string, string> = {
  set_alarm: "set alarms", show_alarms: "open your alarms", set_reminder: "set reminders",
  find_reminders: "show your reminders", add_calendar_event: "add calendar events",
};

const fail = (text: string): PhoneOutput => ({ isError: true, text, events: [] });

/** Refused before anything reaches the app (rule 9): never the value, never a hint of it. */
const CREDENTIAL = "Not shown: that text looks like it contains a password, PIN or code. A reminder shows on the " +
  "lock screen and a calendar may be shared, so it can't go there. Do not repeat the value. Passwords belong in " +
  "the Vault: offer save_secret. The card can be made again without the value.";

function waiting(card: string, button: string, extra = ""): string {
  return JSON.stringify({
    status: "waiting_for_user",
    message: `Not done yet. The app is showing the user a ${card} card; it happens only if they tap ${button}. ` +
      `Tell them in one short sentence to check the card and tap ${button}.${extra} Do not call this again for it.`,
  });
}

/** A text field: trimmed, one line, at most `max` characters; refused when it looks like a credential. */
function text(v: unknown, field: string, max: number, required: boolean): { value?: string; error?: string } {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    return required ? { error: `${field} is required.` } : {};
  }
  if (typeof v !== "string") return { error: `${field} must be text.` };
  const value = v.trim().replace(/\s+/g, " ");
  if (value.length > max) return { error: `${field} can be at most ${max} characters.` };
  if (findCredential(value)) return { error: CREDENTIAL };
  return { value };
}

/** A real calendar day (not 2026-02-30). */
function realDay(d: string): boolean {
  if (!DAY.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "2026-10-10T17:00" plus minutes, as a wall-clock time (no zone: the same arithmetic as the phone's). */
function addMinutes(local: string, n: number): string {
  return new Date(Date.parse(`${local}:00Z`) + n * 60_000).toISOString().slice(0, 16);
}

const minutesBetween = (a: string, b: string) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000;

/**
 * The phone actions for one message: each card is sent once, whatever the model repeats.
 */
export class PhoneActions {
  private sent = new Set<string>();

  constructor(private ctx: PhoneContext) {}

  run(name: string, input: Record<string, unknown>): PhoneOutput {
    const need = NEEDS[name];
    if (!need) return fail(`${name} is not a phone action.`);
    if (!this.ctx.can.has(need)) {
      return {
        isError: false,
        text: JSON.stringify({
          status: "app_cannot",
          message: `This version of the app cannot ${WHAT[name]}. Tell the user in one short sentence that updating ` +
            "Wilma from the Play Store adds it" + (name === "set_alarm" || name === "show_alarms" ? ", and that meanwhile " +
              "they can use their Clock app." : "."),
        }),
        events: [],
      };
    }
    switch (name) {
      case "set_alarm":
        return this.alarm(input);
      case "show_alarms":
        return this.card({ type: "show_alarms" }, JSON.stringify({
          status: "shown",
          message: "The app shows an Open Clock card. Alarms are changed or cancelled in the Clock app; you cannot " +
            "see or cancel them. Say so in one short sentence.",
        }));
      case "set_reminder":
        return this.reminder(input);
      case "find_reminders":
        return this.findReminders(input);
      default:
        return this.calendar(input);
    }
  }

  private nowLocal(): string {
    return localTime(this.ctx.now?.() ?? Date.now(), this.ctx.tz ?? "UTC") ?? new Date().toISOString().slice(0, 16);
  }

  /** Sends the card once per message; a repeat gets the same answer and no second card. */
  private card(event: Record<string, unknown>, toModel: string): PhoneOutput {
    const key = JSON.stringify(event);
    const first = !this.sent.has(key);
    this.sent.add(key);
    return { isError: false, text: toModel, events: first ? [event] : [] };
  }

  private alarm(input: Record<string, unknown>): PhoneOutput {
    const time = input.time;
    if (typeof time !== "string" || !HHMM.test(time.trim())) return fail("time must be a 24-hour time, HH:MM.");
    let days: string[] | undefined;
    if (input.days !== undefined) {
      if (!Array.isArray(input.days) || input.days.some((d) => !(WEEKDAYS as readonly unknown[]).includes(d))) {
        return fail(`days must be a list of ${WEEKDAYS.join(", ")}.`);
      }
      // In week order, each once; all seven is every day.
      days = WEEKDAYS.filter((d) => (input.days as string[]).includes(d));
      if (!days.length) days = undefined;
    }
    const label = text(input.label, "label", MAX_TEXT, false);
    if (label.error) return fail(label.error);
    return this.card(
      { type: "alarm", time: time.trim(), ...(days ? { days } : {}), ...(label.value ? { label: label.value } : {}) },
      waiting("Set in Clock", "Set in Clock", " Their Clock app then shows the alarm; it rings even if Wilma is closed."),
    );
  }

  private reminder(input: Record<string, unknown>): PhoneOutput {
    const at = typeof input.at === "string" ? input.at.trim() : "";
    const m = LOCAL.exec(at);
    if (!m || !realDay(m[1])) return fail("at must be a local time, YYYY-MM-DDTHH:MM.");
    const now = this.nowLocal();
    if (at <= now) return fail(`at must be in the future (it is ${now} now, local time).`);
    if (at.slice(0, 10) > addDays(now.slice(0, 10), MAX_DAYS_AHEAD)) return fail(`at most ${MAX_DAYS_AHEAD} days ahead.`);
    const words = text(input.text, "text", MAX_TEXT, true);
    if (words.error) return fail(words.error);
    return this.card({ type: "reminder", at, text: words.value }, waiting("Set reminder", "Set reminder"));
  }

  private findReminders(input: Record<string, unknown>): PhoneOutput {
    const about = text(input.about, "about", 100, false);
    if (about.error) return fail(about.error);
    return this.card(
      { type: "find_reminders", ...(about.value ? { about: about.value } : {}) },
      JSON.stringify({
        status: "shown",
        message: "The app is showing the user their matching reminders, each with a Cancel button. You cannot see " +
          "them: do not list, guess or confirm any reminder. Nothing is cancelled unless they tap. Say so in one " +
          "short sentence.",
      }),
    );
  }

  private calendar(input: Record<string, unknown>): PhoneOutput {
    const title = text(input.title, "title", MAX_TEXT, true);
    if (title.error) return fail(title.error);
    const location = text(input.location, "location", MAX_LOCATION, false);
    if (location.error) return fail(location.error);
    const start = typeof input.start === "string" ? input.start.trim() : "";
    const endIn = typeof input.end === "string" && input.end.trim() ? input.end.trim() : undefined;
    const today = this.nowLocal().slice(0, 10);
    const allDay = input.all_day === true || DAY.test(start);

    let end: string;
    if (allDay) {
      const day = start.slice(0, 10);
      if (!realDay(day)) return fail("start must be a day, YYYY-MM-DD (or a local time).");
      const last = endIn ? endIn.slice(0, 10) : day;
      if (!realDay(last) || last < day) return fail("end must be the same day as start or later.");
      if (last > addDays(day, MAX_EVENT_DAYS - 1)) return fail(`An all-day event can be at most ${MAX_EVENT_DAYS} days.`);
      end = last;
      return this.event(title.value!, day, end, true, location.value, today);
    }
    const s = LOCAL.exec(start);
    if (!s || !realDay(s[1])) return fail("start must be a local time, YYYY-MM-DDTHH:MM (or a day for all day).");
    if (endIn !== undefined) {
      const e = LOCAL.exec(endIn);
      if (!e || !realDay(e[1])) return fail("end must be a local time, YYYY-MM-DDTHH:MM.");
      if (endIn <= start) return fail("end must be after start.");
      if (minutesBetween(start, endIn) > MAX_EVENT_DAYS * 1440) return fail(`An event can be at most ${MAX_EVENT_DAYS} days.`);
      end = endIn;
    } else {
      end = addMinutes(start, DEFAULT_EVENT_MIN);
    }
    return this.event(title.value!, start, end, false, location.value, today);
  }

  private event(title: string, start: string, end: string, allDay: boolean, location: string | undefined, today: string): PhoneOutput {
    if (start.slice(0, 10) < today) return fail(`start is in the past (today is ${today}).`);
    if (start.slice(0, 10) > addDays(today, MAX_DAYS_AHEAD)) return fail(`at most ${MAX_DAYS_AHEAD} days ahead.`);
    return this.card(
      { type: "calendar_add", title, start, end, all_day: allDay, location: location ?? null },
      waiting("Add to calendar", "Add to calendar", " They can change the details and the calendar on the card first."),
    );
  }
}
