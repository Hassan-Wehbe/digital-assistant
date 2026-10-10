// Automatic memory, step 2 (docs/memory-plan.md): noticing in the chat. The server's guards
// (chat/memory.ts) on their own, then end to end through the chat function's HTTP handler with the
// evaluation's pretend account and a scripted model that answers the `memory` route separately.
// No model API and no database are called.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { IDS, World } from "../eval/world.ts";
import { createHandler, type LogEntry } from "../../supabase/functions/chat/chat.ts";
import {
  askedToRemember, factProblem, MAX_FACTS, type MemoryLog, memoryPrompt, parseFacts, sensitiveWords, todayIn, turnGuard,
  valueLike,
} from "../../supabase/functions/chat/memory.ts";
import { MEMORY_TYPE } from "../../supabase/functions/mcp/lib/memory.ts";
import { loadSpaces } from "../../supabase/functions/mcp/lib/spaces.ts";
import {
  type ChatRequest, LlmError, type Message, type RouteName, type StreamEvent, type ToolCall,
} from "../../supabase/functions/_shared/llm/index.ts";

const MEMORIES = "00000000-0000-4000-8000-0000000000e2";

// ---- The guards on their own -----------------------------------------------------------------

Deno.test("parseFacts: the agreed JSON only; at most MAX_FACTS", () => {
  assertEquals(parseFacts('{"facts":[]}'), []);
  assertEquals(parseFacts('```json\n{"facts":[{"fact":"Lexi swims on Tuesdays","sensitive":false}]}\n```'), [
    { fact: "Lexi swims on Tuesdays", sensitive: false },
  ]);
  assertEquals(parseFacts('{"facts":[{"fact":"Lexi swims on Wednesdays","replaces":"m2"}]}'), [
    { fact: "Lexi swims on Wednesdays", sensitive: false, replaces: "m2" },
  ]);
  const many = JSON.stringify({ facts: ["a b c", "d e f", "g h i", "j k l", "m n o"].map((fact) => ({ fact })) });
  assertEquals(parseFacts(many)?.length, MAX_FACTS);
  for (const bad of ["", "none", "[]", '{"facts":"Lexi"}', '{"facts":[{"text":"x"}]}', '{"facts":[1]}']) {
    assertEquals(parseFacts(bad), null, bad);
  }
});

Deno.test("valueLike: numbers and codes someone could type are never remembered", () => {
  for (const ok of ["Lexi swims at 5pm on Tuesdays", "Lexi was born in 2015", "Lexi is in 3rd grade", "Runs 10k on Sundays", "Swim class at 4:30pm"]) {
    assertFalse(valueLike(ok), ok);
  }
  for (const bad of ["Bike lock is 4821", "Garage opener hunter2sunrise", "Gym locker Sunflower2024", "Door 12-34-56", "Safe 4 8 2 1 9 3"]) {
    assert(valueLike(bad), bad);
  }
});

Deno.test("askedToRemember: the user asks for it; a question or 'I don't remember' is not asking", () => {
  for (const yes of ["Remember that I'm allergic to shellfish", "please remember Lexi has asthma", "Don't forget my mom is diabetic", "keep in mind I'm vegetarian"]) {
    assert(askedToRemember(yes), yes);
  }
  for (const no of ["Do you remember the plumber's name?", "I don't remember when Lexi swims", "I can't remember", "Lexi swims on Tuesdays"]) {
    assertFalse(askedToRemember(no), no);
  }
});

