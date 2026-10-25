// Usage tracking, step 2 (docs/usage-tracking-plan.md; D34): the per-request meter turns model
// answers and log lines into counts (never content); a suggestion made inside a chat message counts
// as a suggestion and the rest as chat; My day from the app and from the chat are told apart; Mapbox
// and weather calls, fair-use hits and errors are counted; rows are merged and clipped to the
// database's limits; the MCP server counts tools by name, never their arguments; a failed write
// never breaks a reply; and a whole request on the pretend account writes only counts.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatRequest, Llm, StreamEvent, Usage } from "../../supabase/functions/_shared/llm/index.ts";
import { meterLlm, recordRows, toolCallRows, UsageMeter, usageName } from "../../supabase/functions/_shared/usage.ts";
import "../eval/harness.ts"; // Edge runtime stand-ins (Supabase.ai, EdgeRuntime, embed-pending fetch)
import { World } from "../eval/world.ts";
import { createHandler } from "../../supabase/functions/chat/chat.ts";

const U = (input: number, output: number, cents: number, cached = 0, written = 0): Usage =>
  ({ inputTokens: input, cacheReadTokens: cached, cacheWriteTokens: written, outputTokens: output, costCents: cents });
const DETAIL = /^[a-z0-9._:/-]{0,60}$/;

