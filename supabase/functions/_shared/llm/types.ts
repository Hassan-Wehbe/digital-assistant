// The provider-neutral model layer (docs/design.md D21). Callers speak only these types;
// each adapter (anthropic.ts, openai.ts) translates them to one provider's API. Which
// provider and model answers is configuration (routes.ts), chosen by evaluation.

export type ProviderId = "anthropic" | "openai";

/** A tool the model may call. `inputSchema` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Set when the model's arguments were not a JSON object; do not run the tool. */
  invalidInput?: true;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

/**
 * The provider's own record of an assistant turn (Anthropic content blocks, OpenAI output
 * items). Replayed verbatim to the same provider and model so reasoning carries over;
 * other models get the neutral `text` and `toolCalls` instead.
 */
export interface NativeTurn {
  provider: ProviderId;
  model: string;
  content: unknown;
}

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; native?: NativeTurn }
  /** Results for every tool call of the assistant turn just before it. */
  | { role: "tool"; results: ToolResult[] };

export type AssistantTurn = Extract<Message, { role: "assistant" }>;

export interface ChatRequest {
  /** Stable instructions first: providers cache the prefix (tools, then system). */
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

/**
 * Why the turn ended. Run the turn's tool calls only on "tool_calls": a turn cut off by
 * "max_tokens" or "refused" may hold incomplete calls.
 */
export type StopReason = "end" | "tool_calls" | "max_tokens" | "refused" | "other";

export interface Usage {
  /** Input tokens billed at the full price (not read from or written to a cache). */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** US cents, from the route's prices; fractional (summed per month by the caller). */
  costCents: number;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; turn: AssistantTurn; stop: StopReason; usage: Usage };

/** USD per million tokens, as shown in the provider's console. Checked before each launch. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One configured model: which provider, which model id, its prices and options. */
export interface ModelConfig {
  provider: ProviderId;
  model: string;
  price: Price;
  maxOutputTokens: number;
  /** Reasoning effort, passed only when set (not every model accepts it). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface LlmAdapter {
  readonly provider: ProviderId;
  stream(model: ModelConfig, req: ChatRequest): AsyncGenerator<StreamEvent>;
}

/**
 * A failed model call. The message never contains conversation text (CLAUDE.md: errors log
 * codes and ids only); `retryable` covers rate limits, overload and network errors.
 */
export class LlmError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly code: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    /** Where in the request the provider found a problem (e.g. "tools[12].parameters"); never text. */
    readonly where?: string,
  ) {
    super(`${provider} model call failed: ${code}${status ? ` (HTTP ${status})` : ""}${where ? ` at ${where}` : ""}`);
    this.name = "LlmError";
  }
}

/**
 * The provider account is out of credit or over its spend limit (the owner's limit, not a
 * user's). Never retryable: nothing works until the owner tops up or raises the limit.
 */
export const QUOTA_EXCEEDED = "quota_exceeded";

export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}
