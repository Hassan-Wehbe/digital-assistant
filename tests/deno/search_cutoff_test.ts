// search_items passes the weak-match cutoff to the database only when asked
// (close_matches_only, used by the mobile app); the Claude connector's default is unchanged.
import { assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLOSE_MATCH_MAX_DISTANCE,
  registerSearchItems,
} from "../../supabase/functions/mcp/tools/search_items.ts";

async function search(args: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    rpc: (_name: string, params: Record<string, unknown>) => {
      calls.push(params);
      return Promise.resolve({ data: [], error: null });
    },
  } as unknown as SupabaseClient;
  const server = new McpServer({ name: "test", version: "0" });
  registerSearchItems(server, { db, userId: "u", accessToken: "t", assistantName: "Wilma" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_items", arguments: args },
      }),
    }),
  );
  const out = await res.json();
  assertEquals(out.result.isError ?? false, false);
  return calls[0];
}

Deno.test("search_items: no cutoff by default", async () => {
  assertEquals((await search({ tags: ["weeknight"] })).p_max_distance, null);
});

Deno.test("search_items: close_matches_only sends the cutoff", async () => {
  const params = await search({ tags: ["weeknight"], close_matches_only: true });
  assertEquals(params.p_max_distance, CLOSE_MATCH_MAX_DISTANCE);
  assertEquals(CLOSE_MATCH_MAX_DISTANCE > 0 && CLOSE_MATCH_MAX_DISTANCE < 1, true);
});
