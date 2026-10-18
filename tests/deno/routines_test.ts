// Routines (docs/routines-plan.md step 1, D39): the schedule's periods worked out in code, a
// routine's tasks given their window, done moving them to the next period, a missed one passed by
// (Q6), and the tools: save_item keeps a routine in Tasks and checks a task's routine is the user's
// own, update_item brings tasks in step (a revision each, rule 7), find_tasks shows the window and
// never calls a task in its window overdue.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  normalizeRoutine,
  periodAfter,
  periodOn,
  type RoutineMetadata,
  routineTaskDone,
  routineWords,
  settleRoutineTask,
  withRoutine,
} from "../../supabase/functions/mcp/lib/routines.ts";
import { sameFields, userToday } from "../../supabase/functions/mcp/lib/routine_tasks.ts";
import { normalizeTask, TaskError } from "../../supabase/functions/mcp/lib/tasks.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, World } from "../eval/world.ts";

const R = (m: Record<string, unknown>, today = "2026-10-01") => normalizeRoutine(m, today);
const RID = "00000000-0000-4000-8000-00000000c001";

// ---- the routine's fields -----------------------------------------------------------------------

Deno.test("normalizeRoutine: defaults, tidying and the two weekly kinds (Q1)", () => {
  assertEquals(R({ repeat: "Weekly" }), { repeat: "weekly", when: "any_day", starts_on: "2026-10-01", suggest: true });
  assertEquals(R({ repeat: "weekly", when: "same_day", day: 6, suggest: false, starts_on: "2026-09-05" }), {
    repeat: "weekly", when: "same_day", day: 6, starts_on: "2026-09-05", suggest: false,
  });
  assertEquals(R({ repeat: "monthly", when: "by_day", day: "28" }).day, 28);
  for (const bad of [
    {},
    { repeat: "daily" },
    { repeat: "weekly", when: "sometimes" },
    { repeat: "weekly", when: "same_day" },
    { repeat: "weekly", when: "same_day", day: 7 },
    { repeat: "weekly", when: "by_day", day: 3 },
    { repeat: "monthly", when: "same_day", day: 3 },
    { repeat: "monthly", when: "by_day", day: 32 },
    { repeat: "monthly", day: 5 },
    { repeat: "weekly", suggest: "yes" },
    { repeat: "weekly", colour: "red" },
    { repeat: "weekly", starts_on: "Saturday" },
  ]) {
    assertThrows(() => R(bad), TaskError, "Routine not saved", JSON.stringify(bad));
  }
});

Deno.test("routineWords: how a schedule reads", () => {
  assertEquals(routineWords(R({ repeat: "weekly" })), "Any day each week");
  assertEquals(routineWords(R({ repeat: "weekly", when: "same_day", day: 6 })), "Every Saturday");
  assertEquals(routineWords(R({ repeat: "biweekly", when: "same_day", day: 1 })), "Every other Monday");
  assertEquals(routineWords(R({ repeat: "biweekly" })), "Any day each two weeks");
  assertEquals(routineWords(R({ repeat: "monthly" })), "Any day each month");
  assertEquals(routineWords(R({ repeat: "monthly", when: "by_day", day: 1 })), "By the 1st each month");
  assertEquals(routineWords(R({ repeat: "monthly", when: "by_day", day: 22 })), "By the 22nd each month");
  assertEquals(routineWords(R({ repeat: "monthly", when: "by_day", day: 11 })), "By the 11th each month");
});

// ---- periods (2026-10-18 is a Sunday) -----------------------------------------------------------

