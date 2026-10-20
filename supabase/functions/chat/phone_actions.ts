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
//   save_home({label, address?, make_default?}) {"type":"home_save","label","address","make_default"}  Save
//
// save_home (homes, design D36, docs/my-places-plan.md step 2) works the same way: the phone finds
// the address on the map with its own geocoder (or uses where it is) and writes the home_place row
// on the tap. Nothing is saved on the server here, and the model never sees a point.
//   show_help({topic?})                         {"type":"help","topic"?}                       🛟 Help topics
//   save_routine({name, repeat, when?, day?, tasks, suggest?})
//                                               {"type":"routine_save","name","repeat","when","day"?,"suggest","tasks"}  Save routine
//
// save_routine (routines step 4, design D39, docs/routines-plan.md) is a card too: the schedule is
// checked with the server's own rules (normalizeRoutine) and the app saves the routine and its tasks
// on the tap, through the same tools as its New routine screen. Nothing is saved here.
//
// show_help (docs/help-plan.md step 2, design D37) is the one card here that changes nothing: it
// opens the app's own Help topics. It carries a topic name only, never user data. An app without
// it gets a short answer in words instead of the "update Wilma" sentence.
//
// Times are the user's local wall-clock times in the phone's time zone. Text that looks like a
// password, PIN or code is refused here (and again on the phone): a reminder shows on the lock
// screen and a calendar may be shared (rule 9). Reminders live only on the phone, so the model never
// sees them: find_reminders lets the app match and show them itself. An app that cannot show a card
// (it does not list the capability in "can") gets a sentence to update Wilma instead.
import type { ToolSpec } from "../_shared/llm/index.ts";
import { localTime } from "../_shared/dayplan/time.ts";
import { findCredential } from "../mcp/lib/credentials.ts";
import { normalizeRoutine } from "../mcp/lib/routines.ts";

/** What the app lists in "can" for these cards. */
export const CAN_ALARM = "alarm";
export const CAN_REMINDER = "reminder";
export const CAN_CALENDAR_ADD = "calendar_add";
export const CAN_HOME = "home";
export const CAN_HELP = "help";
export const CAN_ROUTINE = "routine";

/** The app's Help topics (app/src/lib/help.ts); show_help names one of these. */
export const HELP_TOPICS = ["notes", "vault", "day", "alarms", "places", "recipes", "memory", "spaces", "privacy"] as const;

export const MAX_TEXT = 200;
export const MAX_LOCATION = 300;
/** A home's name and address, as home_place allows (migration home_place). */
export const MAX_HOME_LABEL = 60;
export const MAX_HOME_ADDRESS = 300;
/** A routine's name and tasks, as the app's New routine screen allows (app/src/lib/routineForm.ts). */
export const MAX_ROUTINE_NAME = 200;
export const MAX_ROUTINE_TASK = 300;
export const MAX_ROUTINE_TASKS = 20;
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
  {
    name: "save_home",
    description:
      "Chat app only. Shows the user a card to save a home: where they live, or another place they plan their " +
      "day from (\"my home is 12 Oak St, Oviedo\", \"I live at ...\", \"I moved to ...\", \"save my mom's house, " +
      "4 Elm Rd, as a home\"). The phone finds the address on the map; nothing is saved until they tap Save. " +
      "The only way to save a home: never as a note, a place or a memory. Never put a code, PIN or password in it.",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: `Its name, at most ${MAX_HOME_LABEL} characters: "Home" for where the user lives, else their own ` +
            "name for it (\"Mom's\", \"Lake house\", \"Work\")",
        },
        address: {
          type: "string",
          description: "The address as the user gave it (optional: without one, the card offers Use where I am)",
        },
        make_default: {
          type: "boolean",
          description: "True when it is where the user lives now (\"my home is\", \"I live at\", \"I moved to\"): plans " +
            "start there. False for other places (optional, default false)",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
  },
  {
    name: "save_routine",
    description:
      "Chat app only. Shows the user a card to save a routine: a named group of tasks that comes back each week, " +
      "every two weeks or each month (\"make my Saturday chores a weekly routine: laundry, vacuum, groceries\", " +
      "\"a monthly routine for the HVAC filter and smoke alarms\"). Wilma then offers its tasks in My day when " +
      "there is free time. Nothing is saved until they tap Save routine. The only way to make a new routine in the " +
      "chat: never save_item for it or its tasks. To add a task to an existing routine use save_item (a task with " +
      "metadata.routine_id) instead. Never put a password, PIN or code in it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: `Its name, at most ${MAX_ROUTINE_NAME} characters ("Weekend house reset")` },
        repeat: { type: "string", enum: ["weekly", "biweekly", "monthly"], description: "biweekly is every two weeks" },
        when: {
          type: "string",
          enum: ["any_day", "same_day", "by_day"],
          description: "any_day (default): any day of the week, fortnight or month. same_day (weekly, biweekly): only on " +
            "`day`, e.g. every Saturday. by_day (monthly): by `day` of the month, e.g. by the 28th",
        },
        day: { type: "integer", description: "same_day: 0 Sunday … 6 Saturday; by_day: 1-31. Only with those" },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ROUTINE_TASKS,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short, in the user's words (\"Vacuum\")" },
              minutes: { type: "integer", description: "How long, only if the user said (optional; My day assumes about 30)" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
        suggest: { type: "boolean", description: "Offer its tasks in My day (optional, default true)" },
      },
      required: ["name", "repeat", "tasks"],
      additionalProperties: false,
    },
  },
  {
    name: "show_help",
    description:
      "Chat app only. Shows the user a Help card with the app's short topics (notes, the vault, My day, alarms " +
      "and calendar, places, recipes and cocktails, memory, spaces, privacy), opened at `topic` when one fits. For \"what can you do\", " +
      "\"help\", \"how does this work\" and \"how do I …\" questions: answer in one or two short sentences and always call " +
      "this too, even when your sentences answer. Never list every feature yourself. It changes nothing and saves nothing.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: [...HELP_TOPICS], description: "The closest topic (optional: leave out for the list)" },
      },
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
  save_home: CAN_HOME,
  show_help: CAN_HELP,
  save_routine: CAN_ROUTINE,
};

