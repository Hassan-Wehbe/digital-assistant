// Anthropic adapter: the Messages API, streamed, with client tools.
// https://docs.claude.com/en/api/messages
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
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
export interface AnthropicLike {
  messages: {
    stream(
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ): AsyncIterable<Anthropic.MessageStreamEvent> & { finalMessage(): Promise<Anthropic.Message> };
  };
}

export function anthropicClient(apiKey: string): AnthropicLike {
  return new Anthropic({ apiKey });
}

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool_calls",
  max_tokens: "max_tokens",
  model_context_window_exceeded: "max_tokens",
  refusal: "refused",
};

export function toAnthropicMessages(messages: Message[], model: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // Same model: replay its own blocks unchanged (thinking blocks must not be edited).
      if (m.native?.provider === "anthropic" && m.native.model === model) {
        out.push({ role: "assistant", content: m.native.content as Anthropic.ContentBlockParam[] });
        continue;
      }
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      out.push({ role: "assistant", content });
    } else {
      // All results of one turn go back in a single user message.
      out.push({
        role: "user",
        content: m.results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.callId,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  return out;
}

export function toAnthropicParams(model: ModelConfig, req: ChatRequest): Anthropic.MessageStreamParams {
  return {
    model: model.model,
    max_tokens: model.maxOutputTokens,
    // Cache the stable prefix (tools + system) and the conversation so far.
    cache_control: { type: "ephemeral" },
    system: req.system,
    tools: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    })),
    messages: toAnthropicMessages(req.messages, model.model),
    ...(model.effort ? { output_config: { effort: model.effort } } : {}),
  };
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic" as const;
  constructor(private readonly client: AnthropicLike) {}

  async *stream(model: ModelConfig, req: ChatRequest): AsyncGenerator<StreamEvent> {
    let message: Anthropic.Message;
    try {
      const stream = this.client.messages.stream(toAnthropicParams(model, req), { signal: req.signal });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      message = await stream.finalMessage();
    } catch (err) {
      throw toLlmError(err);
    }

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") {
        const input = block.input;
        toolCalls.push(
          input && typeof input === "object" && !Array.isArray(input)
            ? { id: block.id, name: block.name, input: input as Record<string, unknown> }
            : { id: block.id, name: block.name, input: {}, invalidInput: true },
        );
      }
    }
    const turn: AssistantTurn = {
      role: "assistant",
      text,
      toolCalls,
      native: { provider: "anthropic", model: model.model, content: message.content },
    };
    const u = message.usage;
    yield {
      type: "done",
      turn,
      stop: STOP[message.stop_reason ?? ""] ?? "other",
      usage: usage(model.price, {
        inputTokens: u.input_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        outputTokens: u.output_tokens,
      }),
    };
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError("anthropic", "aborted", undefined, false);
  if (err instanceof Anthropic.APIError) {
    // "Credit balance is too low" / "reached your API usage limits" come as client errors.
    // The message is only matched here, never passed on (it is not conversation text, but
    // LlmError carries codes only).
    if (err.status && err.status < 500 && /credit balance|usage limit|spend(?:ing)? limit/i.test(err.message)) {
      return new LlmError("anthropic", QUOTA_EXCEEDED, err.status, false);
    }
    return new LlmError("anthropic", err.type ?? "api_error", err.status, isRetryableStatus(err.status));
  }
  return new LlmError("anthropic", "unexpected_error", undefined, true);
}
