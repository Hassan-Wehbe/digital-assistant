// Daily routines (docs/routines-plan.md "Daily routines", 2026-10-21; D39): every day (weekends
// included) or every weekday (Q-D1), one day at a time, missed ones moving on to the next day (Q6);
// an optional time "at" (Q-D3); in My day each daily routine is one line, its tasks one after another
// (Q-D2), counting as one of the 3 and coming first; the chat's Save routine card and plan line.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, type Item, World } from "../eval/world.ts";
import {
  addDays,
  normalizeRoutine,
  periodOn,
  routineTaskDone,
  routineWords,
  settleRoutineTask,
  withRoutine,
} from "../../supabase/functions/mcp/lib/routines.ts";
import { normalizeTask, TaskError } from "../../supabase/functions/mcp/lib/tasks.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import { type DayPlan, fromMin, type PlanTask, routineSuggestions } from "../../supabase/functions/_shared/dayplan/plan.ts";
import { createHandler } from "../../supabase/functions/chat/chat.ts";
import { planForModel } from "../../supabase/functions/chat/agenda.ts";
import { CAN_ROUTINE, PhoneActions } from "../../supabase/functions/chat/phone_actions.ts";

const R = (m: Record<string, unknown>, today = "2026-10-01") => normalizeRoutine(m, today);
const RID = "00000000-0000-4000-8000-00000000d001";
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

// ---- the schedule -------------------------------------------------------------------------------

Deno.test("normalizeRoutine: daily and weekdays, with an optional time; nothing else goes with them", () => {
  assertEquals(R({ repeat: "daily" }), { repeat: "daily", when: "any_day", starts_on: "2026-10-01", suggest: true });
  assertEquals(R({ repeat: "Weekdays", at: "7:30" }), { repeat: "weekdays", when: "any_day", starts_on: "2026-10-01", suggest: true, at: "07:30" });
  assertEquals(R({ repeat: "daily", at: "" }).at, undefined);
  for (const bad of [
    { repeat: "daily", when: "same_day", day: 3 },
    { repeat: "weekdays", when: "by_day", day: 3 },
    { repeat: "daily", day: 3 },
    { repeat: "weekly", at: "07:30" },
    { repeat: "monthly", at: "07:30" },
    { repeat: "daily", at: "25:00" },
    { repeat: "daily", at: "7.30" },
    { repeat: "daily", at: "morning" },
    { repeat: "daily", at: 730 },
  ]) {
    assertThrows(() => R(bad), TaskError, "Routine not saved", JSON.stringify(bad));
  }
});

Deno.test("routineWords: every day, every weekday, with the time", () => {
  assertEquals(routineWords(R({ repeat: "daily" })), "Every day");
  assertEquals(routineWords(R({ repeat: "weekdays", at: "07:30" })), "Every weekday at 07:30");
});

Deno.test("periods over a whole year: daily is that day; weekdays is that day, or the Monday after a weekend", () => {
  const daily = R({ repeat: "daily", starts_on: "2026-01-01" });
  const weekdays = R({ repeat: "weekdays", starts_on: "2026-01-01" });
  for (let d = "2026-01-01"; d <= "2026-12-31"; d = addDays(d, 1)) {
    assertEquals(periodOn(daily, d), { window_from: d, due_on: d }, d);
    const p = periodOn(weekdays, d);
    assertEquals(p.window_from, p.due_on);
    assert(dow(p.due_on) >= 1 && dow(p.due_on) <= 5, `${d}: ${p.due_on}`);
    assertEquals(p.due_on, dow(d) === 6 ? addDays(d, 2) : dow(d) === 0 ? addDays(d, 1) : d, d);
  }
  // Before it starts: its first day.
  assertEquals(periodOn(R({ repeat: "daily", starts_on: "2026-10-20" }), "2026-10-01").due_on, "2026-10-20");
});

Deno.test("a daily routine's task: today's; done, tomorrow (Friday's weekday one: Monday); missed, today's again", () => {
  const daily = R({ repeat: "daily" });
  const weekdays = R({ repeat: "weekdays" });
  const t = withRoutine(normalizeTask({}), RID, daily, "2026-10-21");
  assertEquals([t.repeat, t.window_from, t.due_on], ["daily", "2026-10-21", "2026-10-21"]);
  // Done already today (added back, or the schedule changed): tomorrow's.
  assertEquals(withRoutine({ ...t, last_done_on: "2026-10-21" }, RID, daily, "2026-10-21").due_on, "2026-10-22");
  assertEquals(routineTaskDone(t, daily, "2026-10-21").due_on, "2026-10-22");
  // Saturday and Sunday count for a daily routine (Q-D1).
  assertEquals(routineTaskDone({ ...t, window_from: "2026-10-24", due_on: "2026-10-24" }, daily, "2026-10-24").due_on, "2026-10-25");
  const fri = withRoutine(normalizeTask({}), RID, weekdays, "2026-10-23");
  assertEquals([fri.repeat, fri.due_on], ["weekdays", "2026-10-23"]);
  assertEquals(routineTaskDone(fri, weekdays, "2026-10-23").due_on, "2026-10-26");
  // Missed (Q6): never overdue, it is simply today's.
  const { task, missed } = settleRoutineTask(t, daily, "2026-10-23");
  assert(missed);
  assertEquals([task.window_from, task.due_on, task.missed_on], ["2026-10-23", "2026-10-23", "2026-10-21"]);
  assertEquals(settleRoutineTask(t, daily, "2026-10-21").missed, false);
});

