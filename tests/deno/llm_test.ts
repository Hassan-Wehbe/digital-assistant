// The provider-neutral llm module (docs/design.md D21): both adapters translate the same
// conversation, stream text, return tool calls only in the final turn, and report usage in
// cents. Fake clients only: no network, no API keys, no cost.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import OpenAI from "npm:openai@7.25.0";
import {
  type ChatRequest,
  costCents,
  createLlm,
  LlmError,
  type Message,
  missingKeys,
  type ModelConfig,
  parseRoutes,
  type Routes,
  RoutesConfigError,
  type StreamEvent,
} from "../../supabase/functions/_shared/llm/index.ts";
import { AnthropicAdapter, type AnthropicLike } from "../../supabase/functions/_shared/llm/anthropic.ts";
import { OpenAIAdapter, type OpenAILike } from "../../supabase/functions/_shared/llm/openai.ts";

const PRICE = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }; // USD per million tokens
const CLAUDE: ModelConfig = { provider: "anthropic", model: "claude-test", price: PRICE, maxOutputTokens: 4096 };
const GPT: ModelConfig = { provider: "openai", model: "gpt-test", price: PRICE, maxOutputTokens: 4096 };

const TOOLS = [{
  name: "search_items",
  description: "Search notes",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
}];

/** A conversation with one finished tool round, then a new question. */
const HISTORY: Message[] = [
  { role: "user", content: "find my soup recipe" },
  {
    role: "assistant",
    text: "Looking.",
    toolCalls: [{ id: "call_1", name: "search_items", input: { query: "soup" } }],
    native: {
      provider: "anthropic",
      model: "claude-test",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "call_1", name: "search_items", input: { query: "soup" } },
      ],
    },
  },
  { role: "tool", results: [{ callId: "call_1", content: "[]" }, { callId: "call_x", content: "boom", isError: true }] },
  { role: "user", content: "and the bread?" },
];
const REQ: ChatRequest = { system: "You are Wilma.", messages: HISTORY, tools: TOOLS };

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const texts: string[] = [];
  let done: Extract<StreamEvent, { type: "done" }> | undefined;
  for await (const ev of gen) {
    if (ev.type === "text") texts.push(ev.text);
    else done = ev;
  }
  return { texts, done: done! };
}

// ---- Fake clients ---------------------------------------------------------------------------

function fakeAnthropic(message: Partial<Anthropic.Message>, deltas: string[] = [], fail?: unknown) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client: AnthropicLike = {
    messages: {
      stream(params) {
        calls.push(params);
        const events = deltas.map((text, index) => ({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text },
        }) as Anthropic.MessageStreamEvent);
        return {
          async *[Symbol.asyncIterator]() {
            if (fail) throw fail;
            yield* events;
          },
          finalMessage: () =>
            Promise.resolve({
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: params.model,
              content: [],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
              ...message,
            } as Anthropic.Message),
        };
      },
    },
  };
  return { client, calls };
}

function fakeOpenAI(events: unknown[], fail?: unknown) {
  const calls: OpenAI.Responses.ResponseCreateParamsStreaming[] = [];
  const client: OpenAILike = {
    responses: {
      create(params) {
        calls.push(params);
        if (fail) return Promise.reject(fail);
        return Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield* events as OpenAI.Responses.ResponseStreamEvent[];
          },
        });
      },
    },
  };
  return { client, calls };
}

function response(over: Record<string, unknown>) {
  return {
    id: "resp_1",
    status: "completed",
    incomplete_details: null,
    output: [],
    usage: {
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    },
    ...over,
  };
}

// ---- Cost ------------------------------------------------------------------------------------

