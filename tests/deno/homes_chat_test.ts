// Homes in the chat (design D36, docs/my-places-plan.md step 2): the save_home card (every field
// checked, a code refused, never offered to an app that cannot show it, the model told it waits for
// the tap), from_home on get_day_agenda (matched among the user's own homes, labels only reaching the
// model, the plan started there whether or not the app sends the home back), and automatic memory
// never keeping a home (no memory call after save_home, no street address or "lives in" fact).
// End to end through the chat function's handler with the evaluation's pretend account and a
// scripted model; no model API and no database are called.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../eval/harness.ts"; // Edge runtime stand-ins
import { World } from "../eval/world.ts";
import { CAN_ALARM, CAN_HOME, MAX_HOME_LABEL, PhoneActions } from "../../supabase/functions/chat/phone_actions.ts";
import { type Home, matchHome, readHomes } from "../../supabase/functions/chat/homes.ts";
import { type Agenda, type AgendaHomes, agendaCall, agendaSchema } from "../../supabase/functions/chat/agenda.ts";
import type { ChatPlan } from "../../supabase/functions/chat/day.ts";
import { createHandler, type LogEntry } from "../../supabase/functions/chat/chat.ts";
import { factProblem, homeAddress, type MemoryLog, memoryPrompt, turnGuard } from "../../supabase/functions/chat/memory.ts";
import { serverInstructions } from "../../supabase/functions/mcp/lib/assistant.ts";
import { MEMORY_TYPE } from "../../supabase/functions/mcp/lib/memory.ts";
import { loadSpaces } from "../../supabase/functions/mcp/lib/spaces.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import type { ChatRequest, Message, RouteName, StreamEvent, ToolCall } from "../../supabase/functions/_shared/llm/index.ts";

const phone = (can: ReadonlySet<string> = new Set([CAN_HOME])) => new PhoneActions({ can, tz: "America/New_York" });

const HOME_ID = "00000000-0000-4000-8000-000000000301";
const MOMS_ID = "00000000-0000-4000-8000-000000000302";
const HOMES = [
  { id: HOME_ID, label: "Home", address: "1200 Lockwood Blvd, Oviedo FL", lat: 28.65, lng: -81.2, is_default: true },
  { id: MOMS_ID, label: "Mom's", address: "4 Elm Rd, Oviedo FL", lat: 28.55, lng: -81.38, is_default: false },
];
/** What must never reach the model from a home: its address or point. */
const ADDRESS_OR_POINT = /Lockwood|Elm Rd|28\.65|28\.55|-81\.2\b|-81\.38/;

// ---- save_home ----------------------------------------------------------------------------------

Deno.test("save_home: label and address checked and tidied; the card waits for the tap", () => {
  const out = phone().run("save_home", { label: "  Mom's ", address: " 4 Elm Rd,   Oviedo FL ", make_default: false });
  assertEquals(out.isError, false);
  assertEquals(out.events, [{ type: "home_save", label: "Mom's", address: "4 Elm Rd, Oviedo FL", make_default: false }]);
  const told = JSON.parse(out.text);
  assertEquals(told.status, "waiting_for_user");
  assert(told.message.includes("Not done yet") && told.message.includes("tap Save"), told.message);
  assert(told.message.includes("Do not also save it as a note, a place or a memory"), told.message);
  // Without an address the card offers Use where I am; make_default is false unless true.
  assertEquals(phone().run("save_home", { label: "Home" }).events, [{ type: "home_save", label: "Home", address: null, make_default: false }]);
  assertEquals(phone().run("save_home", { label: "Home", make_default: true }).events[0].make_default, true);
  // Refused: no name, too long, not text, an odd make_default.
  assertEquals(phone().run("save_home", { address: "12 Oak St" }).isError, true, "no label");
  assertEquals(phone().run("save_home", { label: "  " }).isError, true, "blank label");
  assertEquals(phone().run("save_home", { label: "x".repeat(MAX_HOME_LABEL + 1) }).isError, true, "label too long");
  assertEquals(phone().run("save_home", { label: "Home", address: "x".repeat(301) }).isError, true, "address too long");
  assertEquals(phone().run("save_home", { label: 7 }).isError, true);
  assertEquals(phone().run("save_home", { label: "Home", make_default: "yes" }).isError, true);
});