// ---- My day's line (no database) ----------------------------------------------------------------

const DATE = "2026-10-09";
const at = (m: number) => fromMin(DATE, m);
const H = (h: number, m = 0) => h * 60 + m;
const dt = (id: string, title: string, routine: string, more: Partial<PlanTask> = {}): PlanTask =>
  ({ id, title, priority: "normal", routine, suggest: true, due_on: DATE, daily_routine: `r-${routine}`, ...more });
const wk = (id: string, title: string, more: Partial<PlanTask> = {}): PlanTask =>
  ({ id, title, priority: "important", routine: "Weekend reset", suggest: true, due_on: "2026-10-10", ...more });

Deno.test("routineSuggestions: a daily routine is one line, its tasks one after another from its time, first of the 3", () => {
  const tasks = [
    wk("w1", "Vacuum"),
    wk("w2", "Laundry", { duration_min: 45 }),
    dt("m1", "Make bed", "Morning", { duration_min: 5, routine_at: "07:30", added_at: "2026-10-01T10:00:00Z" }),
    dt("m2", "Vitamins", "Morning", { duration_min: 5, routine_at: "07:30", added_at: "2026-10-01T10:00:01Z" }),
    dt("m3", "Stretch", "Morning", { duration_min: 10, routine_at: "07:30", added_at: "2026-10-01T10:00:02Z" }),
  ];
  const out = routineSuggestions(tasks, new Set(tasks.map((t) => t.id)), [[H(7), H(8)], [H(9), H(12)]], at)!;
  assertEquals(out.items.map((s) => s.title), ["Morning", "Laundry", "Vacuum"]);
  assertEquals(out.more, 0);
  const m = out.items[0];
  assertEquals([m.routine, m.duration_min, m.start, m.end, m.task_id], ["Morning", 20, `${DATE}T07:30`, `${DATE}T07:50`, "m1"]);
  // In the order they were added, not by title.
  assertEquals(m.tasks!.map((g) => [g.title, g.start, g.end]), [
    ["Make bed", `${DATE}T07:30`, `${DATE}T07:35`],
    ["Vitamins", `${DATE}T07:35`, `${DATE}T07:40`],
    ["Stretch", `${DATE}T07:40`, `${DATE}T07:50`],
  ]);
  // Weekly ones fill the rest of the free time, never over the routine's minutes.
  assertEquals(out.items[1].start, `${DATE}T09:00`, "45 min do not fit before 7:30");
  assertEquals(out.items[2].start, `${DATE}T07:00`);
});

Deno.test("routineSuggestions: busy at its time, the next free time that holds it all; no time, the earliest; one task, plain", () => {
  const tasks = [
    dt("e1", "Check email", "Email", { duration_min: 10, routine_at: "08:00" }),
    dt("p1", "Pack lunches", "Evening", { duration_min: 20 }),
    dt("p2", "Dishes", "Evening"),
  ];
  // 8:00 is taken (the free time is 7:00-7:45, then 9:20 on): Check email at 9:30.
  const out = routineSuggestions(tasks, new Set(tasks.map((t) => t.id)), [[H(7), H(7, 45)], [H(9, 20), H(12)]], at)!;
  const email = out.items.find((s) => s.routine === "Email")!;
  assertEquals([email.title, email.task_id, email.start, email.end, email.tasks], ["Check email", "e1", `${DATE}T09:30`, `${DATE}T09:40`, undefined]);
  // No time: the earliest free time that holds all 50 minutes (not 7:00-7:45), after Check email's.
  const evening = out.items.find((s) => s.routine === "Evening")!;
  assertEquals([evening.start, evening.duration_min, evening.duration_assumed], [`${DATE}T09:45`, 50, true]);
  assertEquals(out.items.find((s) => s.routine === "Evening")!.tasks!.length, 2);
  assertEquals(evening.tasks!.find((g) => g.title === "Dishes")!.duration_assumed, true);
  // Nothing that holds it all: not offered, counted.
  const none = routineSuggestions(tasks.slice(1), new Set(["p1", "p2"]), [[H(7), H(7, 30)]], at);
  assertEquals(none, null);
});