Deno.test("costCents: tokens times price per million, in cents", () => {
  // 1M uncached input at $1 + 1M output at $5 + 1M cache reads at $0.10 + 1M writes at $1.25
  const c = costCents(PRICE, { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6 });
  assertEquals(Math.round(c * 1000) / 1000, 735);
  const small = costCents(PRICE, { inputTokens: 2000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assertEquals(Math.round(small * 1e6) / 1e6, 0.35);
});

// ---- Anthropic -------------------------------------------------------------------------------

Deno.test("anthropic: streams text, returns tool calls in the final turn, usage in cents", async () => {
  const { client } = fakeAnthropic({
    content: [
      { type: "text", text: "Hello there", citations: null },
      { type: "tool_use", id: "toolu_1", name: "search_items", input: { query: "bread" }, caller: { type: "direct" } },
    ] as Anthropic.ContentBlock[],
    stop_reason: "tool_use",
    usage: {
      input_tokens: 2000,
      output_tokens: 300,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 400,
    } as Anthropic.Usage,
  }, ["Hello", " there"]);
  const { texts, done } = await collect(new AnthropicAdapter(client).stream(CLAUDE, REQ));
  assertEquals(texts, ["Hello", " there"]);
  assertEquals(done.stop, "tool_calls");
  assertEquals(done.turn.text, "Hello there");
  assertEquals(done.turn.toolCalls, [{ id: "toolu_1", name: "search_items", input: { query: "bread" } }]);
  assertEquals(done.turn.native?.provider, "anthropic");
  assertEquals(done.usage.inputTokens, 2000);
  assertEquals(done.usage.cacheReadTokens, 10_000);
  assertEquals(done.usage.cacheWriteTokens, 400);
  // 2000*1 + 300*5 + 10000*0.1 + 400*1.25 = 5000 per million dollars = 0.5 cents
  assertEquals(Math.round(done.usage.costCents * 1e6) / 1e6, 0.5);
});

Deno.test("anthropic: request shape (system, cache, tools, effort only when set)", async () => {
  const { client, calls } = fakeAnthropic({});
  await collect(new AnthropicAdapter(client).stream(CLAUDE, REQ));
  const p = calls[0];
  assertEquals(p.model, "claude-test");
  assertEquals(p.max_tokens, 4096);
  assertEquals(p.system, "You are Wilma.");
  assertEquals(p.cache_control, { type: "ephemeral" });
  assertEquals(p.tools as unknown, [{ name: "search_items", description: "Search notes", input_schema: TOOLS[0].inputSchema }]);
  assertEquals("output_config" in p, false);

  await collect(new AnthropicAdapter(client).stream({ ...CLAUDE, effort: "low" }, REQ));
  assertEquals(calls[1].output_config, { effort: "low" });
});

Deno.test("anthropic: same model replays its own blocks; tool results go back in one message", async () => {
  const { client, calls } = fakeAnthropic({});
  await collect(new AnthropicAdapter(client).stream(CLAUDE, REQ));
  const msgs = calls[0].messages;
  assertEquals(msgs.length, 4);
  assertEquals(msgs[1].content, HISTORY[1].role === "assistant" ? HISTORY[1].native!.content : null);
  assertEquals(msgs[2], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "call_1", content: "[]" },
      { type: "tool_result", tool_use_id: "call_x", content: "boom", is_error: true },
    ],
  });
});

Deno.test("anthropic: another model's turn is rebuilt from text and tool calls (no thinking blocks)", async () => {
  const { client, calls } = fakeAnthropic({});
  await collect(new AnthropicAdapter(client).stream({ ...CLAUDE, model: "claude-other" }, REQ));
  assertEquals(calls[0].messages[1], {
    role: "assistant",
    content: [
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "call_1", name: "search_items", input: { query: "soup" } },
    ],
  });
});

Deno.test("anthropic: stop reasons map to max_tokens, refused, end", async () => {
  for (const [reason, stop] of [["max_tokens", "max_tokens"], ["refusal", "refused"], ["end_turn", "end"], ["pause_turn", "other"]]) {
    const { client } = fakeAnthropic({ stop_reason: reason as Anthropic.StopReason });
    const { done } = await collect(new AnthropicAdapter(client).stream(CLAUDE, REQ));
    assertEquals(done.stop, stop, reason);
  }
});