Deno.test("factProblem: credentials, vault words, values, other people's words and sensitive topics", () => {
  const f = (fact: string, sensitive = false) => ({ fact, sensitive });
  assertEquals(factProblem(f("Lexi swims on Tuesdays"), "Lexi swims on Tuesdays now"), null);
  assertEquals(factProblem(f("The Wi-Fi password is Blue-Heron-1987"), "the wifi password is Blue-Heron-1987"), "credential");
  assertEquals(factProblem(f("Keeps the alarm code on the fridge"), "I keep the alarm code on the fridge"), "vault_words");
  assertEquals(factProblem(f("Bike lock is 4821"), "my bike lock is 4821 lol"), "value_like");
  // Not something the user said (Wilma's answer, a note).
  assertEquals(factProblem(f("Sourdough needs 500 g flour"), "thanks, that's great"), "not_said");
  // Sensitive: the server's word list, or the model's flag, unless the user said remember.
  assertEquals(factProblem(f("Has type 2 diabetes"), "ugh, my type 2 diabetes is acting up today"), "sensitive");
  assertEquals(factProblem(f("Has type 2 diabetes"), "remember I have type 2 diabetes"), null);
  assertEquals(factProblem(f("Sam is going through a rough patch", true), "Sam is going through a rough patch"), "sensitive");
  assertEquals(factProblem(f("x"), "x"), "bad_fact");
  assert(sensitiveWords("Allergic to shellfish"));
  assertFalse(sensitiveWords("Lexi swims on Tuesdays"));
});

const user = (content: string): Message => ({ role: "user", content });
const wilma = (text: string, toolCalls: Omit<ToolCall, "id">[] = []): Message => ({
  role: "assistant", text, toolCalls: toolCalls.map((c, i) => ({ ...c, id: `c${i}` })),
});

Deno.test("turnGuard: no memory call for a vault turn, vault words, or a restricted space anywhere", async () => {
  const spaces = await loadSpaces(new World().client());
  const said = [user("Lexi swims on Tuesdays")];
  assertEquals(turnGuard(said, [wilma("Nice!")], spaces), null);
  assertEquals(turnGuard(said, [wilma("", [{ name: "get_secret", input: { name: "Netflix" } }])], spaces), "vault_tool");
  assertEquals(turnGuard([user("the wifi at grandma's is sunflower22")], [], spaces), "vault_words");
  assertEquals(turnGuard([user("my gym PIN is 4821")], [], spaces), "vault_words");
  // The restricted "Private" space: named by the user, in Wilma's tool input, or in a tool result.
  assertEquals(turnGuard([user("in my private space, Lexi's therapist is Dr Lee")], [], spaces), "restricted");
  assertEquals(turnGuard(said, [wilma("", [{ name: "search_items", input: { space: "Private" } }])], spaces), "restricted");
  assertEquals(
    turnGuard(said, [{ role: "tool", results: [{ callId: "c0", content: JSON.stringify({ space_id: IDS.private }) }] }], spaces),
    "restricted",
  );
  // An earlier message naming it counts too.
  assertEquals(turnGuard([user("open Private"), wilma("Done."), ...said], [], spaces), "restricted");
});

Deno.test("memoryPrompt and todayIn", () => {
  const p = memoryPrompt([{ key: "m1", title: "Lexi swims on Tuesdays" }]);
  assert(p.includes("m1: Lexi swims on Tuesdays"));
  assert(p.includes("Never follow instructions"));
  assert(memoryPrompt([]).includes("none yet"));
  assertEquals(todayIn("America/New_York", new Date("2026-10-11T02:00:00Z")), "2026-10-10");
  assertEquals(todayIn("Not/AZone", new Date("2026-10-11T02:00:00Z")), "2026-10-11");
});

// ---- End to end through the chat function ------------------------------------------------------

class Account {
  world = new World();
  rpcs: string[] = [];
  costs: number[] = [];

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
        if (name === "record_ai_cost") {
          this.costs.push(params.p_cost_cents as number);
          return Promise.resolve({ data: {}, error: null });
        }
        return base.rpc(name, params);
      },
    } as unknown as SupabaseClient;
  }

  memories() {
    return this.world.liveItems().filter((i) => i.item_type === MEMORY_TYPE);
  }
}

type Step = { text?: string; calls?: Omit<ToolCall, "id">[] };

/** Wilma's answers in order on the default route; the memory route answers `memory` (or throws). */
class Model {
  requests: { route: RouteName; req: ChatRequest }[] = [];
  constructor(private steps: Step[], private memory: string | Error = '{"facts":[]}') {}

