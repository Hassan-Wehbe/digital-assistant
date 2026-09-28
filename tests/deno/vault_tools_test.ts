// Vault tools against a fake database: no tool takes a secret value, the
// server never asks for payload_enc, and results carry metadata plus
// fragment links only (CLAUDE.md rule 1). The live check is tests/e2e/vault_e2e.ts.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerSaveSecret } from "../../supabase/functions/mcp/tools/save_secret.ts";
import { registerFindSecret } from "../../supabase/functions/mcp/tools/find_secret.ts";
import { registerGetSecret } from "../../supabase/functions/mcp/tools/get_secret.ts";
import { registerUpdateSecret } from "../../supabase/functions/mcp/tools/update_secret.ts";
import { registerDeleteSecret } from "../../supabase/functions/mcp/tools/delete_secret.ts";

const SPACE = { id: "11111111-1111-4111-8111-111111111111", name: "Work", description: null, parent_id: null, is_restricted: false };
const ROW = {
  id: "22222222-2222-4222-8222-222222222222", name: "Gartner sandbox", url: "https://sandbox.example",
  secret_type: "login", space_id: SPACE.id, created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z", last_accessed_at: null,
};
const TOKEN = "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";
const CIPHERTEXT = "q83vEjRWeJC0uw0ePx9PX2Z3";

function fakeDb(calls: string[]) {
  const table = (name: string) => ({
    select(cols: string) {
      calls.push(`select ${name}: ${cols}`);
      if (name === "secret") assert(!cols.includes("payload"), "server must never select payload_enc");
      const rows = name === "space" ? [SPACE] : [{ ...ROW, payload_enc: CIPHERTEXT }];
      const q = {
        eq: () => q,
        maybeSingle: () => Promise.resolve({ data: rows[0], error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
      };
      return q;
    },
  });
  return {
    from: table,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push(`rpc ${fn} ${JSON.stringify(args)}`);
      const expires_at = "2026-09-28T00:15:00Z";
      const data: Record<string, unknown> = {
        vault_status: { set_up: true, key_version: 1 },
        create_secret_entry: { token: TOKEN, secret_id: ROW.id, expires_at },
        create_secret_reentry: { token: TOKEN, secret_id: ROW.id, expires_at },
        create_reveal_token: { token: TOKEN, expires_at },
        find_secrets: [{ ...ROW, secret_id: ROW.id }],
        update_secret_meta: null,
        delete_secret: { secret_id: ROW.id, name: ROW.name, deleted: true },
      };
      if (!(fn in data)) throw new Error(`unexpected rpc ${fn}`);
      return Promise.resolve({ data: data[fn], error: null });
    },
  } as unknown as SupabaseClient;
}

async function call(method: string, params: unknown, calls: string[] = []) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db: fakeDb(calls), userId: "u", accessToken: "t" };
  for (const r of [registerSaveSecret, registerFindSecret, registerGetSecret, registerUpdateSecret,
                   registerDeleteSecret]) r(server, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  return await res.json();
}

Deno.test("no vault tool has an input that could carry a secret value", async () => {
  const out = await call("tools/list", {});
  const banned = /pass|secret_value|^value$|^key$|token|code|payload|plaintext|ciphertext/i;
  for (const t of out.result.tools) {
    for (const prop of Object.keys(t.inputSchema.properties ?? {})) {
      assert(!banned.test(prop), `${t.name}.${prop} looks like a value field`);
    }
    assert(/never/i.test(t.description) || t.name === "delete_secret" || t.name === "find_secret",
      `${t.name} description should tell the model never to take values`);
  }
});

Deno.test("each vault tool returns metadata and #t= links only", async () => {
  const cases: Array<[string, Record<string, unknown>, RegExp | null]> = [
    ["save_secret", { space: "Work", name: "Gartner sandbox", secret_type: "login" }, /\/vault\/enter#t=tok_/],
    ["find_secret", { query: "gartner" }, null],
    ["get_secret", { name: "gartner sandbox" }, /\/vault\/reveal#t=tok_/],
    ["get_secret", { secret_id: ROW.id }, /\/vault\/reveal#t=tok_/],
    ["update_secret", { secret_id: ROW.id, new_value: true }, /\/vault\/enter#t=tok_/],
    ["update_secret", { secret_id: ROW.id, name: "Renamed" }, null],
    ["delete_secret", { secret_id: ROW.id }, null],
  ];
  for (const [name, args, link] of cases) {
    const calls: string[] = [];
    const out = await call("tools/call", { name, arguments: args }, calls);
    const text = JSON.stringify(out);
    assert(!out.result.isError, `${name}: ${text}`);
    assert(!text.includes(CIPHERTEXT) && !text.includes("payload"), `${name} leaked ciphertext`);
    assert(!text.includes("?t="), `${name}: token must be in the fragment`);
    if (link) assert(link.test(text), `${name}: expected a link, got ${text}`);
    else assert(!text.includes(TOKEN), `${name}: unexpected token`);
    assert(calls.every((c) => !/payload/.test(c)), `${name}: ${calls}`);
  }
});

Deno.test("an unknown secret_type is rejected before any database call", async () => {
  const calls: string[] = [];
  const out = await call("tools/call", {
    name: "save_secret", arguments: { space: "Work", name: "x", secret_type: "credit_card" },
  }, calls);
  assertEquals(out.result?.isError ?? !!out.error, true);
  assertEquals(calls, []);
});