Deno.test("anthropic: API errors become LlmError without the provider's message text", async () => {
  const apiErr = Anthropic.APIError.generate(
    429,
    { type: "error", error: { type: "rate_limit_error", message: "my wifi is hunter2" } },
    undefined,
    new Headers(),
  );
  const { client } = fakeAnthropic({}, [], apiErr);
  const err = await assertRejects(() => collect(new AnthropicAdapter(client).stream(CLAUDE, REQ)), LlmError);
  assertEquals(err.provider, "anthropic");
  assertEquals(err.status, 429);
  assertEquals(err.retryable, true);
  assert(!err.message.includes("hunter2"));

  const bad = Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "x" } }, undefined, new Headers());
  const e2 = await assertRejects(() => collect(new AnthropicAdapter(fakeAnthropic({}, [], bad).client).stream(CLAUDE, REQ)), LlmError);
  assertEquals(e2.retryable, false);
});

// ---- OpenAI ----------------------------------------------------------------------------------

const GPT_HISTORY: Message[] = [
  HISTORY[0],
  {
    role: "assistant",
    text: "",
    toolCalls: [{ id: "call_1", name: "search_items", input: { query: "soup" } }],
    native: {
      provider: "openai",
      model: "gpt-test",
      content: [
        { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" },
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "search_items", arguments: '{"query":"soup"}' },
      ],
    },
  },
  HISTORY[2],
  HISTORY[3],
];

Deno.test("openai: streams text, returns tool calls, usage without double-counting cached tokens", async () => {
  const { client } = fakeOpenAI([
    { type: "response.output_text.delta", delta: "Hel" },
    { type: "response.output_text.delta", delta: "lo" },
    {
      type: "response.completed",
      response: response({
        output: [
          { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello", annotations: [] }] },
          { type: "function_call", id: "fc_2", call_id: "call_2", name: "search_items", arguments: '{"query":"bread"}' },
        ],
        usage: {
          input_tokens: 12_400,
          input_tokens_details: { cached_tokens: 10_000, cache_write_tokens: 400 },
          output_tokens: 300,
          output_tokens_details: { reasoning_tokens: 100 },
          total_tokens: 12_700,
        },
      }),
    },
  ]);
  const { texts, done } = await collect(new OpenAIAdapter(client).stream(GPT, { ...REQ, messages: GPT_HISTORY }));
  assertEquals(texts, ["Hel", "lo"]);
  assertEquals(done.stop, "tool_calls");
  assertEquals(done.turn.text, "Hello");
  assertEquals(done.turn.toolCalls, [{ id: "call_2", name: "search_items", input: { query: "bread" } }]);
  assertEquals(done.usage.inputTokens, 2000);
  assertEquals(done.usage.cacheReadTokens, 10_000);
  assertEquals(done.usage.cacheWriteTokens, 400);
  assertEquals(Math.round(done.usage.costCents * 1e6) / 1e6, 0.5); // same tokens as the Anthropic test
});

Deno.test("openai: request shape (store off, instructions, function tools, reasoning only with effort)", async () => {
  const { client, calls } = fakeOpenAI([{ type: "response.completed", response: response({}) }]);
  await collect(new OpenAIAdapter(client).stream(GPT, REQ));
  const p = calls[0];
  assertEquals(p.store, false);
  assertEquals(p.stream, true);
  assertEquals(p.instructions, "You are Wilma.");
  assertEquals(p.max_output_tokens, 4096);
  assertEquals(p.tools as unknown, [{ type: "function", name: "search_items", description: "Search notes", parameters: TOOLS[0].inputSchema, strict: false }]);
  assertEquals("reasoning" in p, false);
  assertEquals("include" in p, false);

  await collect(new OpenAIAdapter(client).stream({ ...GPT, effort: "low" }, REQ));
  assertEquals(calls[1].reasoning, { effort: "low" });
  assertEquals(calls[1].include, ["reasoning.encrypted_content"]);
});

Deno.test("openai: conversation translation, reasoning replayed only to the same model", async () => {
  const { client, calls } = fakeOpenAI([{ type: "response.completed", response: response({}) }]);
  await collect(new OpenAIAdapter(client).stream(GPT, { ...REQ, messages: GPT_HISTORY }));
  assertEquals(calls[0].input, [
    { role: "user", content: "find my soup recipe" },
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" },
    { type: "function_call", call_id: "call_1", name: "search_items", arguments: '{"query":"soup"}' },
    { type: "function_call_output", call_id: "call_1", output: "[]" },
    { type: "function_call_output", call_id: "call_x", output: "Error: boom" },
    { role: "user", content: "and the bread?" },
  ]);

  // An Anthropic turn (or another OpenAI model's) is rebuilt: text and calls, no reasoning.
  await collect(new OpenAIAdapter(client).stream(GPT, REQ));
  assertEquals((calls[1].input as unknown[]).slice(1, 3), [
    { role: "assistant", content: "Looking." },
    { type: "function_call", call_id: "call_1", name: "search_items", arguments: '{"query":"soup"}' },
  ]);
});

Deno.test("openai: arguments that are not a JSON object are flagged, not run", async () => {
  const { client } = fakeOpenAI([{
    type: "response.completed",
    response: response({ output: [{ type: "function_call", call_id: "c", name: "search_items", arguments: '{"query": "br' }] }),
  }]);
  const { done } = await collect(new OpenAIAdapter(client).stream(GPT, REQ));
  assertEquals(done.turn.toolCalls, [{ id: "c", name: "search_items", input: {}, invalidInput: true }]);
});

Deno.test("openai: incomplete and refused turns", async () => {
  const cut = fakeOpenAI([{
    type: "response.incomplete",
    response: response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
  }]);
  assertEquals((await collect(new OpenAIAdapter(cut.client).stream(GPT, REQ))).done.stop, "max_tokens");

  const refused = fakeOpenAI([{
    type: "response.completed",
    response: response({
      output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "no" }] }],
    }),
  }]);
  assertEquals((await collect(new OpenAIAdapter(refused.client).stream(GPT, REQ))).done.stop, "refused");

  const filtered = fakeOpenAI([{
    type: "response.incomplete",
    response: response({ status: "incomplete", incomplete_details: { reason: "content_filter" } }),
  }]);
  assertEquals((await collect(new OpenAIAdapter(filtered.client).stream(GPT, REQ))).done.stop, "refused");
});

