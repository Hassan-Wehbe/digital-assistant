import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/** What every tool gets: a database client acting as the signed-in user. */
export interface ToolContext {
  db: SupabaseClient;
  userId: string;
  accessToken: string; // to schedule background embedding as the same user
}

export type RegisterTool = (server: McpServer, ctx: ToolContext) => void;

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Run a tool body; turn thrown errors into a tool error the model can read. */
export async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export function dbError(action: string, error: { message: string; code?: string }): Error {
  if (error.code === "23505") return new Error(`${action}: it already exists`);
  if (error.code === "P0002") return new Error(`${action}: ${error.message}`);
  return new Error(`${action}: ${error.message}`);
}