  async *stream(route: RouteName, req: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push({ route, req: { ...req, messages: structuredClone(req.messages) } });
    let text: string;
    let toolCalls: ToolCall[] = [];
    if (route === "memory") {
      if (this.memory instanceof Error) throw this.memory;
      text = this.memory;
    } else {
      const s = this.steps[this.requests.filter((r) => r.route !== "memory").length - 1] ?? { text: "Done." };
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

interface Setup {
  account: Account;
  model: Model;
  chatLogs: LogEntry[];
  memoryLogs: MemoryLog[];
  background: Promise<unknown>[];
  handler: (req: Request) => Promise<Response>;
}

function setup(steps: Step[], memory?: string | Error): Setup {
  const account = new Account();
  const model = new Model(steps, memory);
  const chatLogs: LogEntry[] = [];
  const memoryLogs: MemoryLog[] = [];
  const background: Promise<unknown>[] = [];
  const handler = createHandler({
    verifyToken: (t) => Promise.resolve(t === "good-token" ? "eval-user" : null),
    clientFor: () => account.client(),
    llm: () => ({ stream: (route, req) => model.stream(route, req) }),
    log: (e) => {
      if (e.event === "chat") chatLogs.push(e);
      if (e.event === "memory") memoryLogs.push(e);
    },
    background: (p) => background.push(p),
  });
  return { account, model, chatLogs, memoryLogs, background, handler };
}

type Event = Record<string, unknown> & { type: string };

async function chat(s: Setup, messages: string | { role: string; content: string }[], extra: Record<string, unknown> = {}): Promise<Event[]> {
  const body = { messages: typeof messages === "string" ? [{ role: "user", content: messages }] : messages, ...extra };
  const res = await s.handler(new Request("http://localhost/functions/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good-token" },
    body: JSON.stringify(body),
  }));
  assertEquals(res.status, 200);
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Event);
}

const types = (events: Event[]) => events.map((e) => e.type);

Deno.test("memory: off (the default) means no memory call and no event", async () => {
  const s = setup([{ text: "Nice!" }], '{"facts":[{"fact":"Lexi swims on Tuesdays"}]}');
  s.account.world.memoryOn = false;
  const events = await chat(s, "Lexi swims on Tuesdays");
  assertEquals(types(events), ["text", "done"]);
  assertEquals(s.model.of("memory").length, 0);
  assertEquals(s.account.memories().length, 0);
  assertEquals(s.memoryLogs.length, 0);
});

Deno.test("memory: a fact is noticed after done, saved in Memories, and its cost recorded as cost only", async () => {
  const s = setup([{ text: "Got it, swimming on Tuesdays." }], '{"facts":[{"fact":"Lexi swims on Tuesdays","sensitive":false}]}');
  const events = await chat(s, [
    { role: "user", content: "what time is it" },
    { role: "assistant", content: "It's 5 pm." },
    { role: "user", content: "Lexi swims on Tuesdays, by the way" },
  ], { tz: "America/New_York" });
  assertEquals(types(events), ["text", "done", "remembered"]);
  const m = s.account.memories();
  assertEquals(m.map((i) => [i.title, i.space_id]), [["Lexi swims on Tuesdays", MEMORIES]]);
  assertEquals(events[2], { type: "remembered", memories: [{ id: m[0].id, fact: "Lexi swims on Tuesdays", updated: false }] });
  assertEquals((m[0].metadata as { source: string }).source, "chat");
  assertEquals(s.background.length, 1, "kept alive with EdgeRuntime.waitUntil");

  // The memory call: no tools, the newest message and its context, and the answer counted once.
  const call = s.model.of("memory")[0].req;
  assertEquals(call.tools, []);
  const content = (call.messages[0] as { content: string }).content;
  assert(content.endsWith("Newest message:\nLexi swims on Tuesdays, by the way"), content);
  assert(content.includes("Assistant: It's 5 pm."), content);
  assertFalse(content.includes("Got it, swimming"), "Wilma's new answer is never read for memories");
  assertEquals(s.account.rpcs.filter((r) => r === "record_ai_usage").length, 1);
  assertEquals(s.account.costs, [0.01]);
  assertEquals(s.chatLogs[0].counted, true);
  assertEquals(s.memoryLogs[0].outcome, "saved");
  // The log has counts and codes only, never the conversation or the fact.
  assertFalse(JSON.stringify(s.memoryLogs).includes("Lexi"));
});