Deno.test("save_home: an alarm code, gate PIN or password is refused without repeating it (rule 9)", () => {
  for (
    const input of [
      { label: "Home", address: "12 Oak St, alarm code 4831" },
      { label: "Mom's", address: "4 Elm Rd, gate PIN 2580" },
      { label: "Home PIN 2580" },
      { label: "Lake house", address: "wifi password: hunter2hunter2" },
    ]
  ) {
    const out = phone().run("save_home", input);
    assertEquals(out.isError, true, JSON.stringify(input));
    assertEquals(out.events, [], "no card reaches the app");
    assert(!/4831|2580|hunter2/.test(out.text), "the value is never repeated");
    assert(out.text.includes("Vault"));
  }
});

Deno.test("save_home: not offered to an app without \"home\" in can; one card per message", () => {
  const old = phone(new Set([CAN_ALARM])).run("save_home", { label: "Home", address: "12 Oak St" });
  assertEquals(old.events, []);
  const told = JSON.parse(old.text);
  assertEquals(told.status, "app_cannot");
  assert(/updating\s+Wilma/.test(told.message) && told.message.includes("My day"), told.message);
  assert(told.message.includes("Do not save the home as a note, a place or a memory"), told.message);

  const p = phone();
  assertEquals(p.run("save_home", { label: "Home", address: "12 Oak St" }).events.length, 1);
  assertEquals(p.run("save_home", { label: "Home", address: "12 Oak St" }).events.length, 0);
});

Deno.test("save_home is chat-only; get_day_agenda takes from_home", () => {
  const registered: { name: string; schema: Record<string, unknown> }[] = [];
  const fake = { registerTool: (name: string, def: { inputSchema: Record<string, unknown> }) => registered.push({ name, schema: def.inputSchema }) };
  for (const r of ALL_TOOLS) r(fake as never, { db: new World().client(), userId: "u", accessToken: "t", assistantName: "Wilma", log: () => {} });
  assertFalse(registered.some((t) => t.name === "save_home"), "never an MCP tool");
  assert("from_home" in registered.find((t) => t.name === "get_day_agenda")!.schema);
});

Deno.test("the chat's instructions say save_home for homes; the Claude connector's are unchanged (Q8)", () => {
  const chat = serverInstructions("Wilma", "mi", { chat: true });
  assert(chat.includes("save them only with save_home"));
  assertFalse(chat.includes('a place with kind "home"'));
  const connector = serverInstructions("Wilma");
  assert(connector.includes('a place with kind "home"'));
  assertFalse(connector.includes("save_home"));
});

// ---- Matching a named home ----------------------------------------------------------------------

Deno.test("matchHome: the exact name, or one loose match; never a guess between two", () => {
  const homes: Home[] = [
    { id: "a", label: "Home", is_default: true },
    { id: "b", label: "Mom's", is_default: false },
    { id: "c", label: "Lake house", is_default: false },
  ];
  assertEquals(matchHome(homes, "Mom's")?.id, "b");
  for (const named of ["moms", "mom’s", "my mom's house", "MOM'S PLACE", "mom"]) assertEquals(matchHome(homes, named)?.id, "b", named);
  assertEquals(matchHome(homes, "the lake house")?.id, "c");
  assertEquals(matchHome(homes, "home")?.id, "a");
  assertEquals(matchHome(homes, "Grandma's"), null);
  assertEquals(matchHome(homes, ""), null);
  assertEquals(matchHome([{ id: "x", label: "Mom's", is_default: false }, { id: "y", label: "Moms", is_default: false }], "mom"), null);
});

