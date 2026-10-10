// Tasks left open at the end of their day (docs/task-day-end-plan.md, design D35): the day_end
// field's rules, atDayEnd on its own, My day writing a settled task once (with a revision), listing
// one left open with no choice, never a task with a time on a later day, find_tasks showing the
// state without writing, and the chat's plan for the model unchanged.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, type Item, World } from "../eval/world.ts";
import { createHandler } from "../../supabase/functions/chat/chat.ts";
import type { DayLog } from "../../supabase/functions/chat/day.ts";
import { planForModel } from "../../supabase/functions/chat/agenda.ts";
import type { DayPlan } from "../../supabase/functions/_shared/dayplan/plan.ts";
import { atDayEnd, MAX_SETTLES_PER_PLAN, nextDay } from "../../supabase/functions/mcp/lib/day_end.ts";
import { normalizeTask, setTaskDone, TaskError } from "../../supabase/functions/mcp/lib/tasks.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";

const TZ = "America/New_York";
const YESTERDAY = "2026-10-09";
const TODAY = "2026-10-10";
/** 2026-10-10 9:00 am in New York. */
const NOW = Date.parse("2026-10-10T13:00:00Z");
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00-04:00`;

// ---- The field ---------------------------------------------------------------------------------

Deno.test("day_end: kept with a time; dropped without one or on a repeating task; a wrong value refused", () => {
  assertEquals(normalizeTask({ planned_at: at(YESTERDAY, "12:03"), day_end: "done" }).day_end, "done");
  assertEquals(normalizeTask({ planned_at: at(YESTERDAY, "12:03"), day_end: "next_day" }).day_end, "next_day");
  assertEquals(normalizeTask({ day_end: "done" }).day_end, undefined, "no time: nothing to end");
  assertEquals(normalizeTask({ planned_at: at(YESTERDAY, "08:00"), repeat: "daily", day_end: "done" }).day_end, undefined);
  assertThrows(() => normalizeTask({ planned_at: at(YESTERDAY, "12:03"), day_end: "never" }), TaskError, "day_end");
});

Deno.test("day_end: opening a task again forgets it, so it is not closed again at the end of the day", () => {
  const done = normalizeTask({ status: "done", planned_at: at(YESTERDAY, "12:03"), day_end: "done" });
  assertEquals(setTaskDone(done as unknown as Record<string, unknown>, false).day_end, undefined);
  assertEquals(setTaskDone({ planned_at: at(YESTERDAY, "12:03"), day_end: "next_day" }, true).day_end, "next_day");
});

// ---- atDayEnd ----------------------------------------------------------------------------------

Deno.test("atDayEnd: done at the end of that day; moved to the next day; no choice: left open", () => {
  const base = { status: "open" as const, priority: "normal" as const, planned_at: at(YESTERDAY, "12:03") };
  const done = atDayEnd({ ...base, day_end: "done" }, { now: NOW, tz: TZ });
  assertEquals(done.settle, "done");
  assertEquals(done.task.status, "done");
  assertEquals(done.task.done_at, "2026-10-09T23:59:00-04:00");
  assertEquals(done.task.day_end, undefined);

  const moved = atDayEnd({ ...base, day_end: "next_day", due_on: "2026-10-20" }, { now: NOW, tz: TZ });
  assertEquals(moved.settle, "next_day");
  assertEquals(moved.task.status, "open");
  assertEquals(moved.task.planned_at, undefined);
  assertEquals(moved.task.day_end, undefined);
  assertEquals(moved.task.due_on, TODAY, "due the next day, even when it was due later");
  assertEquals(atDayEnd({ ...base, day_end: "next_day", due_on: "2026-10-01" }, { now: NOW, tz: TZ }).task.due_on, "2026-10-01",
    "an earlier due date is kept");

  const left = atDayEnd(base, { now: NOW, tz: TZ });
  assertEquals(left, { task: base, left_from: YESTERDAY });
});

Deno.test("atDayEnd: nothing changes before the day ends, for a done task, or without a time", () => {
  const today = { status: "open" as const, priority: "normal" as const, planned_at: at(TODAY, "18:00"), day_end: "done" as const };
  assertEquals(atDayEnd(today, { now: NOW, tz: TZ }), { task: today });
  const done = { status: "done" as const, priority: "normal" as const, planned_at: at(YESTERDAY, "12:03"), done_at: "2026-10-09T13:00:00Z" };
  assertEquals(atDayEnd(done, { now: NOW, tz: TZ }), { task: done });
  const noTime = { status: "open" as const, priority: "normal" as const, due_on: YESTERDAY };
  assertEquals(atDayEnd(noTime, { now: NOW, tz: TZ }), { task: noTime });
});

Deno.test("atDayEnd without the phone's time zone: the day is read in the time's own offset", () => {
  const late = { status: "open" as const, priority: "normal" as const, planned_at: at(YESTERDAY, "23:30"), day_end: "done" as const };
  // 2026-10-10 02:00 UTC is still 10 pm on Oct 9 in New York: the day has not ended.
  assertEquals(atDayEnd(late, { now: Date.parse("2026-10-10T02:00:00Z") }).settle, undefined);
  assertEquals(atDayEnd(late, { now: Date.parse("2026-10-10T04:30:00Z") }).settle, "done");
  // The user's date, when given, wins.
  assertEquals(atDayEnd(late, { now: Date.parse("2026-10-10T02:00:00Z"), today: TODAY }).settle, "done");
  assertEquals(nextDay("2026-10-31"), "2026-11-01");
});

// ---- My day ------------------------------------------------------------------------------------

const id = (n: number) => `00000000-0000-4000-8000-0000000003${n.toString().padStart(2, "0")}`;

function task(w: World, n: number, title: string, metadata: Record<string, unknown>, space: string = IDS.home): Item {
  const i: Item = {
    id: id(n), space_id: space, title, item_type: "task", summary: null, body_markdown: "", tags: [],
    metadata: { status: "open", priority: "normal", ...metadata },
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, revisions: 0,
  };
  w.items.push(i);
  return i;
}

function proClient(w: World): SupabaseClient {
  const base = w.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
  return {
    ...(w.client() as unknown as Record<string, unknown>),
    rpc: (name: string, params: Record<string, unknown> = {}) =>
      name === "use_day_plan"
        ? Promise.resolve({ data: { allowed: true, used: 1, limit: 30 }, error: null })
        : base.rpc(name, params),
  } as unknown as SupabaseClient;
}

async function myDay(w: World, date = TODAY) {
  const logs: DayLog[] = [];
  const h = createHandler({
    verifyToken: (t) => Promise.resolve(t === "tok" ? "user-a" : null),
    clientFor: () => proClient(w),
    llm: () => {
      throw new Error("My day never calls a model");
    },
    log: (e) => logs.push(e as DayLog),
    now: () => NOW,
  });
  const res = await h(new Request("http://localhost/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer tok" },
    body: JSON.stringify({ mode: "day", date, tz: TZ, ...(date === TODAY ? { now: `${TODAY}T09:00` } : {}), events: [] }),
  }));
  assertEquals(res.status, 200);
  return { plan: (await res.json()).plan as DayPlan, log: logs[0] };
}

const titles = (plan: DayPlan) => ({
  placed: plan.rows.filter((r) => r.kind === "task").map((r) => (r as { title: string }).title),
  notPlaced: plan.tasks_not_placed.map((t) => t.title),
});

Deno.test("My day: an ended day is settled as chosen and written once, with a revision; no choice: left open", async () => {
  const w = new World();
  const lunch = task(w, 1, "Lunch", { planned_at: at(YESTERDAY, "12:03"), day_end: "done" });
  const report = task(w, 2, "Finish the report", { planned_at: at(YESTERDAY, "14:00"), day_end: "next_day" });
  const bank = task(w, 3, "Call the bank", { planned_at: at(YESTERDAY, "15:00"), due_on: "2026-10-20" });
  task(w, 4, "Dentist forms", { planned_at: at("2026-10-12", "10:00") });
  task(w, 5, "Walk", { planned_at: at(TODAY, "17:00"), day_end: "done" });
  const hidden = task(w, 6, "Hidden errand", { planned_at: at(YESTERDAY, "09:00"), day_end: "done" }, IDS.private);

  const { plan, log } = await myDay(w);
  const { placed, notPlaced } = titles(plan);
  assertEquals(placed, ["Walk"]);
  assert(!notPlaced.includes("Lunch"), "marked done at the end of yesterday");
  assert(!notPlaced.includes("Dentist forms"), "a time on a later day belongs to that day");
  assert(!notPlaced.includes("Hidden errand"), "restricted spaces never add to the plan");
  const moved = plan.tasks_not_placed.find((t) => t.title === "Finish the report")!;
  assertEquals(moved.due_on, TODAY);
  assertEquals(moved.left_from, undefined, "moved as chosen: nothing to ask");
  const left = plan.tasks_not_placed.find((t) => t.title === "Call the bank")!;
  assertEquals({ left_from: left.left_from, planned_time: left.planned_time }, { left_from: YESTERDAY, planned_time: "15:00" });

  assertEquals(lunch.metadata.status, "done");
  assertEquals(lunch.metadata.done_at, "2026-10-09T23:59:00-04:00");
  assertEquals(lunch.revisions, 1, "the old version kept (rule 7)");
  assertEquals(report.metadata.planned_at, undefined);
  assertEquals(report.metadata.due_on, TODAY);
  assertEquals(report.revisions, 1);
  assertEquals(bank.revisions, 0, "no choice: nothing written");
  assertEquals(bank.metadata.planned_at, at(YESTERDAY, "15:00"));
  assertEquals(hidden.revisions, 0, "a restricted space's task is never read, so never written");
  assertEquals(log.settled, 2);

  // The next plan finds nothing left to write.
  const again = await myDay(w);
  assertEquals(lunch.revisions, 1);
  assertEquals(report.revisions, 1);
  assertEquals(again.log.settled, undefined);
});

Deno.test("My day: at most a few written per plan; the rest are planned as of now and written next time", async () => {
  const w = new World();
  const all = Array.from({ length: MAX_SETTLES_PER_PLAN + 2 }, (_, n) =>
    task(w, 10 + n, `Errand ${n}`, { planned_at: at(YESTERDAY, "10:00"), day_end: "done" }));
  const first = await myDay(w);
  assertEquals(first.log.settled, MAX_SETTLES_PER_PLAN);
  assertEquals(first.plan.tasks_not_placed, [], "none shown as open, written or not");
  assertEquals(all.filter((t) => t.metadata.status === "done").length, MAX_SETTLES_PER_PLAN);
  await myDay(w);
  assertEquals(all.filter((t) => t.metadata.status === "done").length, all.length);
});

Deno.test("My day: yesterday's own plan still shows a left-open task at its time; an earlier day never does", async () => {
  const w = new World();
  task(w, 1, "Call the bank", { planned_at: at(YESTERDAY, "15:00") });
  assertEquals(titles((await myDay(w, YESTERDAY)).plan).placed, ["Call the bank"]);
  const before = titles((await myDay(w, "2026-10-08")).plan);
  assertEquals([...before.placed, ...before.notPlaced], []);
});

Deno.test("the chat's plan for the model leaves out left_from and planned_time (Wilma's input unchanged)", () => {
  const plan: DayPlan = {
    date: TODAY, time_zone: TZ, home: { set: false }, drive_times: "unavailable", weather: "unavailable", weather_at: [],
    credits: [], rows: [], all_day: [],
    tasks_not_placed: [{ id: id(1), title: "Call the bank", priority: "normal", left_from: YESTERDAY, planned_time: "15:00" }],
  } as unknown as DayPlan;
  const out = planForModel(plan, new Map());
  assertEquals(out.tasks_not_placed, [{ title: "Call the bank", priority: "normal" }]);
});

// ---- find_tasks --------------------------------------------------------------------------------

async function findTasks(w: World, args: Record<string, unknown>) {
  const server = new McpServer({ name: "t", version: "0" });
  for (const r of ALL_TOOLS) r(server, { db: w.client(), userId: "u", accessToken: "t", assistantName: "Wilma", timeZone: TZ, log: () => {} });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_tasks", arguments: args } }),
  }));
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}

Deno.test("find_tasks shows an ended day as chosen, and writes nothing (it is read-only)", async () => {
  const w = new World();
  const lunch = task(w, 1, "Lunch", { planned_at: at(YESTERDAY, "12:03"), day_end: "done" });
  const report = task(w, 2, "Finish the report", { planned_at: at(YESTERDAY, "14:00"), day_end: "next_day" });
  const open = await findTasks(w, { today: TODAY });
  assertEquals(open.tasks.map((t: { title: string }) => t.title), ["Finish the report"]);
  assertEquals(open.tasks[0].due_on, TODAY);
  assertEquals(open.tasks[0].planned_at, undefined);
  const done = await findTasks(w, { status: "done", today: TODAY });
  assertEquals(done.tasks.map((t: { title: string }) => t.title), ["Lunch"]);
  assertEquals(lunch.revisions + report.revisions, 0);
  assertEquals(lunch.metadata.status, "open", "the stored task is written by My day, not here");
});
