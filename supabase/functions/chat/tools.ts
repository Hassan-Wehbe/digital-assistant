// Wilma's real MCP tools, started in memory and bound to one signed-in user. The chat function
// and the evaluation (tests/eval/harness.ts) both connect this way, so what is evaluated is what
// ships: same tool list (mcp/tools/all.ts), same descriptions, same server-side checks (rule 9,
// restricted spaces, vault links only).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { serverInstructions } from "../mcp/lib/assistant.ts";
import type { ToolContext } from "../mcp/tools/_shared.ts";
import { ALL_TOOLS } from "../mcp/tools/all.ts";
import type { ToolSpec } from "../_shared/llm/index.ts";

export interface ToolOutput {
  isError: boolean;
  text: string;
}

export interface ToolSession {
  specs: ToolSpec[];
  /** The MCP server's own instructions, for systemPrompt(). */
  instructions: string;
  call(name: string, args: Record<string, unknown>): Promise<ToolOutput>;
  close(): Promise<void>;
}

export async function connectTools(ctx: ToolContext, version = "chat"): Promise<ToolSession> {
  const server = new McpServer(
    { name: "digital-assistant", version },
    { instructions: serverInstructions(ctx.assistantName, ctx.distanceUnit) },
  );
  for (const register of ALL_TOOLS) register(server, ctx);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: `wilma-${version}`, version: "1" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  return {
    specs: tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
    instructions: client.getInstructions() ?? "",
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