Deno.test("usageName: a model or tool name in the database's short shape", () => {
  assertEquals(usageName("GPT-6 Luna (2026)"), "gpt-6-luna-2026");
  assertEquals(usageName("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assertEquals(usageName("x".repeat(80)).length, 60);
});

Deno.test("meter: a suggestion inside a chat message counts as a suggestion, the rest as chat", () => {
  const m = new UsageMeter();
  m.origin = "chat";
  m.modelAnswered("gpt-6-luna", U(1000, 50, 0.1, 400, 100));
  m.modelAnswered("gpt-6-luna", U(300, 20, 0.04));
  m.logged({ event: "recipe_suggest", outcome: "ok" });
  m.modelAnswered("gpt-6-luna", U(800, 60, 0.08));
  m.logged({ event: "chat", outcome: "ok", tools: ["suggest_meal", "save_item", "search_items", "save_item"] });
  const rows = m.rows();
  const row = (kind: string, detail?: string) => rows.find((r) => r.kind === kind && (r.detail ?? "") === (detail ?? ""));
  assertEquals(row("recipe_suggest", "gpt-6-luna"), {
    kind: "recipe_suggest", detail: "gpt-6-luna", model_calls: 2, input_tokens: 1400, cached_tokens: 400, output_tokens: 70, cost_cents: 0.14,
  });
  assertEquals(row("recipe_suggest")?.count, 1);
  assertEquals(row("chat", "gpt-6-luna"), { kind: "chat", detail: "gpt-6-luna", model_calls: 1, input_tokens: 800, output_tokens: 60, cost_cents: 0.08 });
  assertEquals([row("chat")?.count, row("message")?.count, row("save")?.count, row("search")?.count], [1, 1, 2, 1]);
  for (const r of rows) assert(DETAIL.test(r.detail ?? ""), JSON.stringify(r));
});

Deno.test("meter: My day from the app or the chat, Mapbox and weather, fair use and errors", () => {
  const app = new UsageMeter();
  app.logged({ event: "day", outcome: "ok", drive_requests: 4, drive_failures: 1, weather_requests: 2 });
  assertEquals(app.rows(), [
    { kind: "day_plan", detail: "my_day", count: 1 },
    { kind: "mapbox", count: 4, failures: 1 },
    { kind: "weather", count: 2 },
  ]);
  const chat = new UsageMeter();
  chat.origin = "chat";
  chat.logged({ event: "day", outcome: "ok" });
  chat.logged({ event: "outing", outcome: "fair_use" });
  chat.logged({ event: "recipe_suggest", outcome: "limit" });
  chat.logged({ event: "chat", outcome: "connection" });
  chat.logged({ event: "chat", outcome: "allowance_used" });
  const rows = chat.rows();
  assert(rows.some((r) => r.kind === "day_plan" && r.detail === "chat"));
  assertEquals(rows.filter((r) => r.kind === "fair_use_hit").map((r) => r.detail).sort(), ["ai_allowance", "outing", "recipe_suggest"]);
  assertEquals(rows.find((r) => r.kind === "error"), { kind: "error", detail: "chat:connection", count: 1 });
  // A bad request is not a message.
  const bad = new UsageMeter();
  bad.logged({ event: "chat", outcome: "bad_request" });
  assertEquals(bad.rows(), []);
});

Deno.test("meter: memory noticing and memories kept; reading recipes by text or picture; an unclaimed answer is chat", () => {
  const m = new UsageMeter();
  m.modelAnswered("mini", U(100, 10, 0.01));
  m.logged({ event: "memory", outcome: "saved", saved: 2 });
  m.logged({ event: "recipe_from_image", outcome: "ok" });
  m.modelAnswered("mini", U(10, 1, 0.001));
  const rows = m.rows();
  assert(rows.some((r) => r.kind === "memory" && r.detail === "mini" && r.model_calls === 1));
  assertEquals(rows.find((r) => r.kind === "memory_kept")?.count, 2);
  assertEquals(rows.find((r) => r.kind === "recipe_import")?.detail, "image");
  assert(rows.some((r) => r.kind === "chat" && r.detail === "mini"), "answers no line claimed");
});

Deno.test("meter: merged by kind and detail, clipped to the database's limits, at most 20 rows", () => {
  const m = new UsageMeter();
  for (let i = 0; i < 150; i++) m.logged({ event: "classify", outcome: "search" });
  m.modelAnswered("big", U(3_000_000, 10, 7));
  m.logged({ event: "classify", outcome: "search" });
  const rows = m.rows();
  assertEquals(rows.find((r) => r.kind === "classify" && !r.detail)?.count, 100);
  const big = rows.find((r) => r.detail === "big")!;
  assertEquals([big.input_tokens, big.cost_cents], [2_000_000, 5]);
  const many = new UsageMeter();
  for (let i = 0; i < 30; i++) many.logged({ event: "chat", outcome: "ok", tools: [] , code: undefined } as never), many.modelAnswered(`m${i}`, U(1, 1, 0));
  assert(many.rows().length <= 20);
});

Deno.test("meterLlm: the model's name from the routes (memory falls back to the router's), answers passed through", async () => {
  const meter = new UsageMeter();
  const inner = {
    routes: { default: { model: "gpt-6-luna" }, router: { model: "gpt-6-mini" } },
    async *stream(_r: string, _q: ChatRequest): AsyncGenerator<StreamEvent> {
      yield { type: "text", text: "hi" } as StreamEvent;
      yield { type: "done", turn: { role: "assistant", text: "hi", toolCalls: [] }, stop: "end", usage: U(10, 2, 0.01) } as StreamEvent;
    },
  } as unknown as Llm;
  const llm = meterLlm(inner, meter);
  const seen: string[] = [];
  for await (const ev of llm.stream("default", { system: "", messages: [], tools: [] } as unknown as ChatRequest)) seen.push(ev.type);
  for await (const _ of llm.stream("memory" as never, { system: "", messages: [], tools: [] } as unknown as ChatRequest)) { /* drain */ }
  assertEquals(seen, ["text", "done"]);
  meter.logged({ event: "classify" });
  assertEquals(meter.rows().filter((r) => r.detail).map((r) => r.detail).sort(), ["gpt-6-luna", "gpt-6-mini"]);
});

Deno.test("MCP: tools counted by name, saves and searches, never the arguments", () => {
  const rows = toolCallRows([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save_item", arguments: { title: "Wi-Fi password is hunter2rocks" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_items", arguments: { query: "boiler" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "save_item", arguments: {} } },
  ]);
  assertEquals(rows, [
    { kind: "mcp_call", detail: "save_item", count: 2 },
    { kind: "save", count: 2 },
    { kind: "mcp_call", detail: "search_items", count: 1 },
    { kind: "search", count: 1 },
  ]);
  assertFalse(JSON.stringify(rows).includes("hunter2"));
  assertEquals(toolCallRows(null), []);
  assertEquals(toolCallRows({ method: "initialize" }), []);
});

Deno.test("a failed write never throws: it is reported for the log line", async () => {
  const failing = { rpc: () => Promise.resolve({ data: null, error: { code: "22023", message: "x" } }) } as unknown as SupabaseClient;
  assertEquals(await recordRows(failing, [{ kind: "save", count: 1 }]), { rows: 1, ok: false, code: "db:22023" });
  const throwing = { rpc: () => Promise.reject(new TypeError("offline")) } as unknown as SupabaseClient;
  assertEquals(await recordRows(throwing, [{ kind: "save", count: 1 }]), { rows: 1, ok: false, code: "TypeError" });
  assertEquals(await recordRows(failing, []), { rows: 0, ok: true });
});

// ---- A whole request on the pretend account ------------------------------------------------------

function handler(w: World, answer: string) {
  const background: Promise<unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const h = createHandler({
    verifyToken: (t) => Promise.resolve(t === "tok" ? "eval-user" : null),
    clientFor: () => w.client() as unknown as SupabaseClient,
    llm: () => ({
      routes: { default: { model: "gpt-6-luna" }, router: { model: "gpt-6-mini" } },
      async *stream(): AsyncGenerator<StreamEvent> {
        yield { type: "done", turn: { role: "assistant", text: answer, toolCalls: [] }, stop: "end", usage: U(900, 40, 0.07) } as StreamEvent;
      },
    } as unknown as Llm),
    log: (e) => logs.push(e as unknown as Record<string, unknown>),
    background: (p) => background.push(p),
  });
  const post = async (body: unknown) => {
    const res = await h(new Request("http://localhost/chat", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok" }, body: JSON.stringify(body),
    }));
    await res.text();
    await Promise.all(background);
  };
  return { post, logs };
}

