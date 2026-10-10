// Alarms, reminders and calendar entries in the chat (chat/phone_actions.ts, design D31): every
// field checked before the app gets a card, a credential refused (rule 9), the waiting message so
// the model never claims it is done, one card per message, an older app told to update, and the
// actions never offered to the Claude connector.
import { assert, assertEquals } from "jsr:@std/assert@1";
import "../eval/harness.ts"; // Edge runtime stand-ins
import { ACTION_NAMES, ChatActions } from "../../supabase/functions/chat/actions.ts";
import {
  CAN_ALARM, CAN_CALENDAR_ADD, CAN_REMINDER, PHONE_ACTION_NAMES, PhoneActions,
} from "../../supabase/functions/chat/phone_actions.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import { World } from "../eval/world.ts";

const TZ = "America/New_York";
/** 2026-10-10 9:00 am in New York. */
const NOW = Date.parse("2026-10-10T13:00:00Z");
const ALL = new Set([CAN_ALARM, CAN_REMINDER, CAN_CALENDAR_ADD]);
const phone = (can: ReadonlySet<string> = ALL) => new PhoneActions({ can, tz: TZ, now: () => NOW });
const PIN = "my PIN is 4831";

Deno.test("set_alarm: a time, weekdays in order, a label; the card waits for the tap", () => {
  const out = phone().run("set_alarm", { time: "06:30", days: ["fri", "mon"], label: "Gym" });
  assertEquals(out.isError, false);
  assertEquals(out.events, [{ type: "alarm", time: "06:30", days: ["mon", "fri"], label: "Gym" }]);
  assertEquals(JSON.parse(out.text).status, "waiting_for_user");
  assert(JSON.parse(out.text).message.includes("Not done yet"));
  assertEquals(phone().run("set_alarm", { time: "6:30" }).isError, true, "HH:MM only");
  assertEquals(phone().run("set_alarm", { time: "24:00" }).isError, true);
  assertEquals(phone().run("set_alarm", { time: "06:30", days: ["funday"] }).isError, true);
});

Deno.test("set_reminder: in the future, within a year, text required; the time is local", () => {
  const ok = phone().run("set_reminder", { at: "2026-10-10T17:00", text: "  Call   Sam " });
  assertEquals(ok.events, [{ type: "reminder", at: "2026-10-10T17:00", text: "Call Sam" }]);
  assertEquals(phone().run("set_reminder", { at: "2026-10-10T08:59", text: "x" }).isError, true, "9 am local has passed");
  assertEquals(phone().run("set_reminder", { at: "2027-10-12T09:00", text: "x" }).isError, true, "over a year ahead");
  assertEquals(phone().run("set_reminder", { at: "2026-02-30T09:00", text: "x" }).isError, true, "not a real day");
  assertEquals(phone().run("set_reminder", { at: "2026-10-11T09:00" }).isError, true, "no text");
  assertEquals(phone().run("set_reminder", { at: "2026-10-11T09:00", text: "x".repeat(201) }).isError, true);
});

Deno.test("a password, PIN or code is refused in a reminder, alarm label or event, without repeating it", () => {
  for (const [name, input] of [
    ["set_reminder", { at: "2026-10-11T09:00", text: `tell Sam ${PIN}` }],
    ["set_alarm", { time: "06:30", label: PIN }],
    ["add_calendar_event", { title: `Bank: ${PIN}`, start: "2026-10-14T15:00" }],
    ["add_calendar_event", { title: "Bank", start: "2026-10-14T15:00", location: "wifi password: hunter2hunter2" }],
  ] as const) {
    const out = phone().run(name, input as Record<string, unknown>);
    assertEquals(out.isError, true, name);
    assertEquals(out.events, [], `${name}: no card reaches the app`);
    assert(!out.text.includes("4831") && !out.text.includes("hunter2"), "the value is never repeated");
    assert(out.text.includes("Vault"));
  }
});

