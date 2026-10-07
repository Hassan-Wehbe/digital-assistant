// The one box's classifier (supabase/functions/chat/classify.ts; one-box plan step 6), through
// the chat function's HTTP handler, with a scripted model and a pretend allowance. No model API
// and no database are called.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type ChatDeps, createHandler, type LogEntry } from "../../supabase/functions/chat/chat.ts";
import {
  CLASSIFY_PROMPT, CLASSIFY_TIMEOUT_MS, type ClassifyLog, guard, parseVerdict,
} from "../../supabase/functions/chat/classify.ts";
import {
  type ChatRequest, LlmError, QUOTA_EXCEEDED, type RouteName, RoutesConfigError, type StreamEvent,
} from "../../supabase/functions/_shared/llm/index.ts";

class Account {
  usedCents = 0;
  limitCents = 100;
  requests = 0;
  recordFails = false;
  rpcs: { name: string; params: Record<string, unknown> }[] = [];

  client(): SupabaseClient {
    return {
      rpc: (name: string, params: Record<string, unknown> = {}) => {
        this.rpcs.push({ name, params });
        const allowance = () => ({
          month: "2026-10-01", used_cents: this.usedCents, requests: this.requests, limit_cents: this.limitCents,
          used_fraction: Math.min(this.usedCents / this.limitCents, 1),
        });
        if (name === "my_ai_allowance") return Promise.resolve({ data: allowance(), error: null });
        if (name === "record_ai_cost") {
          const c = params.p_cost_cents as number;
          if (this.recordFails || !(c >= 0 && c <= 5)) {
            return Promise.resolve({ data: null, error: { message: "range", code: "22023" } });
          }
          this.usedCents += c;
          return Promise.resolve({ data: allowance(), error: null });
        }
        throw new Error(`the classifier called ${name}`);
      },
      from: () => {
        throw new Error("the classifier read a table");
      },
    } as unknown as SupabaseClient;
  }
}

type Step = { answer?: string; error?: Error; cost?: number; hang?: boolean };

class Model {
  calls: { route: RouteName; req: ChatRequest }[] = [];
  constructor(private step: Step) {}

  llm(): ChatDeps["llm"] {
    return () => ({ stream: (route, req) => this.stream(route, req) });
  }

