// Runs one evaluation case: a fresh pretend account (world.ts), Wilma's real MCP tools on top
// of it (same descriptions, same server-side checks such as rule 9), connected in memory, and
// the conversation loop the chat function will use: model -> tool calls -> results -> model,
// until the model answers. Records every tool call and reply for grading.
import { connectTools } from "../../supabase/functions/chat/tools.ts";
import type { ToolContext } from "../../supabase/functions/mcp/tools/_shared.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import {
  type LlmAdapter, LlmError, type Message, type ModelConfig, type StopReason, type StreamEvent,
  type ToolResult, type ToolSpec,
} from "../../supabase/functions/_shared/llm/index.ts";
import { World } from "./world.ts";
import { type SharedPoint, systemPrompt } from "../../supabase/functions/_shared/assistant_prompt.ts";

export { ALL_TOOLS };

// The tools run outside the Edge runtime here: stand in for its globals. Embeddings are not
// what the evaluation measures (world.ts searches by keyword), so any vector will do.
const g = globalThis as Record<string, unknown>;
g.Supabase ??= {
  ai: {
    Session: class {
      run() {
        return Promise.resolve(new Array(384).fill(0.05));
      }
    },
  },
};
g.EdgeRuntime ??= { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };
if (!Deno.env.get("SUPABASE_URL")) Deno.env.set("SUPABASE_URL", "http://eval.invalid");
// Background "embed pending" requests go nowhere; every other request (the model APIs) is untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("http://eval.invalid/")) return Promise.resolve(new Response(null, { status: 202 }));
  return realFetch(input, init);
}) as typeof fetch;

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  /** false: the server accepted it (and acted); true: refused or failed, nothing changed. */
  isError: boolean;
  result: string;
}

export interface TurnRecord {
  user: string;
  /** Everything the model said to the user during this turn. */
  reply: string;
  toolCalls: ToolCallRecord[];
  stop: StopReason;
}

export interface RunRecord {
  turns: TurnRecord[];
  world: World;
  costCents: number;
  modelCalls: number;
  ms: number;
  /** A failed model call (network, rate limit, bad configuration): not a model mistake. */
  error?: string;
  /** LlmError.code and HTTP status of that failure, e.g. quota_exceeded. */
  errorCode?: string;
  errorStatus?: number;
}

export interface Session {
  world: World;
  tools: ToolSpec[];
  system: string;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  close(): Promise<void>;
}

/** A fresh pretend account with Wilma's tools connected to it, exactly as the chat function connects them. */
export async function openSession(world = new World(), here?: SharedPoint): Promise<Session> {
  const ctx: ToolContext = {
    db: world.client(), userId: "eval-user", accessToken: "eval-token", assistantName: world.assistantName,
  };
  const tools = await connectTools(ctx, "eval");
  return {
    world,
    tools: tools.specs,
    // `here`: the 📍 location the chat function adds to a message's instructions (places step 7).
    system: systemPrompt(ctx.assistantName, tools.instructions, new Date(), here),
    call: tools.call,
    close: tools.close,
  };
}

export interface RunOptions {
  /** Model calls allowed per user turn before giving up (a runaway loop fails the case). */
  maxStepsPerTurn?: number;
  setup?: (w: World) => void;
  /** The phone's location shared with the messages (📍), as the chat function passes it. */
  here?: SharedPoint;
}

/** Play the user's messages to the model, running its tool calls, and record everything. */
export async function runConversation(
  adapter: LlmAdapter,
  model: ModelConfig,
  userTurns: string[],
  opts: RunOptions = {},
): Promise<RunRecord> {
  const world = new World();
  opts.setup?.(world);
  const session = await openSession(world, opts.here);
  const started = performance.now();
  const record: RunRecord = { turns: [], world, costCents: 0, modelCalls: 0, ms: 0 };
  const messages: Message[] = [];
  try {
    for (const user of userTurns) {
      messages.push({ role: "user", content: user });
      const turn: TurnRecord = { user, reply: "", toolCalls: [], stop: "other" };
      record.turns.push(turn);
      for (let step = 0; ; step++) {
        if (step >= (opts.maxStepsPerTurn ?? 8)) {
          turn.stop = "other";
          turn.reply += "\n[evaluation: too many tool rounds, stopped]";
          break;
        }
        let done: Extract<StreamEvent, { type: "done" }> | undefined;
        for await (const ev of adapter.stream(model, { system: session.system, messages, tools: session.tools })) {
          if (ev.type === "done") done = ev;
        }
        record.modelCalls += 1;
        if (!done) throw new Error("the model stream ended without a final turn");
        record.costCents += done.usage.costCents;
        messages.push(done.turn);
        if (done.turn.text) turn.reply += (turn.reply ? "\n" : "") + done.turn.text;
        turn.stop = done.stop;
        if (done.stop !== "tool_calls") break;

        const results: ToolResult[] = [];
        for (const c of done.turn.toolCalls) {
          const out = c.invalidInput
            ? { isError: true, text: "The tool arguments were not a JSON object." }
            : await session.call(c.name, c.input);
          turn.toolCalls.push({ name: c.name, args: c.input, isError: out.isError, result: out.text });
          results.push({ callId: c.id, content: out.text, isError: out.isError });
        }
        messages.push({ role: "tool", results });
      }
    }
  } catch (e) {
    record.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (e instanceof LlmError) {
      record.errorCode = e.code;
      record.errorStatus = e.status;
    }
  } finally {
    record.ms = performance.now() - started;
    await session.close();
  }
  return record;
}