Deno.test("periods: weekly, any day that week (Sunday to Saturday) or the same day each week", () => {
  const any = R({ repeat: "weekly" });
  assertEquals(periodOn(any, "2026-10-21"), { window_from: "2026-10-18", due_on: "2026-10-24" });
  assertEquals(periodOn(any, "2026-10-18"), { window_from: "2026-10-18", due_on: "2026-10-24" });
  assertEquals(periodAfter(any, periodOn(any, "2026-10-21")), { window_from: "2026-10-25", due_on: "2026-10-31" });
  const sat = R({ repeat: "weekly", when: "same_day", day: 6 });
  assertEquals(periodOn(sat, "2026-10-21"), { window_from: "2026-10-24", due_on: "2026-10-24" });
  assertEquals(periodOn(sat, "2026-10-24"), { window_from: "2026-10-24", due_on: "2026-10-24" });
  assertEquals(periodAfter(sat, periodOn(sat, "2026-10-24")), { window_from: "2026-10-31", due_on: "2026-10-31" });
  const sun = R({ repeat: "weekly", when: "same_day", day: 0 });
  assertEquals(periodOn(sun, "2026-10-19"), { window_from: "2026-10-25", due_on: "2026-10-25" }); // Monday: next Sunday
});

Deno.test("periods: every two weeks keeps its own weeks, counted from the week it starts", () => {
  const any = R({ repeat: "biweekly" }, "2026-10-20"); // starts in the week of Sun Oct 18
  assertEquals(periodOn(any, "2026-10-20"), { window_from: "2026-10-18", due_on: "2026-10-31" });
  assertEquals(periodOn(any, "2026-10-31"), { window_from: "2026-10-18", due_on: "2026-10-31" });
  assertEquals(periodOn(any, "2026-11-01"), { window_from: "2026-11-01", due_on: "2026-11-14" });
  // Before it starts: its first period.
  assertEquals(periodOn(any, "2026-10-01"), { window_from: "2026-10-18", due_on: "2026-10-31" });
  const otherSat = R({ repeat: "biweekly", when: "same_day", day: 6 }, "2026-10-20");
  assertEquals(periodOn(otherSat, "2026-10-20"), { window_from: "2026-10-24", due_on: "2026-10-24" });
  assertEquals(periodOn(otherSat, "2026-10-25"), { window_from: "2026-11-07", due_on: "2026-11-07" }); // not Oct 31
  assertEquals(periodAfter(otherSat, periodOn(otherSat, "2026-10-20")), { window_from: "2026-11-07", due_on: "2026-11-07" });
});

Deno.test("periods: monthly, any day of the month or by a day (the month's last when shorter)", () => {
  const any = R({ repeat: "monthly" });
  assertEquals(periodOn(any, "2026-10-18"), { window_from: "2026-10-01", due_on: "2026-10-31" });
  assertEquals(periodAfter(any, periodOn(any, "2026-10-18")), { window_from: "2026-11-01", due_on: "2026-11-30" });
  assertEquals(periodOn(any, "2027-02-10"), { window_from: "2027-02-01", due_on: "2027-02-28" });
  const by28 = R({ repeat: "monthly", when: "by_day", day: 28 });
  assertEquals(periodOn(by28, "2026-10-18"), { window_from: "2026-10-01", due_on: "2026-10-28" });
  assertEquals(periodOn(by28, "2026-10-29"), { window_from: "2026-11-01", due_on: "2026-11-28" }); // passed: next month
  const by31 = R({ repeat: "monthly", when: "by_day", day: 31 });
  assertEquals(periodOn(by31, "2027-02-03"), { window_from: "2027-02-01", due_on: "2027-02-28" });
  assertEquals(periodAfter(by31, periodOn(by31, "2027-02-03")), { window_from: "2027-03-01", due_on: "2027-03-31" });
  assertEquals(periodAfter(by31, periodOn(by31, "2026-12-03")), { window_from: "2027-01-01", due_on: "2027-01-31" }); // over the year
});

// ---- a routine's tasks --------------------------------------------------------------------------

const MONTHLY: RoutineMetadata = R({ repeat: "monthly" });
const base = normalizeTask({ duration_min: 30, planned_at: "2026-10-18T09:00:00-04:00" });

Deno.test("withRoutine: the task gets the routine's repeat and the period it is in", () => {
  const t = withRoutine(base, RID, MONTHLY, "2026-10-18");
  assertEquals(t.routine_id, RID);
  assertEquals(t.repeat, "monthly");
  assertEquals([t.window_from, t.due_on, t.status], ["2026-10-01", "2026-10-31", "open"]);
  assertEquals(t.planned_at, "2026-10-18T09:00:00-04:00"); // a time the user picked stays
  // Done already this month (a schedule change): it waits for November.
  const done = withRoutine({ ...base, repeat: "monthly", due_on: "2026-11-30", last_done_on: "2026-10-05" }, RID, MONTHLY, "2026-10-18");
  assertEquals([done.window_from, done.due_on], ["2026-11-01", "2026-11-30"]);
});