const WHAT: Record<string, string> = {
  set_alarm: "set alarms", show_alarms: "open your alarms", set_reminder: "set reminders",
  find_reminders: "show your reminders", add_calendar_event: "add calendar events",
  save_home: "save homes from the chat", show_help: "show Help", save_routine: "save routines from the chat",
};

const fail = (text: string): PhoneOutput => ({ isError: true, text, events: [] });

/** Refused before anything reaches the app (rule 9): never the value, never a hint of it. */
const CREDENTIAL = "Not shown: that text looks like it contains a password, PIN or code. A reminder shows on the " +
  "lock screen and a calendar may be shared, so it can't go there. Do not repeat the value. Passwords belong in " +
  "the Vault: offer save_secret. The card can be made again without the value.";

/** The same refusal for a routine: its name and tasks show in Tasks and My day (rule 9). */
const ROUTINE_CREDENTIAL = "Not shown: that text looks like it contains a password, PIN or code, which never goes in " +
  "a routine or its tasks (\"Change the Wi-Fi password\" is fine; the password itself is not). Do not repeat the " +
  "value. Passwords belong in the Vault: offer save_secret. The card can be made again without the value.";

/** The same refusal for a home: an alarm code or gate PIN is never part of one (rule 9). */
const HOME_CREDENTIAL = "Not shown: that text looks like it contains a password, PIN or code (an alarm code or gate " +
  "PIN, for example), which never goes in a home's name or address. Do not repeat the value. Codes and passwords " +
  "belong in the Vault: offer save_secret. The card can be made again without the value.";

function waiting(card: string, button: string, extra = ""): string {
  return JSON.stringify({
    status: "waiting_for_user",
    message: `Not done yet. The app is showing the user a ${card} card; it happens only if they tap ${button}. ` +
      `Tell them in one short sentence to check the card and tap ${button}.${extra} Do not call this again for it.`,
  });
}