Deno.test("routineSuggestions: a daily routine's task with a place stays its own line, for Find a time", () => {
  const tasks = [
    dt("a", "Walk the dog", "Morning", { place: { lat: 1, lng: 1, label: "Park" } }),
    dt("b", "Make bed", "Morning", { duration_min: 5 }),
  ];
  const out = routineSuggestions(tasks, new Set(["a", "b"]), [[H(7), H(9)]], at)!;
  assertEquals(out.items.map((s) => [s.title, s.start]), [["Make bed", `${DATE}T07:00`], ["Walk the dog", undefined]]);
});

// ---- the tools on the pretend account -----------------------------------------------------------

async function call(w: World, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  for (const r of ALL_TOOLS) r(server, { db: w.client(), userId: "u", accessToken: "t", assistantName: "Wilma", log: () => {} });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const out = await res.json();
  if (out.error) return { isError: true, text: String(out.error.message), json: null };
  const text = out.result.content[0].text as string;
  return { isError: !!out.result.isError, text, json: out.result.isError ? null : JSON.parse(text) };
}

Deno.test("save_item and update_item: a daily routine and its tasks; done moves it to tomorrow; a password is refused", async () => {
  const w = new World();
  const r = await call(w, "save_item", { title: "Morning", body: "", item_type: "routine", metadata: { repeat: "daily", at: "07:30" } });
  assertEquals(r.isError, false, r.text);
  assertEquals(r.json.routine.schedule, "Every day at 07:30");
  const t = await call(w, "save_item", { title: "Check email", body: "", item_type: "task", metadata: { routine_id: r.json.id, duration_min: 10 } });
  assertEquals(t.isError, false, t.text);
  assertEquals(t.json.task.repeat, "daily");
  assertEquals(t.json.task.window_from, t.json.task.due_on);
  const day = t.json.task.due_on as string;
  const done = await call(w, "update_item", { item_id: t.json.id, task_done: true, today: day });
  assertEquals(done.isError, false, done.text);
  assertEquals([done.json.task.due_on, done.json.task.last_done_on], [addDays(day, 1), day]);
  // To weekdays: its task is brought in step, with a revision (rule 7).
  const ch = await call(w, "update_item", { item_id: r.json.id, metadata: { repeat: "weekdays", at: "08:00" } });
  assertEquals(ch.isError, false, ch.text);
  const task = w.items.find((i) => i.id === t.json.id)!;
  assertEquals(task.metadata.repeat, "weekdays");
  assert(task.revisions >= 2);
  const secret = await call(w, "save_item", { title: "Wi-Fi password is hunter2rocks!", body: "", item_type: "task", metadata: { routine_id: r.json.id } });
  assertEquals(secret.isError, true);
  assert(!secret.text.includes("hunter2rocks"));
});

// ---- My day on the pretend account --------------------------------------------------------------

const ROUTINE = "00000000-0000-4000-8000-0000000004a1";
const id = (n: number) => `00000000-0000-4000-8000-0000000004${n.toString().padStart(2, "0")}`;

function item(w: World, iid: string, title: string, item_type: string, metadata: Record<string, unknown>, space: string = IDS.home): Item {
  const i: Item = {
    id: iid, space_id: space, title, item_type, summary: null, body_markdown: "", metadata, tags: [],
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, revisions: 0,
  };
  w.items.push(i);
  return i;
}

function account() {
  const w = new World();
  item(w, ROUTINE, "Morning", "routine", { repeat: "daily", when: "any_day", starts_on: "2026-10-01", suggest: true, at: "11:00" });
  const t = (due: string, more: Record<string, unknown> = {}) =>
    ({ status: "open", priority: "normal", repeat: "daily", routine_id: ROUTINE, window_from: due, due_on: due, ...more });
  item(w, id(1), "Make bed", "task", t(DATE, { duration_min: 5 }));
  item(w, id(2), "Vitamins", "task", t(DATE, { duration_min: 5 }));
  item(w, id(3), "Yesterday's stretch", "task", t("2026-10-08", { duration_min: 10 }));
  item(w, id(4), "Done today", "task", t("2026-10-10", { last_done_on: DATE }));
  item(w, id(5), "Hidden", "task", t(DATE), IDS.private);
  const base = w.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
  const client = {
    ...(w.client() as unknown as Record<string, unknown>),
    rpc: (name: string, params: Record<string, unknown> = {}) =>
      name === "use_day_plan" ? Promise.resolve({ data: { allowed: true, used: 1, limit: 30 }, error: null }) : base.rpc(name, params),
  } as unknown as SupabaseClient;
  return { w, client };
}