Deno.test("routineTaskDone: the next period, done early or late; the time and missed day cleared", () => {
  const t = withRoutine(base, RID, MONTHLY, "2026-10-18");
  const done = routineTaskDone(t, MONTHLY, "2026-10-18");
  assertEquals([done.status, done.window_from, done.due_on, done.last_done_on], ["open", "2026-11-01", "2026-11-30", "2026-10-18"]);
  assertEquals(done.planned_at, undefined);
  // Done after its month ended (not yet moved on): it counts for this month.
  const late = routineTaskDone({ ...t, missed_on: "2026-09-30" }, MONTHLY, "2026-11-03");
  assertEquals([late.window_from, late.due_on, late.missed_on], ["2026-12-01", "2026-12-31", undefined]);
  const sat = R({ repeat: "weekly", when: "same_day", day: 6 });
  const s = withRoutine(normalizeTask({}), RID, sat, "2026-10-21");
  assertEquals(routineTaskDone(s, sat, "2026-10-24").due_on, "2026-10-31");
});

Deno.test("settleRoutineTask: missed, it moves to the period today is in and keeps missed_on (Q6)", () => {
  const t = withRoutine(base, RID, MONTHLY, "2026-10-18");
  assertEquals(settleRoutineTask(t, MONTHLY, "2026-10-31"), { task: t, missed: false });
  const { task, missed } = settleRoutineTask(t, MONTHLY, "2026-11-02");
  assert(missed);
  assertEquals([task.window_from, task.due_on, task.missed_on, task.planned_at], ["2026-11-01", "2026-11-30", "2026-10-31", undefined]);
  // Not carried over: one task, the next period, no overdue pile.
  const weekly = R({ repeat: "weekly" });
  const w = withRoutine(normalizeTask({}), RID, weekly, "2026-10-01"); // Sep 27 to Oct 3
  assertEquals(settleRoutineTask(w, weekly, "2026-10-21").task.due_on, "2026-10-24");
});

Deno.test("normalizeTask: window_from and missed_on belong to a routine's task, in order", () => {
  for (const bad of [
    { window_from: "2026-10-01" },
    { missed_on: "2026-10-01" },
    { routine_id: "Weekend", repeat: "weekly" },
    { routine_id: RID, repeat: "monthly", due_on: "2026-10-01", window_from: "2026-10-31" },
  ]) {
    assertThrows(() => normalizeTask(bad), TaskError, "Task not saved", JSON.stringify(bad));
  }
  assertEquals(normalizeTask({ routine_id: RID.toUpperCase(), repeat: "monthly", due_on: "2026-10-31", window_from: "2026-10-01" }).routine_id, RID);
});

