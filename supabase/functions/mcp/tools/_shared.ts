import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DistanceUnit } from "../lib/assistant.ts";
import type { FindPlacesLog } from "./find_places.ts";

/** What every tool gets: a database client acting as the signed-in user. */
export interface ToolContext {
  db: SupabaseClient;
  userId: string;
  accessToken: string; // to schedule background embedding as the same user
  assistantName: string; // what the user calls the assistant (lib/assistant.ts)
  distanceUnit?: DistanceUnit; // miles (the default) or km (app_user.distance_unit)
  /** The phone's time zone (the app's chat sends it): a task's local planned_at gets its offset from it. */
  timeZone?: string;
  /** Where tools write their one log line (counts and codes only); console by default. */
  log?: (entry: FindPlacesLog) => void;
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