Deno.test("add_calendar_event: one hour by default, all day from a day, the past and odd ends refused", () => {
  assertEquals(phone().run("add_calendar_event", { title: "Dentist", start: "2026-10-14T15:00" }).events, [
    { type: "calendar_add", title: "Dentist", start: "2026-10-14T15:00", end: "2026-10-14T16:00", all_day: false, location: null },
  ]);
  assertEquals(phone().run("add_calendar_event", { title: "Recital", start: "2026-10-16", location: "School hall" }).events, [
    { type: "calendar_add", title: "Recital", start: "2026-10-16", end: "2026-10-16", all_day: true, location: "School hall" },
  ]);
  assertEquals(phone().run("add_calendar_event", { title: "Late", start: "2026-10-14T23:30" }).events[0].end, "2026-10-15T00:30");
  assertEquals(phone().run("add_calendar_event", { title: "x", start: "2026-10-09T10:00" }).isError, true, "yesterday");
  assertEquals(phone().run("add_calendar_event", { title: "x", start: "2026-10-14T15:00", end: "2026-10-14T14:00" }).isError, true);
  assertEquals(phone().run("add_calendar_event", { title: "x", start: "2026-10-14", end: "2026-11-30" }).isError, true, "too long");
  assertEquals(phone().run("add_calendar_event", { start: "2026-10-14T15:00" }).isError, true, "no title");
});

Deno.test("show_alarms and find_reminders: a card, and the model told it cannot see or cancel anything", () => {
  const alarms = phone().run("show_alarms", {});
  assertEquals(alarms.events, [{ type: "show_alarms" }]);
  assert(JSON.parse(alarms.text).message.includes("cannot see or cancel"));
  const found = phone().run("find_reminders", { about: "call Sam" });
  assertEquals(found.events, [{ type: "find_reminders", about: "call Sam" }]);
  assert(JSON.parse(found.text).message.includes("do not list, guess or confirm"));
  assertEquals(phone().run("find_reminders", {}).events, [{ type: "find_reminders" }]);
});

Deno.test("one card per message, whatever the model repeats", () => {
  const p = phone();
  assertEquals(p.run("set_alarm", { time: "06:30" }).events.length, 1);
  assertEquals(p.run("set_alarm", { time: "06:30" }).events.length, 0);
  assertEquals(p.run("set_alarm", { time: "07:00" }).events.length, 1);
});

Deno.test("an app that cannot show a card: no card, and the model told to suggest updating", () => {
  const old = phone(new Set(["calendar"]));
  for (const name of PHONE_ACTION_NAMES) {
    const out = old.run(name, { time: "06:30", at: "2026-10-11T09:00", text: "x", title: "x", start: "2026-10-14" });
    assertEquals(out.events, [], name);
    assertEquals(JSON.parse(out.text).status, "app_cannot");
  }
  // Only the capability each needs: an app with reminders but not alarms.
  const some = phone(new Set([CAN_REMINDER]));
  assertEquals(some.run("set_reminder", { at: "2026-10-11T09:00", text: "x" }).events.length, 1);
  assertEquals(some.run("set_alarm", { time: "06:30" }).events.length, 0);
});

Deno.test("chat actions route the phone actions; the Claude connector never has them", async () => {
  for (const name of PHONE_ACTION_NAMES) assert(ACTION_NAMES.has(name), name);
  const a = new ChatActions({ db: new World().client(), distanceUnit: "mi", can: ALL, tz: TZ, now: () => NOW });
  assertEquals((await a.run("set_alarm", { time: "06:30" })).events, [{ type: "alarm", time: "06:30" }]);
  // Without "can" (the default), no card.
  const none = new ChatActions({ db: new World().client(), distanceUnit: "mi" });
  assertEquals((await none.run("set_alarm", { time: "06:30" })).events, []);

  const registered: string[] = [];
  const fake = { registerTool: (name: string) => registered.push(name) };
  for (const r of ALL_TOOLS) r(fake as never, { db: new World().client(), userId: "u", accessToken: "t", assistantName: "Wilma", log: () => {} });
  for (const name of PHONE_ACTION_NAMES) assert(!registered.includes(name), `${name} must not be an MCP tool`);
});