Deno.test("userToday and sameFields", () => {
  assertEquals(userToday("2026-10-18", "America/New_York"), "2026-10-18");
  assertEquals(userToday(undefined, "America/New_York", Date.parse("2026-10-19T02:00:00Z")), "2026-10-18");
  assertEquals(userToday(undefined, undefined, Date.parse("2026-10-19T02:00:00Z")), "2026-10-19");
  assert(sameFields({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert(!sameFields({ a: 1 }, { a: 2 }));
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

const today = () => userToday(undefined, undefined);
const routine = (title: string, metadata: Record<string, unknown>, space?: string) =>
  ({ title, body: "", item_type: "routine", metadata, ...(space ? { space } : {}) });

Deno.test("save_item: a routine goes to Tasks (never another space); its task gets the routine's dates", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Car and home checks", { repeat: "monthly" }));
  assertEquals(r.isError, false, r.text);
  assertEquals(r.json.space, "Tasks");
  assertEquals(r.json.routine.schedule, "Any day each month");
  const elsewhere = await call(w, "save_item", routine("Work prep", { repeat: "weekly" }, "Work"));
  assertEquals(elsewhere.isError, true);
  assert(elsewhere.text.includes("kept in the Tasks space"), elsewhere.text);
  const bad = await call(w, "save_item", routine("Odd", { repeat: "daily" }));
  assertEquals(bad.isError, true);

  const t = await call(w, "save_item", { title: "Wash the car", body: "", item_type: "task", metadata: { routine_id: r.json.id, duration_min: 45 } });
  assertEquals(t.isError, false, t.text);
  const p = periodOn(normalizeRoutine({ repeat: "monthly" }, today()), today());
  assertEquals([t.json.task.repeat, t.json.task.window_from, t.json.task.due_on], ["monthly", p.window_from, p.due_on]);
  assertEquals(t.json.space, "Tasks");
});

Deno.test("save_item: routine_id must be one of the user's routines (a note, a missing id, a binned one)", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Weekend reset", { repeat: "weekly" }));
  await call(w, "delete_item", { item_id: r.json.id });
  for (const id of [IDS.sourdough, "00000000-0000-4000-8000-00000000ffff", r.json.id]) {
    const out = await call(w, "save_item", { title: "Vacuum", body: "", item_type: "task", metadata: { routine_id: id } });
    assertEquals(out.isError, true, id);
    assert(out.text.includes("not one of your routines"), out.text);
  }
  assertEquals(w.items.filter((i) => i.item_type === "task").length, 0);
});

Deno.test("save_item: a credential in a routine or its task is refused (rule 9)", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Wi-Fi password is hunter2rocks!", { repeat: "weekly" }));
  assertEquals(r.isError, true);
  assertEquals(w.items.filter((i) => i.item_type === "routine").length, 0);
});

Deno.test("update_item: a schedule change brings the routine's tasks in step, each with a revision", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Weekend reset", { repeat: "weekly" }));
  const ids: string[] = [];
  for (const title of ["Laundry", "Vacuum"]) {
    ids.push((await call(w, "save_item", { title, body: "", item_type: "task", metadata: { routine_id: r.json.id } })).json.id);
  }
  const before = ids.map((id) => w.items.find((i) => i.id === id)!.revisions);
  const up = await call(w, "update_item", { item_id: r.json.id, metadata: { repeat: "monthly" } });
  assertEquals(up.isError, false, up.text);
  assertEquals(up.json.tasks_in_step, 2);
  const p = periodOn(normalizeRoutine({ repeat: "monthly" }, today()), today());
  for (const [k, id] of ids.entries()) {
    const m = w.items.find((i) => i.id === id)!;
    assertEquals([m.metadata.repeat, m.metadata.window_from, m.metadata.due_on], ["monthly", p.window_from, p.due_on]);
    assertEquals(m.revisions, before[k] + 1);
    assert(m.body_markdown === "", "the task's own text is not touched");
  }
  // Nothing to change: no new revisions.
  const again = await call(w, "update_item", { item_id: r.json.id, metadata: { repeat: "monthly" } });
  assertEquals(again.json.tasks_in_step, 0);
  // A new schedule without starts_on keeps the routine's own (every two weeks keeps its weeks).
  const started = w.items.find((i) => i.id === r.json.id)!;
  started.metadata = { ...started.metadata, starts_on: "2026-01-04" };
  await call(w, "update_item", { item_id: r.json.id, metadata: { repeat: "biweekly" } });
  assertEquals(w.items.find((i) => i.id === r.json.id)!.metadata.starts_on, "2026-01-04");
  // A routine stays in Tasks.
  const moved = await call(w, "update_item", { item_id: r.json.id, space: "Work" });
  assertEquals(moved.isError, true);
});

Deno.test("update_item: ticking a routine's task moves it to the next period; its routine gone, a plain repeat", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Checks", { repeat: "monthly" }));
  const t = await call(w, "save_item", { title: "Smoke alarms", body: "", item_type: "task", metadata: { routine_id: r.json.id } });
  const day = today();
  const rm = normalizeRoutine({ repeat: "monthly" }, day);
  const done = await call(w, "update_item", { item_id: t.json.id, task_done: true, today: day });
  assertEquals(done.isError, false, done.text);
  const next = periodAfter(rm, periodOn(rm, day));
  assertEquals([done.json.task.status, done.json.task.window_from, done.json.task.due_on, done.json.task.last_done_on], [
    "open", next.window_from, next.due_on, day,
  ]);
  // The routine binned (taking the task), then the task brought back on its own: a plain repeat.
  await call(w, "delete_item", { item_id: r.json.id });
  await call(w, "restore_item", { item_id: t.json.id });
  const plain = await call(w, "update_item", { item_id: t.json.id, task_done: true, today: day });
  assertEquals(plain.isError, false, plain.text);
  assertEquals(plain.json.task.status, "open");
  // Pointing a task at a routine that is not the user's is refused.
  const other = await call(w, "update_item", { item_id: t.json.id, metadata: { routine_id: IDS.sourdough } });
  assertEquals(other.isError, true);
});

