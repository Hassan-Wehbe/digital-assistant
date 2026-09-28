// Attachment tools against a fake database and Storage: every upload needs a
// place and a reason, links are fragment links (upload) or short-lived signed
// links (download), the storage path is never shown to the model, and the file
// is removed from Storage before its row. The live check is tests/browser/attachments_flow.mjs.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerAttachFile } from "../../supabase/functions/mcp/tools/attach_file.ts";
import { registerGetAttachmentLink } from "../../supabase/functions/mcp/tools/get_attachment_link.ts";
import { registerDescribeAttachment } from "../../supabase/functions/mcp/tools/describe_attachment.ts";
import { registerDeleteAttachment } from "../../supabase/functions/mcp/tools/delete_attachment.ts";

// Edge Runtime globals used by chunkAndEmbed / scheduleEmbedPending.
const g = globalThis as Record<string, unknown>;
g.Supabase = { ai: { Session: class { run() { return Promise.resolve(new Array(384).fill(0.01)); } } } };
g.EdgeRuntime = { waitUntil: () => {} };
Deno.env.set("SUPABASE_URL", "https://project.example");
const kicks: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: string) => {
  kicks.push(String(url));
  return Promise.resolve(new Response(null, { status: 202 }));
}) as typeof fetch;
addEventListener("unload", () => { globalThis.fetch = realFetch; });

const SPACE = { id: "11111111-1111-4111-8111-111111111111", name: "Work", description: null, parent_id: null, is_restricted: false };
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const ATT_ID = "44444444-4444-4444-8444-444444444444";
const KEY = `00000000-0000-4000-a000-00000000000a/${ATT_ID}/whiteboard.png`;
const TOKEN = "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";
const SIGNED = "https://project.example/storage/v1/object/sign/attachments/x?token=signed";

