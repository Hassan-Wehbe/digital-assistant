// Wilma tasks (docs/phase6-day-planner-step2-plan.md, step 1): normalizeTask checks the fields,
// save_item puts a task in the Tasks space (made on the first task) and refuses a credential (rule 9)
// or a place the user cannot see, update_item marks it done keeping a revision (rule 7), and
// find_tasks lists open tasks, overdue first, never from a restricted space (rule 3).
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { nextDue, normalizeTask, setTaskDone, TaskError, taskText } from "../../supabase/functions/mcp/lib/tasks.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, World } from "../eval/world.ts";

const NOW = new Date("2026-10-09T15:00:00Z");

// ---- normalizeTask -----------------------------------------------------------------------------

Deno.test("normalizeTask: a new task is open and normal; fields are tidied", () => {
  assertEquals(normalizeTask({}, NOW), { status: "open", priority: "normal" });
  assertEquals(
    normalizeTask({ due_on: "2026-10-11", duration_min: "20", priority: "Important", address: "  12  Main St ", duration_estimated: true }, NOW),
    { status: "open", priority: "important", due_on: "2026-10-11", duration_min: 20, duration_estimated: true, address: "12 Main St" },
  );
  assertEquals(normalizeTask({ place_id: IDS.tawlet.toUpperCase() }, NOW).place_id, IDS.tawlet);
  assertEquals(normalizeTask({ planned_at: "2026-10-09T17:05:00-04:00" }, NOW).planned_at, "2026-10-09T17:05:00-04:00");
});

Deno.test("normalizeTask: done stamps done_at; unknown or wrong fields are refused with a reason", () => {
  assertEquals(normalizeTask({ status: "done" }, NOW).done_at, NOW.toISOString());
  assertEquals(normalizeTask({ status: "done", done_at: "2026-10-08T09:00:00Z" }, NOW).done_at, "2026-10-08T09:00:00Z");
  assertEquals(normalizeTask({ status: "open", done_at: "2026-10-08T09:00:00Z" }, NOW).done_at, undefined);
  for (const bad of [
    { colour: "red" },
    { status: "later" },
    { priority: "urgent" },
    { due_on: "Saturday" },
    { due_on: "2026-02-30" },
    { due_on: "2200-01-01" },
    { duration_min: 2 },
    { duration_min: 600 },
    { duration_min: 12.5 },
    { duration_estimated: true },
    { place_id: "Tawlet" },
    { place_id: IDS.tawlet, address: "Mar Mikhael" },
    { address: "x".repeat(301) },
    { planned_at: "5:05 pm" },
    { planned_at: "2026-10-09T17:05:00" },
  ]) {
    assertThrows(() => normalizeTask(bad as Record<string, unknown>, NOW), TaskError, "Task not saved", JSON.stringify(bad));
  }
});

Deno.test("normalizeTask: a local planned_at gets the phone's offset for that day; without a zone it is refused", () => {
  // The owner's "lunch at Craft & Commons tomorrow at 12:30" (versionCode 15 phone test): Wilma
  // writes the local time; the server knows the offset, daylight saving included.
  const NY = "America/New_York";
  assertEquals(normalizeTask({ planned_at: "2026-10-10T12:30" }, NOW, NY).planned_at, "2026-10-10T12:30:00-04:00");
  assertEquals(normalizeTask({ planned_at: "2026-11-02T12:30" }, NOW, NY).planned_at, "2026-11-02T12:30:00-05:00"); // after clocks go back
  assertEquals(normalizeTask({ planned_at: "2026-10-10T12:30" }, NOW, "Asia/Kolkata").planned_at, "2026-10-10T12:30:00+05:30");
  assertEquals(normalizeTask({ planned_at: "2026-10-10T12:30" }, NOW, "UTC").planned_at, "2026-10-10T12:30:00+00:00");
  // A moment with its offset is kept as given, zone or not.
  assertEquals(normalizeTask({ planned_at: "2026-10-09T17:05:00-04:00" }, NOW, NY).planned_at, "2026-10-09T17:05:00-04:00");
  assertThrows(() => normalizeTask({ planned_at: "2026-10-10T12:30" }, NOW), TaskError, "with its offset");
  assertThrows(() => normalizeTask({ planned_at: "2026-02-30T12:30" }, NOW, NY), TaskError, "not a real date");
  assertThrows(() => normalizeTask({ planned_at: "2026-10-10T24:30" }, NOW, NY), TaskError, "Task not saved");
});

Deno.test("setTaskDone: done now or open again, the rest kept", () => {
  const t = { due_on: "2026-10-09", duration_min: 20, priority: "important" as const };
  assertEquals(setTaskDone(t, true, NOW), { ...t, status: "done", done_at: NOW.toISOString() });
  assertEquals(setTaskDone({ ...t, status: "done", done_at: "2026-10-08T09:00:00Z" }, false, NOW), { ...t, status: "open" });
});