Deno.test("readHomes reads labels only (never an address or a point), the default first", async () => {
  const w = new World();
  w.homes = [HOMES[1], HOMES[0]];
  const homes = await readHomes(w.client());
  assertEquals(homes, [{ id: HOME_ID, label: "Home", is_default: true }, { id: MOMS_ID, label: "Mom's", is_default: false }]);
  let selected = "";
  const spy = { from: () => ({ select: (cols: string) => ((selected = cols), { limit: () => Promise.resolve({ data: [], error: null }) }) }) };
  await readHomes(spy as unknown as SupabaseClient);
  assertEquals(selected, "id, label, is_default");
});

// ---- from_home on get_day_agenda ---------------------------------------------------------------

const DAY = "2026-10-12";
const AGENDA: Agenda = agendaSchema.parse({
  from: DAY, to: DAY, time_zone: "America/New_York", calendars: 1,
  events: [{ title: "Swim", start: `${DAY}T16:30`, end: `${DAY}T18:30`, all_day: false, calendar: "Kids", location: "Aquatic Center", point: { lat: 28.6, lng: -81.2 } }],
});

/** The homes a user's own client returns (RLS): only theirs. */
function homesOf(list: Home[], replans: string[] = []): AgendaHomes {
  return {
    list: () => Promise.resolve(list),
    replan: (id) => {
      replans.push(id);
      return Promise.resolve(planFrom(list.find((h) => h.id === id)!.label));
    },
  };
}
const OWN: Home[] = [{ id: HOME_ID, label: "Home", is_default: true }, { id: MOMS_ID, label: "Mom's", is_default: false }];

function planFrom(label: string): ChatPlan {
  return {
    made: true,
    plan: {
      date: DAY, home: { set: true, label }, drive_times: "ok", weather: "ok", rows: [], tasks_not_placed: [],
    } as unknown as Extract<ChatPlan, { made: true }>["plan"],
    titles: new Map(),
  };
}

Deno.test("from_home: the calendar request carries the matched home's id for the app; the model sees no id", async () => {
  const out = await agendaCall({ from: DAY, to: DAY, from_home: "moms" }, true, undefined, undefined, homesOf(OWN));
  assertEquals(out.request, { type: "agenda_request", from: DAY, to: DAY, start_from: { home: MOMS_ID } });
  assertFalse(out.result.content.includes(MOMS_ID));
  // No from_home: as before.
  assertEquals((await agendaCall({ from: DAY }, true, undefined, undefined, homesOf(OWN))).request, { type: "agenda_request", from: DAY, to: DAY });
  // Several days: the planner plans one day, so from_home is not used.
  const week = await agendaCall({ from: DAY, to: "2026-10-14", from_home: "Mom's" }, true, undefined, undefined, homesOf(OWN));
  assertEquals(week.request?.start_from, undefined);
});

Deno.test("from_home: only the user's own homes match; anything else gets their labels and no request", async () => {
  // Another person's "Beach house" is not in what the user's client returns (RLS), so it matches nothing.
  const out = await agendaCall({ from: DAY, from_home: "Beach house" }, true, undefined, undefined, homesOf(OWN));
  assertEquals(out.request, undefined);
  assert(out.result.content.includes('No saved home is called "Beach house"'), out.result.content);
  assert(out.result.content.includes("Home, Mom's"));
  assertFalse(/[0-9a-f]{8}-[0-9a-f]{4}/.test(out.result.content), "no id");
  const none = await agendaCall({ from: DAY, from_home: "Mom's" }, true, undefined, undefined, homesOf([]));
  assert(none.result.content.includes("no saved homes yet"), none.result.content);
  // The homes could not be read: an error, nothing asked.
  const broken: AgendaHomes = { list: () => Promise.reject(new Error("db:x")), replan: () => Promise.reject(new Error("no")) };
  const failed = await agendaCall({ from: DAY, from_home: "Mom's" }, true, undefined, undefined, broken);
  assertEquals(failed.result.isError, true);
  assertEquals(failed.request, undefined);
});

