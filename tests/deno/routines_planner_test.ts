// Routines in the day planner (docs/routines-plan.md step 2, D39): "From your routines" worked out
// by code (up to 3, nearest last day first, each in free time on a quarter hour, never overlapping;
// a task with a place gets no time; no duration means 30 minutes), a routine's task in the day while
// its window holds it and never overdue there, "Not today" keeping it out of the suggestions only,
// a missed one moved on and written (with a revision), and the model given the suggestions as
// numbers it must not change.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, type Item, World } from "../eval/world.ts";
import { createHandler } from "../../supabase/functions/chat/chat.ts";
import type { DayLog } from "../../supabase/functions/chat/day.ts";
import { planForModel } from "../../supabase/functions/chat/agenda.ts";
import {
  type DayPlan,
  fromMin,
  MAX_SUGGESTIONS,
  type PlanTask,
  ROUTINE_DEFAULT_MIN,
  routineSuggestions,
} from "../../supabase/functions/_shared/dayplan/plan.ts";

const DATE = "2026-10-09"; // a Friday
const TZ = "America/New_York";
const at = (m: number) => fromMin(DATE, m);
const H = (h: number, m = 0) => h * 60 + m;

// ---- routineSuggestions (no database) -----------------------------------------------------------

const rt = (id: string, title: string, more: Partial<PlanTask> = {}): PlanTask =>
  ({ id, title, priority: "normal", routine: "Weekend reset", suggest: true, due_on: "2026-10-10", ...more });

Deno.test("routineSuggestions: nearest last day first, quarter hours, no overlaps, at most 3, the rest counted", () => {
  const tasks = [
    rt("a", "Laundry", { duration_min: 45, due_on: "2026-10-31", routine: "Checks" }),
    rt("b", "Vacuum", { duration_min: 30 }),
    rt("c", "Groceries"),
    rt("d", "Trash out", { duration_min: 15, priority: "important" }),
    rt("e", "Water plants", { duration_min: 10, due_on: "2026-10-31" }),
  ];
  const out = routineSuggestions(tasks, new Set(tasks.map((t) => t.id)), [[H(9, 5), H(10, 40)], [H(13), H(15)]], at)!;
  assertEquals(out.items.length, MAX_SUGGESTIONS);
  assertEquals(out.more, 2);
  // Due Oct 10 first (important first among them), then by routine and title.
  assertEquals(out.items.map((s) => s.title), ["Trash out", "Groceries", "Vacuum"]);
  assertEquals(out.items.map((s) => [s.start, s.end]), [
    [`${DATE}T09:15`, `${DATE}T09:30`],
    [`${DATE}T09:30`, `${DATE}T10:00`],
    [`${DATE}T10:00`, `${DATE}T10:30`],
  ]);
  assertEquals(out.items[1].duration_assumed, true);
  assertEquals(out.items[1].duration_min, ROUTINE_DEFAULT_MIN);
});

Deno.test("routineSuggestions: a task with a place has no time; one that fits nowhere is counted; none offered: null", () => {
  const tasks = [rt("a", "Wash the car", { place: { lat: 1, lng: 1, label: "Car wash" } }), rt("b", "Deep clean", { duration_min: 240 })];
  const out = routineSuggestions(tasks, new Set(["a", "b"]), [[H(9), H(11)]], at)!;
  assertEquals(out.items.map((s) => [s.title, s.start]), [["Wash the car", undefined]]);
  assertEquals(out.more, 1);
  assertEquals(routineSuggestions([rt("x", "Placed")], new Set(), [[H(9), H(11)]], at), null); // placed already
  assertEquals(routineSuggestions([rt("y", "Off", { suggest: undefined })], new Set(["y"]), [[H(9), H(11)]], at), null);
  assertEquals(routineSuggestions([rt("z", "Plain", { routine: undefined })], new Set(["z"]), [[H(9), H(11)]], at), null);
});

// ---- My day on the pretend account --------------------------------------------------------------

const ROUTINE = "00000000-0000-4000-8000-0000000003a1";
const OFF = "00000000-0000-4000-8000-0000000003a2";
const id = (n: number) => `00000000-0000-4000-8000-0000000003${n.toString().padStart(2, "0")}`;

