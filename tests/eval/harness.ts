// Runs one evaluation case: a fresh pretend account (world.ts), Wilma's real MCP tools on top
// of it (same descriptions, same server-side checks such as rule 9), connected in memory, and
// the conversation loop the chat function will use: model -> tool calls -> results -> model,
// until the model answers. Records every tool call and reply for grading.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { serverInstructions } from "../../supabase/functions/mcp/lib/assistant.ts";
import type { ToolContext } from "../../supabase/functions/mcp/tools/_shared.ts";
import { registerListSpaces } from "../../supabase/functions/mcp/tools/list_spaces.ts";
import { registerCreateSpace } from "../../supabase/functions/mcp/tools/create_space.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";
import { registerGetItem } from "../../supabase/functions/mcp/tools/get_item.ts";
import { registerSearchItems } from "../../supabase/functions/mcp/tools/search_items.ts";
import { registerLinkItems } from "../../supabase/functions/mcp/tools/link_items.ts";
import { registerSaveSecret } from "../../supabase/functions/mcp/tools/save_secret.ts";
import { registerFindSecret } from "../../supabase/functions/mcp/tools/find_secret.ts";
import { registerGetSecret } from "../../supabase/functions/mcp/tools/get_secret.ts";
import { registerUpdateSecret } from "../../supabase/functions/mcp/tools/update_secret.ts";
import { registerDeleteSecret } from "../../supabase/functions/mcp/tools/delete_secret.ts";
import { registerSetAssistantName } from "../../supabase/functions/mcp/tools/set_assistant_name.ts";
import { registerAttachFile } from "../../supabase/functions/mcp/tools/attach_file.ts";
import { registerGetAttachmentLink } from "../../supabase/functions/mcp/tools/get_attachment_link.ts";
import { registerDescribeAttachment } from "../../supabase/functions/mcp/tools/describe_attachment.ts";
import { registerDeleteAttachment } from "../../supabase/functions/mcp/tools/delete_attachment.ts";
import { registerDeleteItem } from "../../supabase/functions/mcp/tools/delete_item.ts";
import {
  registerListDeletedItems, registerPurgeItem, registerRestoreItem,
} from "../../supabase/functions/mcp/tools/recycle_bin.ts";
import { registerDeleteSpace } from "../../supabase/functions/mcp/tools/delete_space.ts";
import type {
  LlmAdapter, Message, ModelConfig, StopReason, StreamEvent, ToolResult, ToolSpec,
} from "../../supabase/functions/_shared/llm/index.ts";
import { World } from "./world.ts";
import { systemPrompt } from "./system.ts";

/** The same 22 tools the deployed server offers (tests/deno/tools_list_test.ts lists them). */
export const ALL_TOOLS = [
  registerListSpaces, registerCreateSpace, registerSaveItem, registerUpdateItem, registerGetItem,
  registerSearchItems, registerLinkItems, registerSaveSecret, registerFindSecret, registerGetSecret,
  registerUpdateSecret, registerDeleteSecret, registerSetAssistantName, registerAttachFile,
  registerGetAttachmentLink, registerDescribeAttachment, registerDeleteAttachment, registerDeleteItem,
  registerListDeletedItems, registerRestoreItem, registerPurgeItem, registerDeleteSpace,
];

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
}

export interface Session {
  world: World;
  tools: ToolSpec[];
  system: string;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  close(): Promise<void>;
}

/** A fresh pretend account with Wilma's tools connected to it. */
export async function openSession(world = new World()): Promise<Session> {
  const ctx: ToolContext = {
    db: world.client(), userId: "eval-user", accessToken: "eval-token", assistantName: world.assistantName,
  };
  const server = new McpServer(
    { name: "digital-assistant", version: "eval" },
    { instructions: serverInstructions(ctx.assistantName) },
  );
  for (const register of ALL_TOOLS) register(server, ctx);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "wilma-eval", version: "1" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  return {
    world,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
    system: systemPrompt(ctx.assistantName, client.getInstructions() ?? ""),
    async call(name, args) {
      try {
        const res = await client.callTool({ name, arguments: args });
        const content = (res.content ?? []) as { type: string; text?: string }[];
        return { isError: !!res.isError, text: content.map((c) => c.text ?? "").join("\n") };
      } catch (e) {
        return { isError: true, text: e instanceof Error ? e.message : String(e) };
      }
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export interface RunOptions {
  /** Model calls allowed per user turn before giving up (a runaway loop fails the case). */
  maxStepsPerTurn?: number;
  setup?: (w: World) => void;
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
  const session = await openSession(world);
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
  } finally {
    record.ms = performance.now() - started;
    await session.close();
  }
  return record;
}