/** A text field: trimmed, one line, at most `max` characters; refused when it looks like a credential. */
function text(v: unknown, field: string, max: number, required: boolean, credential = CREDENTIAL): { value?: string; error?: string } {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    return required ? { error: `${field} is required.` } : {};
  }
  if (typeof v !== "string") return { error: `${field} must be text.` };
  const value = v.trim().replace(/\s+/g, " ");
  if (value.length > max) return { error: `${field} can be at most ${max} characters.` };
  if (findCredential(value)) return { error: credential };
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
    if (!this.ctx.can.has(need) && name === "show_help") {
      // Nothing to update for: the answer in words is enough.
      return {
        isError: false,
        text: JSON.stringify({
          status: "app_cannot",
          message: "This app shows no Help card. Your short answer is all the user gets: one or two sentences, " +
            "the few things that matter for their question. Do not list every feature.",
        }),
        events: [],
      };
    }
    if (!this.ctx.can.has(need)) {
      return {
        isError: false,
        text: JSON.stringify({
          status: "app_cannot",
          message: `This version of the app cannot ${WHAT[name]}. Tell the user in one short sentence that updating ` +
            "Wilma from the Play Store adds it" + (name === "set_alarm" || name === "show_alarms" ? ", and that meanwhile " +
              "they can use their Clock app." : name === "save_home" ? ", and that meanwhile they can set where they leave " +
              "from in My day. Do not save the home as a note, a place or a memory instead." : name === "save_routine"
              ? ", and that meanwhile they can make it in Tasks → Routines. Do not save the routine or its tasks some " +
                "other way." : "."),
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
      case "save_home":
        return this.home(input);
      case "show_help":
        return this.help(input);
      case "save_routine":
        return this.routine(input);
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

  private help(input: Record<string, unknown>): PhoneOutput {
    const topic = input.topic;
    if (topic !== undefined && topic !== null && !(HELP_TOPICS as readonly unknown[]).includes(topic)) {
      return fail(`topic must be one of: ${HELP_TOPICS.join(", ")} (or left out).`);
    }
    return this.card(
      { type: "help", ...(typeof topic === "string" ? { topic } : {}) },
      JSON.stringify({
        status: "shown",
        message: "The app is showing the user a Help card with its topics" + (typeof topic === "string" ? `, open at ${topic}` : "") +
          ". Do not repeat what the card holds; your one or two sentences are enough. Nothing was saved or changed.",
      }),
    );
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

  private home(input: Record<string, unknown>): PhoneOutput {
    const label = text(input.label, "label", MAX_HOME_LABEL, true, HOME_CREDENTIAL);
    if (label.error) return fail(label.error);
    const address = text(input.address, "address", MAX_HOME_ADDRESS, false, HOME_CREDENTIAL);
    if (address.error) return fail(address.error);
    if (input.make_default !== undefined && typeof input.make_default !== "boolean") return fail("make_default must be true or false.");
    return this.card(
      { type: "home_save", label: label.value, address: address.value ?? null, make_default: input.make_default === true },
      waiting(
        "Save home",
        "Save",
        " The phone finds the address on the map, so they can check it on the card (or use where they are). Do not also " +
          "save it as a note, a place or a memory.",
      ),
    );
  }

  private routine(input: Record<string, unknown>): PhoneOutput {
    const name = text(input.name, "name", MAX_ROUTINE_NAME, true, ROUTINE_CREDENTIAL);
    if (name.error) return fail(name.error);
    if (!Array.isArray(input.tasks) || !input.tasks.length) return fail("tasks must list at least one task.");
    if (input.tasks.length > MAX_ROUTINE_TASKS) return fail(`A routine holds up to ${MAX_ROUTINE_TASKS} tasks.`);
    const tasks: { title: string; minutes?: number }[] = [];
    for (const t of input.tasks) {
      if (typeof t !== "object" || t === null || Array.isArray(t)) return fail("each task must be {title, minutes?}.");
      const { title: rawTitle, minutes, ...rest } = t as Record<string, unknown>;
      if (Object.keys(rest).length) return fail("each task has only title and minutes.");
      const title = text(rawTitle, "a task's title", MAX_ROUTINE_TASK, true, ROUTINE_CREDENTIAL);
      if (title.error) return fail(title.error);
      if (minutes !== undefined && minutes !== null && (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
        return fail("minutes must be a whole number from 1 to 1440 (or left out).");
      }
      tasks.push({ title: title.value!, ...(typeof minutes === "number" ? { minutes } : {}) });
    }
    // The server's own rules for the schedule, so the card never offers what the tap could not save.
    let schedule;
    try {
      schedule = normalizeRoutine({
        repeat: input.repeat,
        ...(input.when !== undefined ? { when: input.when } : {}),
        ...(input.day !== undefined ? { day: input.day } : {}),
        ...(input.suggest !== undefined ? { suggest: input.suggest } : {}),
      }, this.nowLocal().slice(0, 10));
    } catch (e) {
      return fail((e as Error).message.replace(/^Routine not saved: /, ""));
    }
    return this.card(
      {
        type: "routine_save", name: name.value, repeat: schedule.repeat, when: schedule.when,
        ...(schedule.day !== undefined ? { day: schedule.day } : {}), suggest: schedule.suggest, tasks,
      },
      waiting(
        "Save routine",
        "Save routine",
        " After saving they can change it in Tasks → Routines. Do not also save the routine or its tasks with save_item.",
      ),
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