function item(w: World, iid: string, title: string, item_type: string, metadata: Record<string, unknown>, space: string = IDS.home): Item {
  const i: Item = {
    id: iid, space_id: space, title, item_type, summary: null, body_markdown: "", metadata, tags: [],
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, revisions: 0,
  };
  w.items.push(i);
  return i;
}

const task = (routine: string, window_from: string, due_on: string, more: Record<string, unknown> = {}) => ({
  status: "open", priority: "normal", repeat: "monthly", routine_id: routine, window_from, due_on, ...more,
});

function account() {
  const w = new World();
  item(w, ROUTINE, "Checks", "routine", { repeat: "monthly", when: "any_day", starts_on: "2026-09-01", suggest: true });
  item(w, OFF, "Quiet", "routine", { repeat: "monthly", when: "any_day", starts_on: "2026-09-01", suggest: false });
  item(w, id(1), "Smoke alarms", "task", task(ROUTINE, "2026-10-01", "2026-10-31", { duration_min: 20 }));
  item(w, id(2), "Tire pressure", "task", task(ROUTINE, "2026-10-01", "2026-10-31"));
  item(w, id(3), "Missed one", "task", task(ROUTINE, "2026-09-01", "2026-09-30"));
  item(w, id(4), "Done already", "task", task(ROUTINE, "2026-11-01", "2026-11-30", { last_done_on: "2026-10-02" }));
  item(w, id(5), "Not suggested", "task", task(OFF, "2026-10-01", "2026-10-31"));
  item(w, id(6), "Hidden routine task", "task", task(ROUTINE, "2026-10-01", "2026-10-31"), IDS.private);
  const base = w.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
  const client = {
    ...(w.client() as unknown as Record<string, unknown>),
    rpc: (name: string, params: Record<string, unknown> = {}) =>
      name === "use_day_plan"
        ? Promise.resolve({ data: { allowed: true, used: 1, limit: 30 }, error: null })
        : base.rpc(name, params),
  } as unknown as SupabaseClient;
  return { w, client };
}