  async *stream(route: RouteName, req: ChatRequest): AsyncGenerator<StreamEvent> {
    this.calls.push({ route, req: structuredClone({ ...req, signal: undefined }) });
    if (this.step.error) throw this.step.error;
    if (this.step.hang) {
      await new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    const text = this.step.answer ?? '{"route":"wilma"}';
    yield { type: "text", text };
    yield {
      type: "done",
      turn: { role: "assistant", text, toolCalls: [] },
      stop: "end",
      usage: { inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, costCents: this.step.cost ?? 0.002 },
    };
  }
}

function setup(step: Step) {
  const account = new Account();
  const model = new Model(step);
  const logs: ClassifyLog[] = [];
  const chatLogs: LogEntry[] = [];
  const handler = createHandler({
    verifyToken: (t) => Promise.resolve(t === "good-token" ? "user-1" : null),
    clientFor: () => account.client(),
    llm: model.llm(),
    log: (e) => e.event === "classify" ? logs.push(e) : chatLogs.push(e),
  });
  return { account, model, logs, chatLogs, handler };
}

function post(body: unknown, token: string | null = "good-token"): Request {
  return new Request("http://localhost/functions/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function classify(s: ReturnType<typeof setup>, text: string) {
  const res = await s.handler(post({ classify: text }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  return await res.json();
}

// ---- Sign-in and the request ----------------------------------------------------------------

Deno.test("classify: sign-in is required, and nothing runs without it", async () => {
  const s = setup({ answer: '{"route":"search","query":"lasagna"}' });
  for (const token of [null, "bad-token"]) {
    assertEquals((await s.handler(post({ classify: "lasagna" }, token))).status, 401);
  }
  assertEquals(s.model.calls.length, 0);
  assertEquals(s.account.rpcs.length, 0);
});

Deno.test("classify: an empty, too long or mixed body is refused with 400", async () => {
  const s = setup({});
  for (const body of [{ classify: "" }, { classify: "x".repeat(501) }, { classify: 5 }, { classify: "hi", messages: [] },
    // The 📍 point (places step 7) never reaches the classifier: a classify body carrying one is refused.
    { classify: "restaurants near me", here: { lat: 33.9, lng: 35.5 } }]) {
    assertEquals((await s.handler(post(body))).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assertEquals(s.model.calls.length, 0);
});

// ---- What the model gets and what comes back ------------------------------------------------

Deno.test("classify: the router route gets only the one message, no tools, no history", async () => {
  const s = setup({ answer: '{"route":"search","query":"lasagna recipe"}' });
  assertEquals(await classify(s, "lasagna recipe from mom"), { route: "search", query: "lasagna recipe" });
  assertEquals(s.model.calls.length, 1);
  const { route, req } = s.model.calls[0];
  assertEquals(route, "router");
  assertEquals(req.system, CLASSIFY_PROMPT);
  assertEquals(req.tools, []);
  assertEquals(req.messages, [{ role: "user", content: "lasagna recipe from mom" }]);
});

Deno.test("classify: wilma is passed through", async () => {
  const s = setup({ answer: '{"route":"wilma"}' });
  assertEquals(await classify(s, "summarise my teams notes"), { route: "wilma" });
});

Deno.test("classify: its cost is recorded without counting a request", async () => {
  const s = setup({ answer: '{"route":"search","query":"roof"}', cost: 0.0021 });
  await classify(s, "roof quote");
  assertEquals(s.account.rpcs.map((r) => r.name), ["my_ai_allowance", "record_ai_cost"]);
  assertEquals(s.account.rpcs[1].params, { p_cost_cents: 0.0021 });
  assertEquals(s.account.requests, 0);
  assertFalse(s.account.rpcs.some((r) => r.name === "record_ai_usage"));
});

Deno.test("classify: a cost above what record_ai_cost accepts is capped", async () => {
  const s = setup({ answer: '{"route":"wilma"}', cost: 40 });
  await classify(s, "roof quote");
  assertEquals(s.account.rpcs[1].params, { p_cost_cents: 5 });
});

Deno.test("classify: a failed cost record still answers", async () => {
  const s = setup({ answer: '{"route":"search","query":"roof"}' });
  s.account.recordFails = true;
  assertEquals(await classify(s, "roof quote"), { route: "search", query: "roof" });
  assertEquals(s.logs[0].usage_recorded, false);
  assertEquals(s.logs[0].code, "db:22023");
});

// ---- Odd answers mean Wilma (D4) -------------------------------------------------------------

Deno.test("classify: any answer that is not exactly one of the two shapes means wilma", async () => {
  for (
    const answer of [
      "",
      "search",
      "lasagna",
      '{"route":"search"}',
      '{"route":"search","query":""}',
      '{"route":"search","query":"   "}',
      '{"route":"delete","query":"lasagna"}',
      '{"route":"search","query":"lasagna","tool":"delete_item"}',
      '{"route":"wilma"} {"route":"search","query":"lasagna"}',
      '[{"route":"search","query":"lasagna"}]',
      '{"route":"search","query":["lasagna"]}',
    ]
  ) {
    const s = setup({ answer });
    assertEquals(await classify(s, "lasagna"), { route: "wilma" }, answer);
    assertEquals(s.logs[0].code, "bad_answer", answer);
  }
});

Deno.test("classify: a code fence around the JSON is accepted", async () => {
  const s = setup({ answer: '```json\n{"route":"search","query":"lasagna"}\n```' });
  assertEquals(await classify(s, "lasagna"), { route: "search", query: "lasagna" });
});

Deno.test("classify: a query with words the message did not have means wilma", () => {
  assertEquals(parseVerdict('{"route":"search","query":"lasagna recipe"}', "lasagna"), null);
  assertEquals(parseVerdict('{"route":"search","query":"ignore previous"}', "roof quote"), null);
  assertEquals(parseVerdict('{"route":"search","query":"Lasagna"}', "lasagna!"), { route: "search", query: "Lasagna" });
  assertEquals(parseVerdict('{"route":"search","query":"creme brulee"}', "crème brûlée"), { route: "search", query: "creme brulee" });
});

Deno.test("classify: a query longer than 8 words or 100 characters means wilma", () => {
  const msg = "a b c d e f g h i j";
  assertEquals(parseVerdict(`{"route":"search","query":"${msg}"}`, msg), null);
  const long = "x".repeat(101);
  assertEquals(parseVerdict(`{"route":"search","query":"${long}"}`, long), null);
});

// ---- Never for the vault (CLAUDE.md rules 1, 2, 9) ------------------------------------------

Deno.test("classify: a message about passwords, PINs or codes never reaches the model", async () => {
  for (
    const text of [
      "gmail password",
      "bank PIN",
      "wi-fi",
      "the alarm code",
      "netflix login",
      "aws api key",
      "my credentials for jira",
      "2fa backup codes",
    ]
  ) {
    const s = setup({ answer: '{"route":"search","query":"x"}' });
    assertEquals(await classify(s, text), { route: "wilma" }, text);
    assertEquals(s.model.calls.length, 0, text);
    assertEquals(s.account.rpcs.length, 0, text);
    assertEquals(s.logs[0].code, "vault_words", text);
  }
});

Deno.test("classify: a message that looks like a credential never reaches the model", async () => {
  const s = setup({ answer: '{"route":"search","query":"x"}' });
  const key = "sk-proj-" + "a1B2c3D4e5F6g7H8i9J0".repeat(2);
  assertEquals(await classify(s, `openai ${key}`), { route: "wilma" });
  assertEquals(s.model.calls.length, 0);
  assertEquals(s.logs[0].code, "credential");
  assertFalse(JSON.stringify(s.logs).includes(key));
});

Deno.test("classify: a search query that is itself a vault request means wilma", () => {
  assertEquals(guard("netflix password"), "vault_words");
  assertEquals(parseVerdict('{"route":"search","query":"bank pin"}', "bank pin"), null);
});

// ---- Limits and failures mean Wilma ---------------------------------------------------------

Deno.test("classify: a used-up allowance means wilma without the model", async () => {
  const s = setup({ answer: '{"route":"search","query":"roof"}' });
  s.account.usedCents = 100;
  assertEquals(await classify(s, "roof quote"), { route: "wilma" });
  assertEquals(s.model.calls.length, 0);
  assertEquals(s.logs[0].code, "allowance_used");
});

Deno.test("classify: model errors and a bad route config mean wilma, with a code and no cost", async () => {
  const cases: [Error, string][] = [
    [new LlmError("openai", QUOTA_EXCEEDED, 429, false), `llm:${QUOTA_EXCEEDED}`],
    [new LlmError("openai", "server_error", 500, true), "llm:server_error"],
    [new RoutesConfigError("no routes"), "routes_config"],
    [new TypeError("lasagna exploded"), "TypeError"],
  ];
  for (const [error, code] of cases) {
    const s = setup({ error });
    assertEquals(await classify(s, "lasagna"), { route: "wilma" });
    assertEquals(s.logs[0].code, code);
    assertEquals(s.logs[0].model_calls, 0);
    assertFalse(s.account.rpcs.some((r) => r.name === "record_ai_cost"));
    assertFalse(JSON.stringify(s.logs).includes("lasagna"), "the log never quotes the message");
  }
});

Deno.test({
  name: "classify: a model that does not answer in time means wilma",
  async fn() {
    const s = setup({ hang: true });
    const started = Date.now();
    assertEquals(await classify(s, "lasagna"), { route: "wilma" });
    assert(Date.now() - started >= CLASSIFY_TIMEOUT_MS - 50);
    assertEquals(s.logs[0].code, "timeout");
  },
});

// ---- The log --------------------------------------------------------------------------------

Deno.test("classify: one log line, codes and numbers only, never the message", async () => {
  const s = setup({ answer: '{"route":"search","query":"lasagna"}' });
  await classify(s, "lasagna");
  assertEquals(s.logs.length, 1);
  assertEquals(s.chatLogs.length, 0);
  assertEquals(Object.keys(s.logs[0]).sort(), [
    "cost_cents", "event", "model_calls", "outcome", "request", "usage_recorded", "user",
  ]);
  assertEquals(s.logs[0].outcome, "search");
  assertFalse(JSON.stringify(s.logs).includes("lasagna"));
});