async function myDay(client: SupabaseClient, body: Record<string, unknown> = {}) {
  const h = createHandler({
    verifyToken: (t) => Promise.resolve(t === "tok" ? "user-a" : null),
    clientFor: () => client,
    llm: () => {
      throw new Error("My day must never call a model");
    },
    drives: () => null,
    log: () => {},
    now: () => Date.parse(`${DATE}T13:00:00Z`), // 9:00 in New York
  });
  const res = await h(new Request("http://localhost/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer tok" },
    body: JSON.stringify({
      mode: "day", date: DATE, tz: "America/New_York", now: `${DATE}T09:00`,
      events: [{ key: "call", title: "Call", start: `${DATE}T11:00`, end: `${DATE}T11:30`, all_day: false, calendar: "Work", not_a_trip: true }],
      ...body,
    }),
  }));
  assertEquals(res.status, 200);
  return (await res.json()).plan as DayPlan;
}

Deno.test("My day: a daily routine is one line after its busy time; yesterday's missed one is today's; done or hidden ones are not", async () => {
  const { w, client } = account();
  const plan = await myDay(client);
  const line = plan.suggestions!.items.find((s) => s.routine === "Morning")!;
  assertEquals(line.title, "Morning");
  // 11:00 is the call: the next free time, 11:30.
  assertEquals([line.start, line.duration_min], [`${DATE}T11:30`, 20]);
  assertEquals(line.tasks!.map((g) => g.title).sort(), ["Make bed", "Vitamins", "Yesterday's stretch"]);
  assertEquals(plan.suggestions!.items.length, 1);
  for (const t of plan.tasks_not_placed.filter((t) => t.routine)) assertEquals(t.overdue, undefined, t.title);
  assert(!plan.tasks_not_placed.some((t) => t.title === "Done today" || t.title === "Hidden"));
  const missed = w.items.find((i) => i.id === id(3))!;
  assertEquals([missed.metadata.due_on, missed.metadata.missed_on, missed.revisions], [DATE, "2026-10-08", 1]);
  // Not today for one task: the line holds the others.
  w.notToday.push({ task_id: id(1), day: DATE });
  const again = await myDay(client);
  assertEquals(again.suggestions!.items[0].tasks!.map((g) => g.title).sort(), ["Vitamins", "Yesterday's stretch"]);
});

Deno.test("planForModel: a daily routine's line is the routine's name and how many tasks, worked out by code", () => {
  const plan = {
    date: DATE, time_zone: "America/New_York", home: { set: false }, drive_times: "unavailable", weather: "unavailable",
    weather_at: [], credits: [], rows: [], all_day: [], tasks_not_placed: [],
    suggestions: {
      items: [{
        task_id: "x", title: "Morning", routine: "Morning", duration_min: 20, start: `${DATE}T07:30`, end: `${DATE}T07:50`,
        tasks: [{ task_id: "x", title: "Make bed", duration_min: 5, start: `${DATE}T07:30`, end: `${DATE}T07:35` },
          { task_id: "y", title: "Stretch", duration_min: 15, start: `${DATE}T07:35`, end: `${DATE}T07:50` }],
      }],
      more: 0,
    },
  } as unknown as DayPlan;
  const s = JSON.stringify(planForModel(plan, new Map()));
  assert(s.includes('"daily_routine":true') && s.includes('"tasks":2'), s);
  assert(s.includes("daily, weekly or monthly"), s);
});

// ---- the chat's Save routine card ---------------------------------------------------------------

const phone = () => new PhoneActions({ can: new Set([CAN_ROUTINE]), tz: "America/New_York", now: () => Date.parse("2026-10-21T16:00:00Z") });

Deno.test("save_routine: every day or weekdays, with a time; a time on a weekly one, or a day on a daily one, is refused", () => {
  const out = phone().run("save_routine", { name: "Morning", repeat: "daily", at: "7:30", tasks: [{ title: "Check email", minutes: 10 }] });
  assertEquals(out.isError, false, out.text);
  assertEquals(out.events, [{
    type: "routine_save", name: "Morning", repeat: "daily", when: "any_day", at: "07:30", suggest: true,
    tasks: [{ title: "Check email", minutes: 10 }],
  }]);
  assertEquals(phone().run("save_routine", { name: "Work start", repeat: "weekdays", tasks: [{ title: "Plan the day" }] }).events[0], {
    type: "routine_save", name: "Work start", repeat: "weekdays", when: "any_day", suggest: true, tasks: [{ title: "Plan the day" }],
  });
  for (const bad of [
    { name: "x", repeat: "weekly", at: "07:30", tasks: [{ title: "a" }] },
    { name: "x", repeat: "daily", when: "same_day", day: 2, tasks: [{ title: "a" }] },
    { name: "x", repeat: "daily", at: "half seven", tasks: [{ title: "a" }] },
  ]) {
    const r = phone().run("save_routine", bad);
    assertEquals([r.isError, r.events.length], [true, 0], JSON.stringify(bad));
  }
});