Deno.test("from_home on the re-sent day: planned again from the named home once; the result names it", async () => {
  const replans: string[] = [];
  const homes = homesOf(OWN, replans);
  const again = await agendaCall({ from: DAY, from_home: "Mom's" }, true, AGENDA, planFrom("Home"), homes);
  assertEquals(replans, [MOMS_ID]);
  assert(again.plan?.made && again.plan.plan.home.label === "Mom's");
  assertEquals(JSON.parse(again.result.content).day_plan.planned_from, "Mom's");
  // Already from there: not planned again.
  const same = await agendaCall({ from: DAY, from_home: "Mom's" }, true, AGENDA, planFrom("Mom's"), homes);
  assertEquals(replans.length, 1);
  assertEquals(same.plan, undefined);
  // No plan made (not Pro): nothing to plan again.
  await agendaCall({ from: DAY, from_home: "Mom's" }, true, AGENDA, { made: false, reason: "pro_required" }, homes);
  assertEquals(replans.length, 1);
});

// ---- End to end through the chat function ------------------------------------------------------

const MEMORIES = "00000000-0000-4000-8000-0000000000e2";

class Account {
  world = new World();
  rpcs: string[] = [];

  constructor() {
    this.world.spaces.push({
      id: MEMORIES, name: "Memories", description: "What Wilma remembered about you", parent_id: null, is_restricted: false,
      built_in: "memories",
    });
    this.world.memoryOn = true;
  }

  client(): SupabaseClient {
    const base = this.world.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
    return {
      ...base,
      rpc: (name: string, params: Record<string, unknown> = {}) => {
        this.rpcs.push(name);
        if (name === "my_ai_allowance") return Promise.resolve({ data: { month: "2026-10-01", used_fraction: 0 }, error: null });
        if (name === "record_ai_usage") return Promise.resolve({ data: { month: "2026-10-01", used_fraction: 0.01 }, error: null });
        if (name === "record_ai_cost") return Promise.resolve({ data: {}, error: null });
        return base.rpc(name, params);
      },
    } as unknown as SupabaseClient;
  }
}

type Step = { text?: string; calls?: Omit<ToolCall, "id">[] };

class Model {
  requests: { route: RouteName; req: ChatRequest }[] = [];
  constructor(private steps: Step[], private memory = '{"facts":[]}') {}

  async *stream(route: RouteName, req: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push({ route, req: { ...req, messages: structuredClone(req.messages) } });
    let text = this.memory;
    let toolCalls: ToolCall[] = [];
    if (route !== "memory") {
      const s = this.steps[this.requests.filter((r) => r.route !== "memory").length - 1] ?? { text: "OK." };
      text = s.text ?? "";
      if (text) yield { type: "text", text };
      toolCalls = (s.calls ?? []).map((c, i) => ({ ...c, id: `call_${this.requests.length}_${i}` }));
    }
    yield {
      type: "done",
      turn: { role: "assistant", text, toolCalls },
      stop: toolCalls.length ? "tool_calls" : "end",
      usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 30, costCents: 0.01 },
    };
  }

  of(route: RouteName) {
    return this.requests.filter((r) => r.route === route);
  }
}

function setup(steps: Step[], memory?: string) {
  const account = new Account();
  const model = new Model(steps, memory);
  const chatLogs: LogEntry[] = [];
  const memoryLogs: MemoryLog[] = [];
  const handler = createHandler({
    verifyToken: (t) => Promise.resolve(t === "good-token" ? "eval-user" : null),
    clientFor: () => account.client(),
    llm: () => ({ stream: (route, req) => model.stream(route, req) }),
    drives: () => ({ leg: () => Promise.resolve({ minutes: 15, typical_minutes: 10 }) }),
    log: (e) => {
      if (e.event === "chat") chatLogs.push(e);
      if (e.event === "memory") memoryLogs.push(e);
    },
    background: () => {},
    now: () => Date.parse(`${DAY}T12:00:00Z`),
  });
  return { account, model, chatLogs, memoryLogs, handler };
}

type Event = Record<string, unknown> & { type: string };