Deno.test("a chat message writes its counts after the reply, and never its words", async () => {
  const w = new World();
  const { post, logs } = handler(w, "Your dentist is on Tuesday.");
  await post({ messages: [{ role: "user", content: "When is my dentist appointment with Dr Haddad?" }] });
  const rows = w.usage as { kind: string; detail?: string; count?: number; model_calls?: number }[];
  assert(rows.some((r) => r.kind === "message" && r.count === 1), JSON.stringify(rows));
  assert(rows.some((r) => r.kind === "chat" && r.detail === "gpt-6-luna" && (r.model_calls ?? 0) >= 1), JSON.stringify(rows));
  const sent = JSON.stringify(rows);
  for (const word of ["dentist", "Haddad", "Tuesday"]) assertFalse(sent.includes(word), word);
  assertFalse(logs.some((l) => l.event === "usage"), "written fine");
});

Deno.test("a message held as a password writes only that a message was sent", async () => {
  const w = new World();
  const { post } = handler(w, "unused");
  await post({ messages: [{ role: "user", content: "my bank card pin is 0937" }] });
  const sent = JSON.stringify(w.usage);
  assertFalse(sent.includes("0937"));
  assert(w.usage.some((r) => r.kind === "message"));
  assertFalse(w.usage.some((r) => r.model_calls), "no model call");
});

Deno.test("a write that fails is logged as counts only and the reply is unchanged", async () => {
  const w = new World();
  const base = w.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
  const client = { ...(w.client() as unknown as Record<string, unknown>), rpc: (n: string, p: Record<string, unknown> = {}) =>
    n === "record_usage" ? Promise.resolve({ data: null, error: { code: "42501", message: "no" } }) : base.rpc(n, p) };
  const background: Promise<unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const h = createHandler({
    verifyToken: () => Promise.resolve("eval-user"),
    clientFor: () => client as unknown as SupabaseClient,
    llm: () => ({ async *stream(): AsyncGenerator<StreamEvent> {
      yield { type: "text", text: "Hello." } as StreamEvent;
      yield { type: "done", turn: { role: "assistant", text: "Hello.", toolCalls: [] }, stop: "end", usage: U(1, 1, 0) } as StreamEvent;
    } } as unknown as Llm),
    log: (e) => logs.push(e as unknown as Record<string, unknown>),
    background: (p) => background.push(p),
  });
  const res = await h(new Request("http://localhost/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  }));
  const text = await res.text();
  await Promise.all(background);
  assert(text.includes("Hello."), text);
  const failed = logs.find((l) => l.event === "usage");
  assertEquals(failed && { outcome: failed.outcome, code: failed.code }, { outcome: "failed", code: "db:42501" });
});
