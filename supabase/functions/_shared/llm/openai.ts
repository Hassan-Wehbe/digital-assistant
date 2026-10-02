// OpenAI adapter: the Responses API, streamed, with function tools.
// https://platform.openai.com/docs/api-reference/responses
// store: false, so OpenAI keeps no copy of the conversation; reasoning carries over between
// turns through encrypted reasoning items that this adapter replays to the same model.
import OpenAI from "npm:openai@7.25.0";
import type * as R from "npm:openai@7.25.0/resources/responses/responses";
import { usage } from "./cost.ts";
import {
  type AssistantTurn,
  type ChatRequest,
  isRetryableStatus,
  type LlmAdapter,
  LlmError,
  type Message,
  type ModelConfig,
  QUOTA_EXCEEDED,
  type StopReason,
  type StreamEvent,
  type ToolCall,
} from "./types.ts";

/** The part of the SDK client this adapter uses (a real client, or a fake in tests). */
export interface OpenAILike {
  responses: {
    create(
      params: R.ResponseCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<R.ResponseStreamEvent>>;
  };
}

export function openaiClient(apiKey: string): OpenAILike {
  return new OpenAI({ apiKey });
}

export function toOpenAIInput(messages: Message[], model: string): R.ResponseInputItem[] {
  const out: R.ResponseInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // Same model: its reasoning items go back first (encrypted; OpenAI stores nothing).
      if (m.native?.provider === "openai" && m.native.model === model) {
        for (const item of m.native.content as R.ResponseOutputItem[]) {
          if (item.type === "reasoning") out.push(item as R.ResponseReasoningItem);
        }
      }
      if (m.text) out.push({ role: "assistant", content: m.text });
      for (const c of m.toolCalls) {
        out.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) });
      }
    } else {
      for (const r of m.results) {
        // The Responses API has no error flag on tool output; say it in the text.
        out.push({ type: "function_call_output", call_id: r.callId, output: r.isError ? `Error: ${r.content}` : r.content });
      }
    }
  }
  return out;
}

// JSON Schema keywords OpenAI's function-parameter check may reject, and which only repeat what
// the tools check themselves (every tool validates its input with zod before acting): the
// "$schema" header, regex patterns (e.g. \p{L} letter classes), formats and propertyNames.
const DROPPED_KEYWORDS = new Set(["$schema", "pattern", "format", "propertyNames"]);

/** A tool's input schema as OpenAI accepts it: same fields, types, descriptions and limits. */
export function openaiParameters(schema: unknown): Record<string, unknown> {
  const clean = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => clean(x));
    if (!v || typeof v !== "object") return v;
    // "additionalProperties": {} (any value) is written as true.
    if (key === "additionalProperties" && Object.keys(v).length === 0) return true;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // Keywords are dropped where they describe a value; "properties" maps field names, kept as is.
      if (DROPPED_KEYWORDS.has(k) && key !== "properties") continue;
      out[k] = clean(x, k);
    }
    return out;
  };
  const out = clean(schema) as Record<string, unknown>;
  return { type: "object", properties: {}, ...out };
}

export function toOpenAIParams(model: ModelConfig, req: ChatRequest): R.ResponseCreateParamsStreaming {
  return {
    model: model.model,
    stream: true,
    store: false,
    instructions: req.system,
    input: toOpenAIInput(req.messages, model.model),
    tools: req.tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: openaiParameters(t.inputSchema),
      strict: false, // the tools validate their own input (zod in the MCP server)
    })),
    max_output_tokens: model.maxOutputTokens,
    ...(model.effort
      ? {
        reasoning: { effort: model.effort as "low" | "medium" | "high" | "xhigh" },
        include: ["reasoning.encrypted_content" as const],
      }
      : {}),
  };
}

function parseArguments(id: string, name: string, args: string): ToolCall {
  try {
    const input = JSON.parse(args || "{}");
    if (input && typeof input === "object" && !Array.isArray(input)) return { id, name, input };
  } catch { /* fall through */ }
  return { id, name, input: {}, invalidInput: true };
}

export class OpenAIAdapter implements LlmAdapter {
  readonly provider = "openai" as const;
  constructor(private readonly client: OpenAILike) {}

  async *stream(model: ModelConfig, req: ChatRequest): AsyncGenerator<StreamEvent> {
    let final: R.Response | undefined;
    try {
      const events = await this.client.responses.create(toOpenAIParams(model, req), { signal: req.signal });
      for await (const event of events) {
        if (event.type === "response.output_text.delta") yield { type: "text", text: event.delta };
        else if (event.type === "response.completed" || event.type === "response.incomplete") final = event.response;
        else if (event.type === "response.failed") {
          throw new LlmError("openai", event.response.error?.code ?? "response_failed", undefined, false);
        } else if (event.type === "error") {
          throw new LlmError("openai", event.code ?? "stream_error", undefined, true);
        }
      }
    } catch (err) {
      throw toLlmError(err);
    }
    if (!final) throw new LlmError("openai", "stream_ended_early", undefined, true);

    let text = "";
    let refused = false;
    const toolCalls: ToolCall[] = [];
    for (const item of final.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") text += part.text;
          if (part.type === "refusal") refused = true;
        }
      } else if (item.type === "function_call") {
        toolCalls.push(parseArguments(item.call_id, item.name, item.arguments));
      }
    }

    let stop: StopReason;
    const reason = final.incomplete_details?.reason;
    if (refused || reason === "content_filter") stop = "refused";
    else if (final.status === "incomplete") stop = reason === "max_output_tokens" ? "max_tokens" : "other";
    else stop = toolCalls.length > 0 ? "tool_calls" : "end";

    const turn: AssistantTurn = {
      role: "assistant",
      text,
      toolCalls,
      native: { provider: "openai", model: model.model, content: final.output },
    };
    // OpenAI counts cached and cache-written tokens inside input_tokens.
    const u = final.usage;
    const cacheRead = u?.input_tokens_details?.cached_tokens ?? 0;
    const cacheWrite = u?.input_tokens_details?.cache_write_tokens ?? 0;
    yield {
      type: "done",
      turn,
      stop,
      usage: usage(model.price, {
        inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cacheRead - cacheWrite),
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        outputTokens: u?.output_tokens ?? 0,
      }),
    };
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new LlmError("openai", "aborted", undefined, false);
  if (err instanceof OpenAI.APIError) {
    // Out of credit / over the project budget arrives as HTTP 429 like a rate limit, but
    // waiting does not help.
    if (/insufficient_quota|billing_hard_limit|budget/i.test(`${err.code ?? ""} ${err.type ?? ""}`)) {
      return new LlmError("openai", QUOTA_EXCEEDED, err.status, false);
    }
    // `param` is a location in our request (e.g. "tools[12].parameters"), safe to report.
    const where = typeof err.param === "string" && /^[\w.\[\]-]{1,100}$/.test(err.param) ? err.param : undefined;
    return new LlmError("openai", err.code ?? err.type ?? "api_error", err.status, isRetryableStatus(err.status), where);
  }
  return new LlmError("openai", "unexpected_error", undefined, true);
}
