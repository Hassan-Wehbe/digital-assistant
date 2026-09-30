// Recycle bin tools: purge_item deletes the files before the item (so a Storage failure
// leaves the item in the bin, nothing half-deleted), and the tools pass the right ids.
import { assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerDeleteItem } from "../../supabase/functions/mcp/tools/delete_item.ts";
import {
  registerListDeletedItems, registerPurgeItem, registerRestoreItem,
} from "../../supabase/functions/mcp/tools/recycle_bin.ts";
import { registerDeleteSpace } from "../../supabase/functions/mcp/tools/delete_space.ts";

const ITEM = "11111111-1111-4111-8111-111111111111";
const SPACE = "22222222-2222-4222-8222-222222222222";
const KEYS = ["u/a1/soup.jpg", "u/a2/plan.vsdx"];

function fakeDb(opts: { removeFails?: boolean } = {}) {
  const log: string[] = [];
  const db = {
    from: () => ({
      select: () => Promise.resolve({ data: [{ id: SPACE, name: "Recipes", description: null, parent_id: null, is_restricted: false }], error: null }),
    }),
    rpc: (name: string, params: Record<string, unknown>) => {
      log.push(`rpc ${name} ${JSON.stringify(params)}`);
      const data: Record<string, unknown> = {
        deleted_item_files: KEYS,
        purge_item: { item_id: ITEM, title: "Old soup", purged: true },
        delete_item: { item_id: ITEM, title: "Old soup", in_recycle_bin: true },
        restore_item: { item_id: ITEM, title: "Old soup", restored: true },
        list_deleted_items: [{ id: ITEM, title: "Old soup", item_type: "recipe", space_id: SPACE, deleted_at: "2026-09-30", attachments: 2 }],
        delete_space: { space_id: SPACE, name: "Recipes", deleted: true },
      };
      return Promise.resolve({ data: data[name], error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          log.push(`remove ${bucket} ${paths.join(",")}`);
          return Promise.resolve({ data: null, error: opts.removeFails ? { message: "storage down" } : null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { db, log };
}

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db, userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerDeleteItem, registerListDeletedItems, registerRestoreItem, registerPurgeItem, registerDeleteSpace]) {
    r(server, ctx);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const out = await res.json();
  return { isError: !!out.result.isError, text: out.result.content[0].text as string };
}

Deno.test("purge_item removes the files first, then the item", async () => {
  const { db, log } = fakeDb();
  const out = await call(db, "purge_item", { item_id: ITEM });
  assertEquals(out.isError, false);
  assertEquals(log, [
    `rpc deleted_item_files {"p_item_id":"${ITEM}"}`,
    `remove attachments ${KEYS.join(",")}`,
    `rpc purge_item {"p_item_id":"${ITEM}"}`,
  ]);
  assertEquals(JSON.parse(out.text).files_deleted, 2);
});

Deno.test("purge_item keeps the item in the bin when the files cannot be removed", async () => {
  const { db, log } = fakeDb({ removeFails: true });
  const out = await call(db, "purge_item", { item_id: ITEM });
  assertEquals(out.isError, true);
  assertEquals(out.text.includes("storage down"), true);
  assertEquals(log.some((l) => l.startsWith("rpc purge_item")), false);
});

Deno.test("delete_item, restore_item and delete_space pass the ids through", async () => {
  const { db, log } = fakeDb();
  await call(db, "delete_item", { item_id: ITEM });
  await call(db, "restore_item", { item_id: ITEM });
  await call(db, "delete_space", { space: "Recipes" });
  assertEquals(log, [
    `rpc delete_item {"p_item_id":"${ITEM}"}`,
    `rpc restore_item {"p_item_id":"${ITEM}"}`,
    `rpc delete_space {"p_space_id":"${SPACE}"}`,
  ]);
});

Deno.test("list_deleted_items shows the space path instead of its id", async () => {
  const { db } = fakeDb();
  const out = await call(db, "list_deleted_items", {});
  const items = JSON.parse(out.text).items;
  assertEquals(items[0].space, "Recipes");
  assertEquals("space_id" in items[0], false);
});
