// My day through the chat function's HTTP handler (supabase/functions/chat/day.ts), on the
// evaluation's pretend account plus use_day_plan (migration day_plan): Pro only, fair use, no model
// call, Home and saved places and tasks from searchable spaces only (rule 3), nothing but counts in
// the log. Also the Home place kind: one Home, and never offered as a place nearby.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, type Item, World } from "../eval/world.ts";
import { createHandler } from "../../supabase/functions/chat/chat.ts";
import type { DayLog } from "../../supabase/functions/chat/day.ts";
import { localTime } from "../../supabase/functions/chat/day.ts";
import type { DriveTimes } from "../../supabase/functions/_shared/dayplan/plan.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";

const DATE = "2026-10-09";
const TZ = "America/New_York";
const POOL = { lat: 28.67, lng: -81.23 };
const HOME = { lat: 28.65, lng: -81.2 };
const id = (n: number) => `00000000-0000-4000-8000-0000000002${n.toString().padStart(2, "0")}`;

function item(w: World, n: number, space_id: string, title: string, item_type: string, metadata: Record<string, unknown>): Item {
  const i: Item = {
    id: id(n), space_id, title, item_type, summary: null, body_markdown: "", metadata, tags: [],
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, revisions: 0,
  };
  w.items.push(i);
  return i;
}

/** The pretend account with a Home, the pool, tasks, and the same things hidden in a restricted space. */
function account(plan: "free" | "pro" = "pro", limit = 30) {
  const w = new World();
  item(w, 1, IDS.home, "Home", "place", { status: "want", kind: "home", ...HOME });
  item(w, 2, IDS.home, "Aquatic Center", "place", { status: "been", kind: "other", ...POOL });
  item(w, 3, IDS.private, "Hidden pool", "place", { status: "been", kind: "other", lat: 28.7, lng: -81.3 });
  item(w, 4, IDS.home, "Pick up dry cleaning", "task", { status: "open", priority: "normal", due_on: DATE, duration_min: 20 });
  item(w, 5, IDS.home, "Pay the water bill", "task", { status: "open", priority: "important", due_on: "2026-10-07" });
  item(w, 6, IDS.home, "Plan the ski trip", "task", { status: "open", priority: "normal", due_on: "2026-11-20" });
  item(w, 7, IDS.home, "Buy goggles", "task", { status: "done", priority: "normal", done_at: "2026-10-08T12:00:00Z" });
  item(w, 8, IDS.private, "Sign the custody papers", "task", { status: "open", priority: "normal", due_on: DATE });
  item(w, 9, IDS.home, "Call the insurance", "task", { status: "open", priority: "normal", planned_at: "2026-10-09T21:05:00Z", duration_min: 15 });
  const state = { plan, used: 0, limit, rpcs: [] as string[] };
  const base = w.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
  const client = {
    ...(w.client() as unknown as Record<string, unknown>),
    rpc: (name: string, params: Record<string, unknown> = {}) => {
      state.rpcs.push(name);
      if (name === "use_day_plan") {
        if (state.plan !== "pro") return Promise.resolve({ data: { allowed: false, reason: "pro_required" }, error: null });
        if (state.used >= state.limit) {
          return Promise.resolve({ data: { allowed: false, reason: "fair_use", used: state.used, limit: state.limit }, error: null });
        }
        state.used += 1;
        return Promise.resolve({ data: { allowed: true, used: state.used, limit: state.limit }, error: null });
      }
      return base.rpc(name, params);
    },
  } as unknown as SupabaseClient;
  return { w, state, client };
}

const swim = (key: string, title: string, start: string, end: string, more: Record<string, unknown> = {}) => ({
  key, title, start: `${DATE}T${start}`, end: `${DATE}T${end}`, all_day: false, location: "Aquatic Center", calendar: "Kids", ...more,
});