async function chat(s: ReturnType<typeof setup>, content: string, extra: Record<string, unknown> = {}): Promise<{ status: number; events: Event[] }> {
  const res = await s.handler(new Request("http://localhost/functions/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good-token" },
    body: JSON.stringify({ messages: [{ role: "user", content }], ...extra }),
  }));
  const text = await res.text();
  return { status: res.status, events: res.status === 200 ? text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Event) : [] };
}

/** Every tool result the model was given, in the last default-route request. */
function toolResults(model: Model): string {
  const last = model.of("default").at(-1)!.req.messages;
  return last.flatMap((m: Message) => (m.role === "tool" ? m.results.map((r) => r.content) : [])).join("\n");
}

Deno.test("chat: save_home sends the card, saves nothing, and gets no memory call", async () => {
  const s = setup(
    [{ calls: [{ name: "save_home", input: { label: "Home", address: "12 Oak St, Oviedo FL", make_default: true } }] }, {
      text: "Check the address on the card and tap Save.",
    }],
    '{"facts":[{"fact":"Lives at 12 Oak St, Oviedo"}]}',
  );
  const before = s.account.world.items.length;
  const { events } = await chat(s, "my home is 12 Oak St, Oviedo FL", { can: [CAN_HOME] });
  assertEquals(events.filter((e) => e.type === "home_save"), [
    { type: "home_save", label: "Home", address: "12 Oak St, Oviedo FL", make_default: true },
  ]);
  assertEquals(s.account.world.items.length, before, "nothing saved on the server");
  assertEquals(s.account.world.homes, [], "no home written by the server: the phone writes it on the tap");
  assertEquals(s.model.of("memory").length, 0, "no memory model call");
  assertEquals(s.memoryLogs[0]?.code, "home_save");
  assertEquals(s.chatLogs[0].tools, ["save_home"]);
});

Deno.test("chat: an app without \"home\" in can gets no card, and the model is told to suggest updating", async () => {
  const s = setup([{ calls: [{ name: "save_home", input: { label: "Home", address: "12 Oak St" } }] }, { text: "Update Wilma." }]);
  const { events } = await chat(s, "my home is 12 Oak St", { can: ["calendar"] });
  assertFalse(events.some((e) => e.type === "home_save"));
  assert(toolResults(s.model).includes("app_cannot"));
});

Deno.test("chat: plan my day from Mom's, with the app sending the home back: planned from Mom's, counted once", async () => {
  const s = setup([{ text: "Leave at 4:10 from Mom's." }]);
  s.account.world.plan = "pro";
  s.account.world.homes = HOMES.map((h) => ({ ...h }));
  const { events } = await chat(s, "plan my day tomorrow from Mom's", { can: ["calendar", CAN_HOME], agenda: AGENDA, start_from: { home: MOMS_ID } });
  assert(events.some((e) => e.type === "day_plan"));
  const results = toolResults(s.model);
  assertEquals(JSON.parse(results).day_plan.planned_from, "Mom's");
  assertFalse(ADDRESS_OR_POINT.test(results), "never an address or a point");
  // The synthetic call names the home, so the model sees it was asked for.
  const call = s.model.of("default")[0].req.messages.find((m: Message) => m.role === "assistant") as Extract<Message, { role: "assistant" }>;
  assertEquals(call.toolCalls[0].input.from_home, "Mom's");
  assertEquals(s.account.rpcs.filter((r) => r === "use_day_plan").length, 1);
});