Deno.test("memory: the same fact again is not saved twice, and no event is sent", async () => {
  const s = setup([{ text: "Yes." }, { text: "Yes." }], '{"facts":[{"fact":"Lexi swims on Tuesdays"}]}');
  await chat(s, "Lexi swims on Tuesdays");
  const again = await chat(s, "Lexi swims on Tuesdays");
  assertEquals(types(again), ["text", "done"]);
  assertEquals(s.account.memories().length, 1);
  assertEquals(s.memoryLogs[1].duplicates, 1);
  // The second call saw the first memory as known.
  assert(s.model.of("memory")[1].req.system!.includes("m1: Lexi swims on Tuesdays"));
});

Deno.test("memory: a changed fact replaces the known one (its old text kept as a revision)", async () => {
  const s = setup([{ text: "Noted." }, { text: "Noted." }], '{"facts":[{"fact":"Lexi swims on Tuesdays"}]}');
  await chat(s, "Lexi swims on Tuesdays");
  (s.model as unknown as { memory: string }).memory = '{"facts":[{"fact":"Lexi swims on Wednesdays","replaces":"m1"}]}';
  const events = await chat(s, "Lexi swims on Wednesdays now");
  const m = s.account.memories();
  assertEquals(m.map((i) => [i.title, i.revisions]), [["Lexi swims on Wednesdays", 1]]);
  assertEquals(events.at(-1), { type: "remembered", memories: [{ id: m[0].id, fact: "Lexi swims on Wednesdays", updated: true, was: "Lexi swims on Tuesdays" }] });
});

Deno.test("memory: a vault turn gets no memory call at all", async () => {
  const s = setup(
    [{ calls: [{ name: "get_secret", input: { name: "Netflix" } }] }, { text: "Here is the reveal link." }],
    '{"facts":[{"fact":"Has a Netflix account"}]}',
  );
  const events = await chat(s, "show my netflix login");
  assertFalse(types(events).includes("remembered"));
  assertEquals(s.model.of("memory").length, 0);
  assertEquals(s.memoryLogs[0]?.code, "vault_tool");

  const s2 = setup(
    [{ calls: [{ name: "find_secret", input: { query: "netflix" } }] }, { text: "Found it." }],
    '{"facts":[{"fact":"Watches Netflix"}]}',
  );
  await chat(s2, "do I have netflix saved?");
  assertEquals(s2.model.of("memory").length, 0);
  assertEquals(s2.memoryLogs[0].code, "vault_tool");
  assertEquals(s2.account.memories().length, 0);
});

Deno.test("memory: a turn that named or touched a restricted space gets no memory call", async () => {
  const s = setup([{ text: "OK." }], '{"facts":[{"fact":"Lexi sees Dr Lee"}]}');
  await chat(s, "put in Private that Lexi sees Dr Lee on Fridays");
  assertEquals(s.model.of("memory").length, 0);
  assertEquals(s.memoryLogs[0].code, "restricted");

  const s2 = setup([{ calls: [{ name: "list_spaces", input: {} }] }, { text: "Here are your spaces." }], '{"facts":[]}');
  await chat(s2, "what spaces do I have?");
  assertEquals(s2.model.of("memory").length, 0, "the restricted space was in a tool result");
  assertEquals(s2.memoryLogs[0].code, "restricted");
});

Deno.test("memory: a health detail is kept only when the user says remember", async () => {
  const fact = '{"facts":[{"fact":"Is allergic to shellfish","sensitive":true}]}';
  const s = setup([{ text: "Oh no!" }], fact);
  await chat(s, "ugh, I'm allergic to shellfish and the restaurant forgot");
  assertEquals(s.account.memories().length, 0);
  assertEquals(s.memoryLogs[0].dropped, { sensitive: 1 });

  const s2 = setup([{ text: "I'll remember." }], fact);
  const events = await chat(s2, "remember that I'm allergic to shellfish");
  assertEquals(s2.account.memories().map((i) => i.title), ["Is allergic to shellfish"]);
  assertEquals(types(events).at(-1), "remembered");
});

