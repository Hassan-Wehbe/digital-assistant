// Routines in the chat (routines step 4, docs/routines-plan.md; design D39): the save_routine card
// (every field checked with the server's own schedule rules, a password refused without repeating
// it, never offered to an app that cannot show it, the model told it waits for the tap), a direct
// save_item of a routine refused in the chat so nothing is saved without a tap, and the chat's own
// instructions. End to end through the chat function's handler with the evaluation's pretend
// account and a scripted model; no model API and no database are called.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../eval/harness.ts"; // Edge runtime stand-ins
import { World } from "../eval/world.ts";
import { CAN_HOME, CAN_ROUTINE, MAX_ROUTINE_TASKS, PhoneActions } from "../../supabase/functions/chat/phone_actions.ts";
import { createHandler, type LogEntry, ROUTINE_BY_CARD } from "../../supabase/functions/chat/chat.ts";
import { serverInstructions } from "../../supabase/functions/mcp/lib/assistant.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import type { ChatRequest, Message, RouteName, StreamEvent, ToolCall } from "../../supabase/functions/_shared/llm/index.ts";

const phone = (can: ReadonlySet<string> = new Set([CAN_ROUTINE])) => new PhoneActions({ can, tz: "America/New_York", now: () => Date.parse("2026-10-19T16:00:00Z") });

const WEEKEND = { name: " Weekend   house reset ", repeat: "weekly", when: "same_day", day: 6, tasks: [{ title: " Laundry " }, { title: "Vacuum", minutes: 30 }] };

// ---- save_routine ---------------------------------------------------------------------------------

Deno.test("save_routine: name, schedule and tasks checked and tidied; the card waits for the tap", () => {
  const out = phone().run("save_routine", WEEKEND);
  assertEquals(out.isError, false);
  assertEquals(out.events, [{
    type: "routine_save", name: "Weekend house reset", repeat: "weekly", when: "same_day", day: 6, suggest: true,
    tasks: [{ title: "Laundry" }, { title: "Vacuum", minutes: 30 }],
  }]);
  const told = JSON.parse(out.text);
  assertEquals(told.status, "waiting_for_user");
  assert(told.message.includes("tap Save routine") && told.message.includes("Do not also save the routine or its tasks"), told.message);
  // The defaults: any day, suggested; a monthly one by a day of the month.
  assertEquals(phone().run("save_routine", { name: "Monthly checks", repeat: "monthly", tasks: [{ title: "HVAC filter" }] }).events[0], {
    type: "routine_save", name: "Monthly checks", repeat: "monthly", when: "any_day", suggest: true, tasks: [{ title: "HVAC filter" }],
  });
  assertEquals(phone().run("save_routine", { name: "Bills", repeat: "monthly", when: "by_day", day: 28, suggest: false, tasks: [{ title: "Pay rent" }] }).events[0], {
    type: "routine_save", name: "Bills", repeat: "monthly", when: "by_day", day: 28, suggest: false, tasks: [{ title: "Pay rent" }],
  });
});

Deno.test("save_routine: anything the tap could not save is refused, with no card", () => {
  const bad: Record<string, unknown>[] = [
    { ...WEEKEND, name: "  " },
    { ...WEEKEND, name: "x".repeat(201) },
    { ...WEEKEND, repeat: "daily" },
    { ...WEEKEND, repeat: "monthly", when: "same_day" },
    { ...WEEKEND, when: "by_day", day: 3 },
    { ...WEEKEND, day: 7 },
    { ...WEEKEND, when: "same_day", day: undefined },
    { ...WEEKEND, when: "any_day", day: 2 },
    { ...WEEKEND, suggest: "yes" },
    { ...WEEKEND, tasks: [] },
    { ...WEEKEND, tasks: "laundry" },
    { ...WEEKEND, tasks: [{ title: "" }] },
    { ...WEEKEND, tasks: [{ title: "Vacuum", minutes: 0 }] },
    { ...WEEKEND, tasks: [{ title: "Vacuum", minutes: 12.5 }] },
    { ...WEEKEND, tasks: [{ title: "Vacuum", due_on: "2026-10-24" }] },
    { ...WEEKEND, tasks: Array.from({ length: MAX_ROUTINE_TASKS + 1 }, (_, i) => ({ title: `Task ${i}` })) },
  ];
  for (const input of bad) {
    const out = phone().run("save_routine", input);
    assertEquals(out.isError, true, JSON.stringify(input).slice(0, 120));
    assertEquals(out.events, [], "no card reaches the app");
  }
});

Deno.test("save_routine: a password in the name or a task is refused without repeating it (rule 9)", () => {
  for (
    const input of [
      { ...WEEKEND, name: "Wi-Fi password is hunter2hunter2" },
      { ...WEEKEND, tasks: [{ title: "Laundry" }, { title: "router admin password: Tr0ub4dor&3" }] },
      { ...WEEKEND, tasks: [{ title: "Garage PIN 2580" }] },
    ]
  ) {
    const out = phone().run("save_routine", input);
    assertEquals(out.isError, true, JSON.stringify(input));
    assertEquals(out.events, []);
    assert(!/hunter2|Tr0ub4dor|2580/.test(out.text), "the value is never repeated");
    assert(out.text.includes("Vault"));
  }
  // A task about a password, without one, is fine.
  assertEquals(phone().run("save_routine", { ...WEEKEND, tasks: [{ title: "Change the Wi-Fi password" }] }).isError, false);
});