Deno.test("chat: an app that does not send the home back: the model names it, the day is planned again, not counted twice", async () => {
  const s = setup([
    { calls: [{ name: "get_day_agenda", input: { from: DAY, to: DAY, from_home: "Mom's" } }] },
    { text: "Leave at 4:10 from Mom's." },
  ]);
  s.account.world.plan = "pro";
  s.account.world.homes = HOMES.map((h) => ({ ...h }));
  await chat(s, "plan my day tomorrow from Mom's", { can: ["calendar"], agenda: AGENDA });
  const first = s.model.of("default")[0].req.messages;
  const firstPlan = JSON.parse((first.at(-1) as Extract<Message, { role: "tool" }>).results[0].content).day_plan;
  assertEquals(firstPlan.planned_from, "Home", "the default first");
  assert(firstPlan.planned_from_note.includes("from_home"));
  const second = s.model.of("default")[1].req.messages;
  const again = JSON.parse((second.at(-1) as Extract<Message, { role: "tool" }>).results[0].content).day_plan;
  assertEquals(again.planned_from, "Mom's");
  assertFalse(ADDRESS_OR_POINT.test(JSON.stringify(second)), "never an address or a point");
  assertEquals(s.account.rpcs.filter((r) => r === "use_day_plan").length, 1, "one plan counted");
});

Deno.test("chat: start_from that is not a home id is refused; another person's id plans from the default", async () => {
  const s = setup([{ text: "OK." }]);
  s.account.world.plan = "pro";
  s.account.world.homes = HOMES.map((h) => ({ ...h }));
  assertEquals((await chat(s, "plan my day", { agenda: AGENDA, start_from: { home: "Mom's" } })).status, 400);
  // RLS hides another person's home: the id reads nothing, so the plan starts from the default.
  await chat(s, "plan my day", { agenda: AGENDA, start_from: { home: "00000000-0000-4000-8000-0000000003ff" } });
  assertEquals(JSON.parse(toolResults(s.model)).day_plan.planned_from, "Home");
});

// ---- Automatic memory never keeps a home --------------------------------------------------------

Deno.test("homeAddress: a street address or where the user lives; ordinary facts kept", () => {
  for (
    const fact of [
      "Lives at 12 Oak St, Oviedo", "Home is 4 Elm Rd", "Mom's house is at 4 Elm Road", "Lives in Oviedo", "Moved to Austin",
      "Home address: 1200 Lockwood Blvd", "Mom lives near the lake", "Gets mail at a PO Box",
    ]
  ) assert(homeAddress(fact), fact);
  for (
    const fact of [
      "Runs 5 miles most of the way", "Works from home on Fridays", "Moved swim practice to Tuesdays", "Daughter Lexi swims on Tuesdays",
      "Our plumber is Mike", "Walks 3 times a week in the park", "Prefers an aisle seat", "Favorite pizza place is on Main Street",
    ]
  ) assertFalse(homeAddress(fact), fact);
});

Deno.test("factProblem and turnGuard: a home is never a memory", async () => {
  const f = (fact: string) => ({ fact, sensitive: false });
  assertEquals(factProblem(f("Lives at 12 Oak St, Oviedo"), "I live at 12 Oak St, Oviedo"), "home_address");
  assertEquals(factProblem(f("Mom lives in Oviedo"), "my mom lives in Oviedo"), "home_address");
  assertEquals(factProblem(f("Works from home on Fridays"), "I work from home on Fridays"), null);
  const spaces = await loadSpaces(new World().client());
  const wilma = (calls: Omit<ToolCall, "id">[]): Message => ({ role: "assistant", text: "", toolCalls: calls.map((c, i) => ({ ...c, id: `c${i}` })) });
  assertEquals(turnGuard([{ role: "user", content: "my home is 12 Oak St" }], [wilma([{ name: "save_home", input: { label: "Home" } }])], spaces), "home_save");
  assert(memoryPrompt([]).includes("Never a street address or where the user lives"));
});

Deno.test("memory: \"I live at 12 Oak St\" keeps nothing, even when the model names it", async () => {
  const s = setup([{ text: "Got it." }], '{"facts":[{"fact":"Lives at 12 Oak St, Oviedo"},{"fact":"Lives in Oviedo"}]}');
  const { events } = await chat(s, "I live at 12 Oak St, Oviedo");
  assertFalse(events.some((e) => e.type === "remembered"));
  assertEquals(s.account.world.liveItems().filter((i) => i.item_type === MEMORY_TYPE).length, 0);
  assertEquals(s.memoryLogs[0].dropped, { home_address: 2 });
});