Deno.test("taskText: the fields meaning search reads", () => {
  assertEquals(
    taskText({ status: "open", priority: "important", due_on: "2026-10-11", duration_min: 20, duration_estimated: true, address: "12 Main St" }),
    "Task: to do\nImportant\nDue: 2026-10-11\nTakes about 20 min\nWhere: 12 Main St",
  );
});

// ---- The tools on the pretend account (tests/eval/world.ts) --------------------------------------

async function call(w: World, name: string, args: Record<string, unknown>, timeZone?: string) {
  const server = new McpServer({ name: "test", version: "0" });
  for (const r of ALL_TOOLS) r(server, { db: w.client(), userId: "u", accessToken: "t", assistantName: "Wilma", timeZone, log: () => {} });
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

const task = (title: string, metadata: Record<string, unknown>, space?: string) =>
  ({ title, body: "", item_type: "task", metadata, ...(space ? { space } : {}) });

Deno.test("save_item: the first task makes the Tasks space; later ones reuse it", async () => {
  const w = new World();
  const first = await call(w, "save_item", task("Pick up dry cleaning", { due_on: "2026-10-09", duration_min: 20 }));
  assertEquals(first.isError, false, first.text);
  assertEquals(first.json.space, "Tasks");
  assertEquals(first.json.created_space, "Tasks");
  assertEquals(first.json.task, { status: "open", priority: "normal", due_on: "2026-10-09", duration_min: 20 });
  const second = await call(w, "save_item", task("Call the insurance", {}, "Tasks"));
  assertEquals(second.isError, false, second.text);
  assertEquals(second.json.created_space, undefined);
  assertEquals(w.spaces.filter((s) => s.name === "Tasks").length, 1);
  const saved = w.items.find((i) => i.id === first.json.id)!;
  assertEquals(saved.item_type, "task");
  assertEquals(saved.metadata.duration_min, 20);
  // A task can still go in a space the user names.
  const work = await call(w, "save_item", task("Send the slides", {}, "Work"));
  assertEquals(work.json.space, "Work");
  // Anything else still needs a space.
  const note = await call(w, "save_item", { title: "A note", body: "x", item_type: "note" });
  assertEquals(note.isError, true);
  assert(note.text.includes("which space"), note.text);
});

Deno.test("save_item / update_item: a time said in the app's chat is kept with the phone's offset", async () => {
  const w = new World();
  const saved = await call(w, "save_item", task("Lunch at Craft & Commons", { due_on: "2026-10-10", duration_min: 60, planned_at: "2026-10-10T12:30" }), "America/New_York");
  assertEquals(saved.isError, false, saved.text);
  assertEquals(saved.json.task.planned_at, "2026-10-10T12:30:00-04:00");
  const moved = await call(w, "update_item", {
    item_id: saved.json.id, metadata: { due_on: "2026-10-10", duration_min: 60, planned_at: "2026-10-10T13:00" },
  }, "America/New_York");
  assertEquals(moved.isError, false, moved.text);
  assertEquals(w.items.find((i) => i.id === saved.json.id)!.metadata.planned_at, "2026-10-10T13:00:00-04:00");
  // The Claude app's connector sends no zone: the model is told to give the offset.
  const bare = await call(w, "save_item", task("Call the bank", { planned_at: "2026-10-10T15:00" }));
  assertEquals(bare.isError, true);
  assert(bare.text.includes("with its offset"), bare.text);
});

Deno.test("save_item: a task never takes a password (rule 9) and is never put in a restricted Tasks space", async () => {
  const w = new World();
  const pw = await call(w, "save_item", task("Change the router password to Hunter2!x9", {}));
  assertEquals(pw.isError, true);
  assert(pw.text.toLowerCase().includes("vault"), pw.text);
  assertEquals(w.items.filter((i) => i.item_type === "task").length, 0);

  w.spaces.push({ id: w.newId(), name: "Tasks", description: null, parent_id: null, is_restricted: true });
  const out = await call(w, "save_item", task("Buy goggles", {}));
  assertEquals(out.isError, true);
  assert(out.text.includes("restricted"), out.text);
});

Deno.test("save_item: a task's place must be the user's own visible saved place", async () => {
  const w = new World();
  const ok = await call(w, "save_item", task("Book a table", { place_id: IDS.tawlet }));
  assertEquals(ok.isError, false, ok.text);
  assertEquals(ok.json.task.place, "Tawlet");
  for (const id of [IDS.hiddenBar, IDS.sourdough, "00000000-0000-4000-8000-00000000ffff"]) {
    const out = await call(w, "save_item", task("Go there", { place_id: id }));
    assertEquals(out.isError, true, id);
    assert(!out.text.includes("Hidden courtyard"), out.text);
  }
});

Deno.test("update_item: task_done marks it done, keeps the rest and a revision (rule 7)", async () => {
  const w = new World();
  const saved = await call(w, "save_item", task("Pick up dry cleaning", { due_on: "2026-10-09", duration_min: 20, priority: "important" }));
  const id = saved.json.id;
  const done = await call(w, "update_item", { item_id: id, task_done: true });
  assertEquals(done.isError, false, done.text);
  const item = w.items.find((i) => i.id === id)!;
  assertEquals(item.metadata.status, "done");
  assertEquals(item.metadata.duration_min, 20);
  assertEquals(item.metadata.priority, "important");
  assert(typeof item.metadata.done_at === "string");
  assertEquals(item.revisions, 1);
  const again = await call(w, "update_item", { item_id: id, task_done: false });
  assertEquals(again.isError, false, again.text);
  assertEquals(item.metadata.status, "open");
  assertEquals(item.metadata.done_at, undefined);

  const notTask = await call(w, "update_item", { item_id: IDS.sourdough, task_done: true });
  assertEquals(notTask.isError, true);
  const badField = await call(w, "update_item", { item_id: id, metadata: { due_on: "soon" } });
  assertEquals(badField.isError, true);
  assertEquals(item.metadata.status, "open", "a refused change leaves the task as it was");
});

Deno.test("find_tasks: open ones, overdue first, important first on a day, undated last", async () => {
  const w = new World();
  for (const [title, m] of [
    ["Return library books", { due_on: "2026-10-11", duration_min: 15 }],
    ["Pay the water bill", { due_on: "2026-10-07" }],
    ["Pick up dry cleaning", { due_on: "2026-10-09", duration_min: 20 }],
    ["Renew passport", { due_on: "2026-10-09", priority: "important" }],
    ["Call the insurance", {}],
    ["Buy swim goggles", { status: "done" }],
    ["Plan the trip", { due_on: "2026-11-20" }],
  ] as [string, Record<string, unknown>][]) {
    const out = await call(w, "save_item", task(title, m));
    assertEquals(out.isError, false, out.text);
  }
  const today = await call(w, "find_tasks", { due_by: "2026-10-09", today: "2026-10-09" });
  assertEquals(today.isError, false, today.text);
  assertEquals(today.json.tasks.map((t: { title: string }) => t.title), [
    "Pay the water bill", "Renew passport", "Pick up dry cleaning", "Call the insurance",
  ]);
  assertEquals(today.json.tasks[0].overdue, true);
  assertEquals(today.json.summary, "4 open tasks due by 2026-10-09 or with no date, 1 overdue.");

  const datedOnly = await call(w, "find_tasks", { due_by: "2026-10-09", include_undated: false });
  assertEquals(datedOnly.json.count, 3);
  const all = await call(w, "find_tasks", {});
  assertEquals(all.json.count, 6);
  const done = await call(w, "find_tasks", { status: "done" });
  assertEquals(done.json.tasks.map((t: { title: string }) => t.title), ["Buy swim goggles"]);
  const bad = await call(w, "find_tasks", { due_by: "Friday" });
  assertEquals(bad.isError, true);
});

Deno.test("find_tasks: never a task in a restricted space, nor its restricted place (rule 3)", async () => {
  const w = new World();
  await call(w, "save_item", task("Visible task", { place_id: IDS.tawlet }));
  // Tasks the user keeps in a restricted space, written straight to the pretend database.
  w.items.push({
    id: w.newId(), space_id: IDS.private, title: "Meet the lawyer", item_type: "task", summary: null,
    body_markdown: "", metadata: { status: "open", priority: "normal", due_on: "2026-10-09" }, tags: [],
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, revisions: 0,
  });
  // A visible task pointing at a place that is now restricted: the task shows, the place does not.
  w.items.push({
    id: w.newId(), space_id: IDS.home, title: "Drinks", item_type: "task", summary: null,
    body_markdown: "", metadata: { status: "open", priority: "normal", place_id: IDS.hiddenBar }, tags: [],
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, revisions: 0,
  });
  for (const args of [{}, { space: "Private" }, { status: "all" }]) {
    const out = await call(w, "find_tasks", args);
    assert(!out.text.includes("lawyer"), out.text);
    assert(!out.text.includes("Hidden courtyard") && !out.text.includes(IDS.hiddenBar), out.text);
  }
  const out = await call(w, "find_tasks", {});
  assertEquals(out.json.tasks.map((t: { title: string }) => t.title).sort(), ["Drinks", "Visible task"]);
  assertEquals(out.json.tasks.find((t: { title: string }) => t.title === "Visible task").place.title, "Tawlet");
});

// ---- Repeating tasks (owner, 2026-10-08) -------------------------------------------------------

Deno.test("repeat: one time by default; daily, weekdays, weekly, biweekly, monthly; starts today without a date", () => {
  assertEquals(normalizeTask({ due_on: "2026-10-09" }, NOW).repeat, undefined);
  assertEquals(normalizeTask({ repeat: "none", due_on: "2026-10-09" }, NOW).repeat, undefined);
  assertEquals(normalizeTask({ repeat: "Weekly", due_on: "2026-10-12" }, NOW), {
    status: "open", priority: "normal", due_on: "2026-10-12", repeat: "weekly",
  });
  assertEquals(normalizeTask({ repeat: "daily" }, NOW).due_on, "2026-10-09");
  for (const bad of [{ repeat: "yearly" }, { repeat: "weekly", status: "done" }, { last_done_on: "2026-10-01" }]) {
    assertThrows(() => normalizeTask(bad as Record<string, unknown>, NOW), TaskError, "Task not saved", JSON.stringify(bad));
  }
});

Deno.test("nextDue: the next date each repeat comes back", () => {
  assertEquals(nextDue("2026-10-09", "daily"), "2026-10-10");
  assertEquals(nextDue("2026-10-09", "weekdays"), "2026-10-12", "Friday to Monday");
  assertEquals(nextDue("2026-10-10", "weekdays"), "2026-10-12", "Saturday to Monday");
  assertEquals(nextDue("2026-10-12", "weekdays"), "2026-10-13");
  assertEquals(nextDue("2026-10-09", "weekly"), "2026-10-16");
  assertEquals(nextDue("2026-10-09", "biweekly"), "2026-10-23");
  assertEquals(nextDue("2026-01-31", "monthly"), "2026-02-28", "the month's last day");
  assertEquals(nextDue("2026-12-15", "monthly"), "2027-01-15");
});

Deno.test("setTaskDone on a repeating task: stays open, moves to the next date after today, notes the day", () => {
  const swimKit = { repeat: "weekly", due_on: "2026-10-09", duration_min: 10, planned_at: "2026-10-09T15:30:00-04:00" };
  assertEquals(setTaskDone(swimKit, true, NOW, "2026-10-09"), {
    status: "open", priority: "normal", due_on: "2026-10-16", duration_min: 10, repeat: "weekly", last_done_on: "2026-10-09",
  });
  // Overdue by three weeks: the next date is still after today, not in the past.
  assertEquals(setTaskDone({ repeat: "weekly", due_on: "2026-09-18" }, true, NOW, "2026-10-09").due_on, "2026-10-16");
  // Done early (on Wednesday for Friday): the Friday after.
  assertEquals(setTaskDone({ repeat: "weekly", due_on: "2026-10-09" }, true, NOW, "2026-10-07").due_on, "2026-10-16");
});

Deno.test("update_item task_done on a repeating task keeps it open with its next date", async () => {
  const w = new World();
  const saved = await call(w, "save_item", task("Water the plants", { repeat: "daily", due_on: "2020-01-01" }));
  assertEquals(saved.isError, false, saved.text);
  const done = await call(w, "update_item", { item_id: saved.json.id, task_done: true });
  assertEquals(done.isError, false, done.text);
  const m = w.items.find((i) => i.id === saved.json.id)!.metadata;
  assertEquals(m.status, "open");
  assert(typeof m.due_on === "string" && m.due_on > new Date().toISOString().slice(0, 10), String(m.due_on));
  assertEquals(m.repeat, "daily");
  const listed = await call(w, "find_tasks", {});
  assertEquals(listed.json.tasks[0].repeat, "daily");
});

Deno.test("update_item task_done uses the phone's date for a repeating task (Q12)", async () => {
  const w = new World();
  // Ticked on the evening of Oct 9 in Florida: already Oct 10 in UTC, but the next date is Oct 10.
  const saved = await call(w, "save_item", task("Water the plants", { repeat: "daily", due_on: "2026-10-09" }));
  const done = await call(w, "update_item", { item_id: saved.json.id, task_done: true, today: "2026-10-09" });
  assertEquals(done.isError, false, done.text);
  const m = w.items.find((i) => i.id === saved.json.id)!.metadata;
  assertEquals(m.due_on, "2026-10-10");
  assertEquals(m.last_done_on, "2026-10-09");
  const bad = await call(w, "update_item", { item_id: saved.json.id, task_done: true, today: "tomorrow" });
  assertEquals(bad.isError, true);
});