Deno.test("save_routine: not offered to an app without \"routine\" in can; one card per message; chat-only", () => {
  const old = phone(new Set([CAN_HOME])).run("save_routine", WEEKEND);
  assertEquals(old.events, []);
  const told = JSON.parse(old.text);
  assertEquals(told.status, "app_cannot");
  assert(/updating\s+Wilma/.test(told.message) && told.message.includes("Tasks → Routines"), told.message);

  const p = phone();
  assertEquals(p.run("save_routine", WEEKEND).events.length, 1);
  assertEquals(p.run("save_routine", WEEKEND).events.length, 0);

  const registered: string[] = [];
  const fake = { registerTool: (name: string) => registered.push(name) };
  for (const r of ALL_TOOLS) r(fake as never, { db: new World().client(), userId: "u", accessToken: "t", assistantName: "Wilma", log: () => {} });
  assertFalse(registered.includes("save_routine"), "never an MCP tool");
});

Deno.test("the chat's instructions explain routines; the Claude connector's are unchanged", () => {
  const chat = serverInstructions("Wilma", "mi", { chat: true });
  assert(chat.includes("save_routine") && chat.includes("routine_id") && chat.includes("window_from"));
  assertFalse(serverInstructions("Wilma").includes("save_routine"));
  assertFalse(serverInstructions("Wilma").includes("Routines:"));
});

// ---- End to end through the chat function ------------------------------------------------------

class Account {
  world = new World();

  client(): SupabaseClient {
    const base = this.world.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
    return {
      ...base,
      rpc: (name: string, params: Record<string, unknown> = {}) => {
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
  constructor(private steps: Step[]) {}

  async *stream(route: RouteName, req: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push({ route, req: { ...req, messages: structuredClone(req.messages) } });
    let text = '{"facts":[]}';
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

function setup(steps: Step[]) {
  const account = new Account();
  const model = new Model(steps);
  const logs: LogEntry[] = [];
  const handler = createHandler({
    verifyToken: (t) => Promise.resolve(t === "good-token" ? "eval-user" : null),
    clientFor: () => account.client(),
    llm: () => ({ stream: (route, req) => model.stream(route, req) }),
    drives: () => ({ leg: () => Promise.resolve({ minutes: 15, typical_minutes: 10 }) }),
    log: (e) => {
      if (e.event === "chat") logs.push(e);
    },
    background: () => {},
    now: () => Date.parse("2026-10-19T16:00:00Z"),
  });
  return { account, model, logs, handler };
}

type Event = Record<string, unknown> & { type: string };

async function chat(s: ReturnType<typeof setup>, content: string, can: string[]): Promise<Event[]> {
  const res = await s.handler(new Request("http://localhost/functions/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good-token" },
    body: JSON.stringify({ messages: [{ role: "user", content }], can, tz: "America/New_York" }),
  }));
  assertEquals(res.status, 200);
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Event);
}

function toolResults(model: Model): string {
  const last = model.of("default").at(-1)!.req.messages;
  return last.flatMap((m: Message) => (m.role === "tool" ? m.results.map((r) => r.content) : [])).join("\n");
}

Deno.test("chat: save_routine sends the card and saves nothing", async () => {
  const s = setup([{ calls: [{ name: "save_routine", input: WEEKEND }] }, { text: "Check the card and tap Save routine." }]);
  const before = s.account.world.items.length;
  const events = await chat(s, "make my Saturday chores a weekly routine: laundry, vacuum 30 min", [CAN_ROUTINE]);
  assertEquals(events.filter((e) => e.type === "routine_save").length, 1);
  assertEquals(s.account.world.items.length, before, "nothing saved on the server: the phone saves it on the tap");
  assertEquals(s.logs[0].tools, ["save_routine"]);
});

Deno.test("chat: save_item of a routine is refused, however its type is written (the card instead)", async () => {
  const s = setup([
    {
      calls: [
        { name: "save_item", input: { title: "Weekend house reset", body: "", item_type: "routine", metadata: { repeat: "weekly" } } },
        { name: "save_item", input: { title: "Weekend house reset", body: "", item_type: " Routine ", metadata: { repeat: "weekly" } } },
      ],
    },
    { text: "Use the card." },
  ]);
  const before = s.account.world.items.length;
  await chat(s, "make a weekly routine", [CAN_ROUTINE]);
  assertEquals(s.account.world.items.length, before, "no routine saved without a tap");
  const results = toolResults(s.model);
  assertEquals(results.split(ROUTINE_BY_CARD).length - 1, 2, results);
});