Deno.test("openai: failures become LlmError", async () => {
  const failed = fakeOpenAI([{ type: "response.failed", response: response({ status: "failed", error: { code: "server_error", message: "x" } }) }]);
  const e1 = await assertRejects(() => collect(new OpenAIAdapter(failed.client).stream(GPT, REQ)), LlmError);
  assertEquals(e1.code, "server_error");

  const early = fakeOpenAI([{ type: "response.output_text.delta", delta: "Hi" }]);
  const e2 = await assertRejects(() => collect(new OpenAIAdapter(early.client).stream(GPT, REQ)), LlmError);
  assertEquals(e2.code, "stream_ended_early");

  const apiErr = OpenAI.APIError.generate(503, { message: "my wifi is hunter2", type: "server_error" }, undefined, new Headers());
  const e3 = await assertRejects(() => collect(new OpenAIAdapter(fakeOpenAI([], apiErr).client).stream(GPT, REQ)), LlmError);
  assertEquals(e3.status, 503);
  assertEquals(e3.retryable, true);
  assert(!e3.message.includes("hunter2"));
});

// ---- Routes and createLlm ----------------------------------------------------------------------

const ROUTES_JSON = JSON.stringify({
  router: GPT,
  default: GPT,
  escalation: { ...CLAUDE, effort: "medium" },
});