function handler(client: SupabaseClient, drives: DriveTimes | null = null) {
  const logs: DayLog[] = [];
  const modelCalls: string[] = [];
  const h = createHandler({
    verifyToken: (t) => Promise.resolve(t === "tok" ? "user-a" : null),
    clientFor: () => client,
    llm: () => {
      modelCalls.push("llm");
      throw new Error("My day must never call a model");
    },
    drives: () => drives,
    log: (e) => logs.push(e as DayLog),
  });
  const post = async (body: unknown, token = "tok") => {
    const res = await h(new Request("http://localhost/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  };
  return { post, logs, modelCalls };
}

const BODY = {
  mode: "day", date: DATE, tz: TZ, now: `${DATE}T12:00`,
  events: [swim("sara", "Swim: Sara", "16:30", "18:30"), swim("adam", "Swim: Adam", "17:00", "19:00")],
};

const fixed: DriveTimes = { leg: () => Promise.resolve({ minutes: 15, typical_minutes: 10 }) };

Deno.test("day: sign-in required", async () => {
  const { client } = account();
  const { post } = handler(client);
  assertEquals((await post(BODY, "")).status, 401);
  assertEquals((await post(BODY, "wrong")).status, 401);
});

Deno.test("day: Free gets pro_required; nothing is read and no model is called", async () => {
  const { client, state } = account("free");
  const { post, logs, modelCalls } = handler(client, fixed);
  const out = await post(BODY);
  assertEquals(out.status, 403);
  assertEquals(out.json, { error: "pro_required" });
  assertEquals(state.rpcs, ["use_day_plan"], "no place or task was read");
  assertEquals(modelCalls, []);
  assertEquals(logs[0].outcome, "pro_required");
});

Deno.test("day: over the fair-use limit gets 429 with the numbers", async () => {
  const { client } = account("pro", 1);
  const { post } = handler(client, fixed);
  assertEquals((await post(BODY)).status, 200);
  const out = await post(BODY);
  assertEquals(out.status, 429);
  assertEquals(out.json, { error: "fair_use", used: 1, limit: 1 });
});

Deno.test("day: a malformed body is 400 and is not counted", async () => {
  const { client, state } = account();
  const { post } = handler(client, fixed);
  for (const bad of [
    { ...BODY, date: "tomorrow" },
    { ...BODY, tz: "Mars/Olympus" },
    { ...BODY, choices: { together: [["sara", "adam"]], everyone: true } },
    { ...BODY, events: [{ ...BODY.events[0], point: { lat: 200, lng: 0 } }] },
    { ...BODY, options_for: "dry cleaning" },
  ]) {
    assertEquals((await post(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  }
  assertEquals(state.used, 0);
});

Deno.test("day: Pro gets the plan: Home, the saved pool by name, overlap with Take both, today's tasks", async () => {
  const { client } = account();
  const { post, modelCalls } = handler(client, fixed);
  const out = await post(BODY);
  assertEquals(out.status, 200);
  const plan = out.json.plan;
  assertEquals(plan.home, { set: true, label: "Home" });
  assertEquals(out.json.usage, { used: 1, limit: 30 });
  const drive = plan.rows.find((r: { kind: string }) => r.kind === "drive");
  assertEquals([drive.from, drive.to, drive.leave_at, drive.minutes, drive.typical_minutes], ["Home", "Aquatic Center", `${DATE}T16:10`, 15, 10]);
  const overlap = plan.rows.find((r: { kind: string }) => r.kind === "overlap");
  assertEquals([overlap.same_place, overlap.suggestion], [true, "take_both"]);
  // Tasks: due today and overdue are not placed yet; the planned one is at 17:05 local; never the
  // future one, the done one, or the one in the restricted space.
  assertEquals(plan.tasks_not_placed.map((t: { title: string }) => t.title).sort(), ["Pay the water bill", "Pick up dry cleaning"]);
  const placed = plan.rows.filter((r: { kind: string }) => r.kind === "task");
  assertEquals(placed.map((t: { title: string; start: string }) => [t.title, t.start]), [["Call the insurance", `${DATE}T17:05`]]);
  assert(!JSON.stringify(out.json).includes("custody"), "a task from a restricted space");
  assertEquals(modelCalls, []);
});

Deno.test("day: Take both and Not driving come from the app's choices", async () => {
  const { client } = account();
  const { post } = handler(client, fixed);
  const both = (await post({ ...BODY, choices: { together: [["sara", "adam"]] } })).json.plan;
  assertEquals(both.rows.filter((r: { kind: string }) => r.kind === "overlap"), []);
  const none = (await post({ ...BODY, choices: { not_driving: ["sara", "adam"] } })).json.plan;
  assertEquals(none.rows.filter((r: { kind: string }) => r.kind === "drive"), []);
});

Deno.test("day: an event place from the phone's geocoder when no saved place matches; none: Where is this?", async () => {
  const { client } = account();
  const { post } = handler(client, fixed);
  const plan = (await post({
    ...BODY,
    events: [
      { ...swim("dentist", "Dentist", "09:00", "09:45"), location: "Oviedo Dental, Oviedo FL", point: { lat: 28.66, lng: -81.21, by_name_only: true } },
      { ...swim("vet", "Vet", "11:00", "11:30"), location: "Dr. Paws" },
    ],
  })).json.plan;
  const events = plan.rows.filter((r: { kind: string }) => r.kind === "event");
  assertEquals(events[0].place, "Oviedo Dental, Oviedo FL");
  assertEquals(events[0].by_name_only, true);
  assertEquals(events[1].needs_place, true);
});

Deno.test("day: a Home or a pool in a restricted space is never used (rule 3)", async () => {
  const { client, w } = account();
  // Move Home into the restricted space; name the event after the hidden pool.
  w.items.find((i) => i.id === id(1))!.space_id = IDS.private;
  const { post } = handler(client, fixed);
  const plan = (await post({ ...BODY, events: [{ ...swim("x", "Swim", "16:30", "17:30"), location: "Hidden pool" }] })).json.plan;
  assertEquals(plan.home, { set: false });
  const ev = plan.rows.find((r: { kind: string }) => r.kind === "event");
  assertEquals(ev.place, undefined);
  assertEquals(ev.needs_place, true);
  assert(!JSON.stringify(plan).includes("28.7"), "the hidden pool's position");
});

Deno.test("day: without drive times (until step 3) the plan says so", async () => {
  const { client } = account();
  const { post } = handler(client, null);
  const plan = (await post(BODY)).json.plan;
  assertEquals(plan.drive_times, "unavailable");
  assertEquals(plan.rows.find((r: { kind: string }) => r.kind === "drive").unavailable, "no_drive_times");
});

Deno.test("day: the log line holds counts only, never titles, places or times", async () => {
  const { client } = account();
  const { post, logs } = handler(client, fixed);
  await post(BODY);
  const line = JSON.stringify(logs);
  for (const s of ["Swim", "Aquatic", "28.6", "16:30", "dry cleaning", DATE]) assert(!line.includes(s), `log holds ${s}: ${line}`);
  assertEquals([logs[0].outcome, logs[0].events, logs[0].tasks, logs[0].matched_places], ["ok", 2, 3, 2]);
});

Deno.test("localTime: a stored moment in the user's own day and time", () => {
  assertEquals(localTime("2026-10-09T21:05:00Z", TZ), "2026-10-09T17:05");
  assertEquals(localTime("2026-10-10T02:30:00Z", TZ), "2026-10-09T22:30");
  assertEquals(localTime("soon", TZ), undefined);
});

// ---- The Home place kind --------------------------------------------------------------------

async function tool(w: World, name: string, args: Record<string, unknown>) {
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
  const text = out.result?.content?.[0]?.text ?? String(out.error?.message);
  return { isError: !!out.result?.isError || !!out.error, text };
}

Deno.test("Home: one only; a second is refused, changing the one Home is fine", async () => {
  const { w } = account();
  const second = await tool(w, "save_item", {
    space: "Home", title: "Lake house", body: "", item_type: "place", metadata: { kind: "home", lat: 28.1, lng: -81.5 },
  });
  assertEquals(second.isError, true);
  assert(second.text.includes("already a Home"), second.text);
  const edit = await tool(w, "update_item", { item_id: id(1), metadata: { kind: "home", status: "want", lat: 28.651, lng: -81.2 } });
  assertEquals(edit.isError, false, edit.text);
  const other = await tool(w, "update_item", { item_id: id(2), metadata: { kind: "home", status: "been", ...POOL } });
  assertEquals(other.isError, true, "making a second place Home");
});

Deno.test("Home: measured from, never offered as a place nearby", async () => {
  const { w } = account();
  const near = await tool(w, "find_places", { lat: HOME.lat, lng: HOME.lng });
  assert(!near.isError, near.text);
  assert(!/"title": "Home"/.test(near.text), near.text);
  assert(near.text.includes("Aquatic Center"));
  const fromHome = await tool(w, "find_places", { near_place: "Home" });
  assert(!fromHome.isError, fromHome.text);
  assert(fromHome.text.includes("Aquatic Center"));
});