Deno.test("memory: a value the model picked up anyway is dropped by the server", async () => {
  const s = setup(
    [{ text: "Ha, nice story." }],
    JSON.stringify({ facts: [{ fact: "Old bike lock combination 4821" }, { fact: "Bike lock was 4821" }, { fact: "Had a red bike as a kid" }] }),
  );
  await chat(s, "funny, my old bike lock was 4821 and I had a red bike as a kid");
  assertEquals(s.account.memories().map((i) => i.title), ["Had a red bike as a kid"]);
  for (const i of s.account.memories()) assertFalse(World.text(i).includes("4821"));
  assertEquals(s.memoryLogs[0].dropped, { credential: 1, value_like: 1 });
});

Deno.test("memory: a credential in the message never reaches any model, memory included", async () => {
  const s = setup([{ text: "unused" }], '{"facts":[{"fact":"x y z"}]}');
  const events = await chat(s, "my netflix password is hunter2sunrise");
  assertEquals(types(events), ["text", "done"]);
  assertEquals(s.model.requests.length, 0);
});

Deno.test("memory: a failing or odd memory model changes nothing for the answer", async () => {
  for (const memory of [new LlmError("openai", "server_error", 500, true), "Sure! Lexi swims on Tuesdays."]) {
    const s = setup([{ text: "Nice!" }], memory);
    const events = await chat(s, "Lexi swims on Tuesdays");
    assertEquals(types(events), ["text", "done"]);
    assertEquals(events[1], { type: "done", counted: true });
    assertEquals(s.account.memories().length, 0);
    assertEquals(s.memoryLogs[0].outcome, "none");
    assert(s.memoryLogs[0].code === "llm:server_error" || s.memoryLogs[0].code === "bad_answer", s.memoryLogs[0].code);
  }
});

Deno.test("memory: not for a message the app will send again with the calendar", async () => {
  const s = setup([{ calls: [{ name: "get_day_agenda", input: { from: "2026-10-10" } }] }], '{"facts":[{"fact":"Lexi swims on Tuesdays"}]}');
  const events = await chat(s, "Lexi swims on Tuesdays, what's on today?", { can: ["calendar"], tz: "UTC" });
  assert(types(events).includes("agenda_request"));
  assertEquals(s.model.of("memory").length, 0);
});

Deno.test("memory: saved even when the app stops reading at done", async () => {
  const s = setup([{ text: "Nice!" }], '{"facts":[{"fact":"Our plumber is Mike"}]}');
  const res = await s.handler(new Request("http://localhost/functions/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good-token" },
    body: JSON.stringify({ messages: [{ role: "user", content: "our plumber is Mike" }] }),
  }));
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let got = "";
  while (!got.includes('"done"')) got += (await reader.read()).value ?? "";
  await reader.cancel();
  // The job the instance was kept alive for.
  while (!s.background.length) await new Promise((r) => setTimeout(r, 5));
  await Promise.all(s.background);
  assertEquals(s.account.memories().map((i) => i.title), ["Our plumber is Mike"]);
});

Deno.test("memory: what was remembered is in Wilma's instructions from the next message on (step 4), never with memory off", async () => {
  const s = setup([{ text: "Nice!" }, { text: "At 5." }, { text: "Hm." }], '{"facts":[{"fact":"Lexi swims on Tuesdays"}]}');
  await chat(s, "Lexi swims on Tuesdays");
  assert(!s.model.of("default")[0].req.system!.includes("About the user"), "nothing remembered yet");
  await chat(s, "what time does she swim?");
  const system = s.model.of("default")[1].req.system!;
  assert(system.includes("About the user"), system.slice(-400));
  assert(system.includes("- Lexi swims on Tuesdays"));
  // The noticing call never gets them as instructions, only as known memories to compare with.
  s.account.world.memoryOn = false;
  await chat(s, "and on Fridays?");
  assert(!s.model.of("default")[2].req.system!.includes("About the user"));
});