Deno.test("find_tasks: a routine's task shows its routine and window, is never overdue inside it, and a missed one moves on", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Checks", { repeat: "monthly" }));
  const t = await call(w, "save_item", { title: "Wash the car", body: "", item_type: "task", metadata: { routine_id: r.json.id } });
  const day = today();
  const out = await call(w, "find_tasks", { today: day, due_by: day });
  assertEquals(out.isError, false, out.text);
  const row = out.json.tasks.find((x: { id: string }) => x.id === t.json.id);
  assert(row, "a task in its window counts for today");
  assertEquals(row.routine, { id: r.json.id, title: "Checks" });
  assertEquals(row.overdue, undefined);
  assertEquals(typeof row.window_from, "string");
  // Missed last month: shown in this month, with missed_on; read-only, nothing written.
  const item = w.items.find((i) => i.id === t.json.id)!;
  item.metadata = { ...item.metadata, window_from: "2020-01-01", due_on: "2020-01-31" };
  const revisions = item.revisions;
  const later = await call(w, "find_tasks", { today: day });
  const moved = later.json.tasks.find((x: { id: string }) => x.id === t.json.id);
  assertEquals(moved.missed_on, "2020-01-31");
  assert(moved.due_on >= day, moved.due_on);
  assertEquals(moved.overdue, undefined);
  assertEquals(item.revisions, revisions);
});

Deno.test("delete_item / restore_item / purge_item: a routine takes its tasks with it (Q8), only those binned with it", async () => {
  const w = new World();
  const r = await call(w, "save_item", routine("Weekend reset", { repeat: "weekly" }));
  const ids: string[] = [];
  for (const title of ["Laundry", "Vacuum", "Old one"]) {
    ids.push((await call(w, "save_item", { title, body: "", item_type: "task", metadata: { routine_id: r.json.id } })).json.id);
  }
  const other = await call(w, "save_item", { title: "Call the bank", body: "", item_type: "task", metadata: {} });
  await call(w, "delete_item", { item_id: ids[2] }); // binned on its own first
  await new Promise((res) => setTimeout(res, 5)); // a later moment
  const del = await call(w, "delete_item", { item_id: r.json.id });
  assertEquals(del.json.tasks, 2);
  const live = () => new Set(w.liveItems().map((i) => i.id));
  assert(![r.json.id, ids[0], ids[1]].some((id) => live().has(id)));
  assert(live().has(other.json.id));
  const back = await call(w, "restore_item", { item_id: r.json.id });
  assertEquals(back.json.tasks, 2);
  assert([r.json.id, ids[0], ids[1]].every((id) => live().has(id)));
  assert(!live().has(ids[2]), "the one binned on its own stays in the bin");
  await call(w, "delete_item", { item_id: r.json.id });
  const gone = await call(w, "purge_item", { item_id: r.json.id });
  assertEquals(gone.json.tasks, 2);
  assertEquals(w.items.filter((i) => [r.json.id, ids[0], ids[1]].includes(i.id)).length, 0);
  assertEquals(w.items.filter((i) => i.id === ids[2]).length, 1);
});