Deno.test("parseRoutes: accepts a full config, rejects mistakes with the path", () => {
  const routes = parseRoutes(ROUTES_JSON);
  assertEquals(routes.escalation.provider, "anthropic");
  assertEquals(routes.escalation.effort, "medium");

  const bad = (json: string | undefined, part: string) => {
    try {
      parseRoutes(json);
    } catch (e) {
      assert(e instanceof RoutesConfigError);
      assert(e.message.includes(part), e.message);
      return;
    }
    throw new Error("expected RoutesConfigError");
  };
  bad(undefined, "not set");
  bad("{", "not JSON");
  bad(JSON.stringify({ router: GPT, default: GPT }), "escalation");
  bad(JSON.stringify({ router: GPT, default: { ...GPT, provider: "gemini" }, escalation: GPT }), "default.provider");
  bad(JSON.stringify({ router: GPT, default: GPT, escalation: { ...GPT, price: { input: 1 } } }), "escalation.price");
});

Deno.test("missingKeys: names the providers whose key is not set", () => {
  const routes = parseRoutes(ROUTES_JSON);
  assertEquals(missingKeys(routes, () => undefined).sort(), ["anthropic", "openai"]);
  assertEquals(missingKeys(routes, (n) => (n === "OPENAI_API_KEY" ? "set" : undefined)), ["anthropic"]);
  assertEquals(missingKeys(routes, () => "set"), []);
});

Deno.test("createLlm: each route goes to its configured provider", async () => {
  const a = fakeAnthropic({ content: [{ type: "text", text: "from claude", citations: null }] as Anthropic.ContentBlock[] });
  const o = fakeOpenAI([{ type: "response.completed", response: response({}) }]);
  const llm = createLlm({ env: () => undefined, routes: parseRoutes(ROUTES_JSON), clients: { anthropic: a.client, openai: o.client } });
  await collect(llm.stream("default", REQ));
  assertEquals([a.calls.length, o.calls.length], [0, 1]);
  const { done } = await collect(llm.stream("escalation", REQ));
  assertEquals([a.calls.length, o.calls.length], [1, 1]);
  assertEquals(done.turn.text, "from claude");
  assertEquals(a.calls[0].output_config, { effort: "medium" });
});

Deno.test("createLlm: reads LLM_ROUTES, and a route without its API key fails clearly", () => {
  const llm = createLlm({ env: (n) => (n === "LLM_ROUTES" ? ROUTES_JSON : undefined) });
  assertEquals(llm.routes.default.model, "gpt-test");
  try {
    llm.stream("escalation", REQ);
    throw new Error("expected LlmError");
  } catch (e) {
    assert(e instanceof LlmError);
    assertEquals(e.code, "api_key_not_set");
    assertEquals(e.provider, "anthropic");
  }
});

Deno.test("out of credit is quota_exceeded and not retryable (OpenAI sends it as 429)", async () => {
  const quota = OpenAI.APIError.generate(
    429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }, undefined, new Headers(),
  );
  const e1 = await assertRejects(() => collect(new OpenAIAdapter(fakeOpenAI([], quota).client).stream(GPT, REQ)), LlmError);
  assertEquals([e1.code, e1.status, e1.retryable], ["quota_exceeded", 429, false]);

  const slowDown = OpenAI.APIError.generate(429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, undefined, new Headers());
  const e2 = await assertRejects(() => collect(new OpenAIAdapter(fakeOpenAI([], slowDown).client).stream(GPT, REQ)), LlmError);
  assertEquals([e2.code, e2.retryable], ["rate_limit_exceeded", true]);

  const credit = Anthropic.APIError.generate(
    400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
    undefined, new Headers(),
  );
  const e3 = await assertRejects(() => collect(new AnthropicAdapter(fakeAnthropic({}, [], credit).client).stream(CLAUDE, REQ)), LlmError);
  assertEquals([e3.code, e3.retryable], ["quota_exceeded", false]);
  assert(!e3.message.includes("credit balance"), "codes only, never the provider's text");

  const other = Anthropic.APIError.generate(
    400, { type: "error", error: { type: "invalid_request_error", message: "messages: roles must alternate" } }, undefined, new Headers(),
  );
  const e4 = await assertRejects(() => collect(new AnthropicAdapter(fakeAnthropic({}, [], other).client).stream(CLAUDE, REQ)), LlmError);
  assertEquals(e4.code, "invalid_request_error");
});
