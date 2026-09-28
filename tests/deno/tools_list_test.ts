// Protocol smoke test: the server initializes and advertises exactly the
// milestone-1, vault, settings and attachment tools with valid input schemas. No database is touched.
import { assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
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

async function rpc(body: unknown) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db: {} as SupabaseClient, userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerListSpaces, registerCreateSpace, registerSaveItem, registerUpdateItem,
                   registerGetItem, registerSearchItems, registerLinkItems, registerSaveSecret,
                   registerFindSecret, registerGetSecret, registerUpdateSecret, registerDeleteSecret,
                   registerSetAssistantName, registerAttachFile, registerGetAttachmentLink,
                   registerDescribeAttachment, registerDeleteAttachment]) {
    r(server, ctx);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    }),
  );
  return await res.json();
}

Deno.test("tools/list advertises the milestone-1, vault, settings and attachment tools", async () => {
  const out = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const names = out.result.tools.map((t: { name: string }) => t.name).sort();
  assertEquals(names, [
    "attach_file", "create_space", "delete_attachment", "delete_secret", "describe_attachment", "find_secret",
    "get_attachment_link", "get_item", "get_secret", "link_items", "list_spaces", "save_item", "save_secret",
    "search_items", "set_assistant_name", "update_item", "update_secret",
  ]);
  const save = out.result.tools.find((t: { name: string }) => t.name === "save_item");
  assertEquals(save.inputSchema.required.sort(), ["body", "item_type", "space", "title"]);
});

Deno.test("invalid arguments are rejected before any database call", async () => {
  const out = await rpc({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "get_item", arguments: { item_id: "not-a-uuid" } },
  });
  assertEquals(out.result?.isError ?? !!out.error, true);
});