function fakeDb(calls: string[]) {
  return {
    from(name: string) {
      return {
        select(cols: string) {
          calls.push(`select ${name}: ${cols}`);
          return { then: (res: (v: unknown) => unknown) => res({ data: name === "space" ? [SPACE] : [], error: null }) };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push(`rpc ${fn} ${JSON.stringify(args)}`);
      const data: Record<string, unknown> = {
        get_item: { id: ITEM_ID, title: "Teams routing design", space: { id: SPACE.id } },
        save_item: ITEM_ID,
        create_attachment_upload: { token: TOKEN, expires_at: "2026-09-30T00:15:00Z" },
        get_attachment: {
          id: ATT_ID, filename: "whiteboard.png", mime_type: "image/png", size_bytes: 1234, caption: null,
          description: null, storage_key: KEY, created_at: "2026-09-30T00:00:00Z",
          item: { id: ITEM_ID, title: "Teams routing design" },
        },
        set_attachment_description: { attachment_id: ATT_ID, filename: "whiteboard.png", chunks_pending: 1 },
        delete_attachment: { attachment_id: ATT_ID, filename: "whiteboard.png", storage_key: KEY, deleted: true },
      };
      if (!(fn in data)) throw new Error(`unexpected rpc ${fn}`);
      return Promise.resolve({ data: data[fn], error: null });
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string, seconds: number, opts: unknown) {
            calls.push(`sign ${bucket} ${path} ${seconds} ${JSON.stringify(opts)}`);
            return Promise.resolve({ data: { signedUrl: SIGNED }, error: null });
          },
          remove(paths: string[]) {
            calls.push(`remove ${bucket} ${JSON.stringify(paths)}`);
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}

async function call(method: string, params: unknown, calls: string[] = []) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db: fakeDb(calls), userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerAttachFile, registerGetAttachmentLink, registerDescribeAttachment, registerDeleteAttachment]) {
    r(server, ctx);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  return await res.json();
}

const tool = (name: string, args: Record<string, unknown>, calls: string[] = []) =>
  call("tools/call", { name, arguments: args }, calls);
const result = (out: { result: { content: Array<{ text: string }> } }) => JSON.parse(out.result.content[0].text);

Deno.test("attach_file without a place and a reason asks the user first, touching nothing", async () => {
  for (const args of [{}, { space: "Work" }, { title: "Whiteboard" }, { description: "A photo" }]) {
    const calls: string[] = [];
    const out = await tool("attach_file", args, calls);
    assert(out.result.isError, JSON.stringify(out));
    assert(/Ask the user where the file belongs/.test(out.result.content[0].text));
    assertEquals(calls, []);
  }
});

Deno.test("attach_file refuses item_id together with new-item fields", async () => {
  const calls: string[] = [];
  const out = await tool("attach_file", { item_id: ITEM_ID, space: "Work", title: "x" }, calls);
  assert(out.result.isError);
  assertEquals(calls, []);
});

Deno.test("attach_file to an existing item returns a #t= upload link and passes the description", async () => {
  const calls: string[] = [];
  const out = await tool("attach_file", { item_id: ITEM_ID, description: "Whiteboard: SBC -> falcon queue" }, calls);
  assert(!out.result.isError, JSON.stringify(out));
  const r = result(out);
  assertEquals(r.upload_link, `https://hassan-wehbe.github.io/digital-assistant/files/upload#t=${TOKEN}`);
  assertEquals(r.item, { id: ITEM_ID, title: "Teams routing design", space: "Work", created: false });
  assert(calls.some((c) => c.startsWith("rpc create_attachment_upload") && c.includes("falcon queue")));
  assert(!calls.some((c) => c.startsWith("rpc save_item")), "no new item");
});

Deno.test("attach_file with a space and title creates the item first", async () => {
  const calls: string[] = [];
  const out = await tool("attach_file", { space: "Work", title: "Whiteboard photo", note: "From Tuesday" }, calls);
  assert(!out.result.isError, JSON.stringify(out));
  const r = result(out);
  assertEquals(r.item.created, true);
  assertEquals(r.item.space, "Work");
  const save = calls.findIndex((c) => c.startsWith("rpc save_item"));
  const link = calls.findIndex((c) => c.startsWith("rpc create_attachment_upload"));
  assert(save >= 0 && link > save, calls.join("\n"));
  assert(calls[save].includes('"p_item_type":"note"') && calls[save].includes('"p_body":"From Tuesday"'));
});

Deno.test("get_attachment_link signs a 10-minute download link as the user and hides the storage path", async () => {
  const calls: string[] = [];
  const out = await tool("get_attachment_link", { attachment_id: ATT_ID }, calls);
  assert(!out.result.isError, JSON.stringify(out));
  const text = out.result.content[0].text;
  assert(!text.includes("storage_key") && !text.includes(`/${ATT_ID}/whiteboard.png"`), "no storage path");
  assertEquals(result(out).download_link, SIGNED);
  assert(calls.includes(`sign attachments ${KEY} 600 {"download":"whiteboard.png"}`), calls.join("\n"));
});

Deno.test("delete_attachment removes the Storage object before the database row", async () => {
  const calls: string[] = [];
  const out = await tool("delete_attachment", { attachment_id: ATT_ID }, calls);
  assert(!out.result.isError, JSON.stringify(out));
  const rm = calls.indexOf(`remove attachments ${JSON.stringify([KEY])}`);
  const del = calls.findIndex((c) => c.startsWith("rpc delete_attachment"));
  assert(rm >= 0 && del > rm, calls.join("\n"));
  assertEquals(result(out).deleted, true);
});

Deno.test("describe_attachment re-indexes and kicks background embedding", async () => {
  kicks.length = 0;
  const calls: string[] = [];
  const out = await tool("describe_attachment", { attachment_id: ATT_ID, description: "Call flow sketch" }, calls);
  assert(!out.result.isError, JSON.stringify(out));
  assert(calls.some((c) => c.startsWith("rpc set_attachment_description")));
  assertEquals(kicks, ["https://project.example/functions/v1/mcp/embed-pending"]);
});

Deno.test("descriptions warn against copying credentials; no input can carry a secret value", async () => {
  const out = await call("tools/list", {});
  const banned = /pass|secret|^value$|^key$|token|code|payload|plaintext/i;
  for (const t of out.result.tools) {
    for (const prop of Object.keys(t.inputSchema.properties ?? {})) {
      assert(!banned.test(prop), `${t.name}.${prop} looks like a value field`);
    }
  }
  for (const name of ["attach_file", "describe_attachment"]) {
    const t = out.result.tools.find((x: { name: string }) => x.name === name);
    assert(/never copy a password/i.test(t.description), `${name} must warn about credentials in pictures`);
  }
  const attach = out.result.tools.find((x: { name: string }) => x.name === "attach_file");
  assert(/ask them first/i.test(attach.description), "attach_file must say to ask for the place first");
});

Deno.test("invalid attachment ids are rejected before any database call", async () => {
  const calls: string[] = [];
  for (const name of ["get_attachment_link", "delete_attachment"]) {
    const out = await tool(name, { attachment_id: "not-a-uuid" }, calls);
    assertEquals(out.result?.isError ?? !!out.error, true);
  }
  assertEquals(calls, []);
});