function handler(client: SupabaseClient) {
  const logs: DayLog[] = [];
  const h = createHandler({
    verifyToken: (t) => Promise.resolve(t === "tok" ? "user-a" : null),
    clientFor: () => client,
    llm: () => {
      throw new Error("My day must never call a model");
    },
    drives: () => null,
    log: (e) => logs.push(e as DayLog),
    now: () => Date.parse(`${DATE}T13:00:00Z`), // 9:00 in New York
  });
  const post = async (body: unknown) => {
    const res = await h(new Request("http://localhost/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  };
  return { post, logs };
}

const BODY = {
  mode: "day", date: DATE, tz: TZ, now: `${DATE}T09:00`,
  events: [{ key: "dentist", title: "Dentist", start: `${DATE}T10:00`, end: `${DATE}T11:00`, all_day: false, calendar: "Home", not_a_trip: true }],
};

Deno.test("My day: From your routines offers the routine's tasks in free time; never overdue; never hidden or Quiet ones", async () => {
  const { w, client } = account();
  const { post, logs } = handler(client);
  const out = await post(BODY);
  assertEquals(out.status, 200, JSON.stringify(out.json));
  const plan = out.json.plan as DayPlan;
  const s = plan.suggestions!;
  assertEquals(s.items.map((i) => i.title).sort(), ["Missed one", "Smoke alarms", "Tire pressure"]);
  for (const i of s.items) assert(i.start && i.start >= `${DATE}T09:00`, JSON.stringify(i));
  // Never in the dentist's hour, never on top of each other.
  const spans = s.items.map((i) => [i.start!, i.end!]).sort();
  for (const [a, b] of spans) assert(b <= `${DATE}T10:00` || a >= `${DATE}T11:00`, `${a}-${b}`);
  for (let k = 1; k < spans.length; k++) assert(spans[k][0] >= spans[k - 1][1]);
  const notPlaced = plan.tasks_not_placed;
  const titles = notPlaced.map((t) => t.title);
  assert(titles.includes("Not suggested"), "a Quiet routine's task is in the day, just not offered");
  assert(!titles.includes("Done already"), "done this month: not in the day");
  assert(!titles.includes("Hidden routine task"), "rule 3: a restricted space adds nothing");
  for (const t of notPlaced.filter((t) => t.routine)) assertEquals(t.overdue, undefined, t.title);
  assertEquals(notPlaced.find((t) => t.title === "Smoke alarms")!.routine, "Checks");
  assertEquals(logs[0].suggestions, 3);
  // The missed one was moved on to October and written once, with a revision (rule 7).
  const missed = w.items.find((i) => i.id === id(3))!;
  assertEquals([missed.metadata.window_from, missed.metadata.due_on, missed.metadata.missed_on], ["2026-10-01", "2026-10-31", "2026-09-30"]);
  assertEquals(missed.revisions, 1);
  assertEquals(logs[0].settled, 1);
});

Deno.test("My day: Not today keeps a task out of the suggestions for that day only; the next one takes its place", async () => {
  const { w, client } = account();
  w.notToday.push({ task_id: id(1), day: DATE }, { task_id: id(2), day: "2026-10-08" });
  const { post } = handler(client);
  const plan = (await post(BODY)).json.plan as DayPlan;
  const offered = plan.suggestions!.items.map((i) => i.title);
  assert(!offered.includes("Smoke alarms"), offered.join());
  assert(offered.includes("Tire pressure"), "a dismissal for another day does not count today");
  assert(plan.tasks_not_placed.some((t) => t.title === "Smoke alarms"), "still in the day, with Find a time");
});

Deno.test("My day: a routine task with a time today is placed, not suggested", async () => {
  const { w, client } = account();
  w.items.find((i) => i.id === id(1))!.metadata.planned_at = `${DATE}T13:00:00-04:00`;
  const { post } = handler(client);
  const plan = (await post(BODY)).json.plan as DayPlan;
  assert(plan.rows.some((r) => r.kind === "task" && r.title === "Smoke alarms"));
  assert(!plan.suggestions!.items.some((i) => i.title === "Smoke alarms"));
});

Deno.test("My day: a later day in another month offers the routine again (its next period)", async () => {
  const { client } = account();
  const { post } = handler(client);
  const later = "2026-11-12";
  const plan = (await post({ ...BODY, date: later, now: undefined, events: [] })).json.plan as DayPlan;
  const done = plan.tasks_not_placed.find((t) => t.title === "Done already");
  assertEquals(done?.due_on, "2026-11-30");
  assertEquals(done?.overdue, undefined);
  const smoke = plan.tasks_not_placed.find((t) => t.title === "Smoke alarms");
  assertEquals(smoke?.due_on, "2026-11-30", "October's, planned for November: November's window");
});

Deno.test("planForModel: the model gets the suggestions as numbers, with a note never to add them itself", () => {
  const plan: DayPlan = {
    date: DATE, time_zone: TZ, home: { set: false }, drive_times: "unavailable", weather: "unavailable", weather_at: [],
    credits: [], rows: [], all_day: [],
    tasks_not_placed: [{ id: "t", title: "Vacuum", priority: "normal", routine: "Weekend reset", due_on: "2026-10-10" }],
    suggestions: {
      items: [
        { task_id: "t", title: "Vacuum", routine: "Weekend reset", duration_min: 30, duration_assumed: true, start: `${DATE}T09:45`, end: `${DATE}T10:15` },
        { task_id: "u", title: "Wash the car", routine: "Checks", duration_min: 45 },
      ],
      more: 2,
    },
  };
  const m = planForModel(plan, new Map()) as Record<string, unknown>;
  const s = m.routine_suggestions as Record<string, unknown>[];
  assertEquals(s[0], { title: "Vacuum", routine: "Weekend reset", minutes: 30, minutes_assumed: true, fits_at: `${DATE}T09:45`, until: `${DATE}T10:15` });
  assert("needs_a_drive" in s[1]);
  assertEquals(m.more_routine_tasks_waiting, 2);
  assert(String(m.routine_suggestions_note).includes("never add them"));
  assertEquals((m.tasks_not_placed as Record<string, unknown>[])[0].routine, "Weekend reset");
});
