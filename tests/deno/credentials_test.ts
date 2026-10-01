// CLAUDE.md rule 9: save_item / update_item / attach_file / describe_attachment refuse text
// that looks like a credential, without echoing it, and still save ordinary text that only
// talks about passwords.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCredential, scanFields } from "../../supabase/functions/mcp/lib/credentials.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";
import { registerAttachFile } from "../../supabase/functions/mcp/tools/attach_file.ts";
import { registerDescribeAttachment } from "../../supabase/functions/mcp/tools/describe_attachment.ts";

// Key-shaped test values are assembled at run time so secret scanners do not flag this file.
function fake(prefix: string, n: number, alphabet = "aB3dE5gH7jK9mN2pQ4sT6vW8yZ0cF1"): string {
  let out = prefix;
  for (let i = 0; i < n; i++) out += alphabet[(i * 7 + 3) % alphabet.length];
  return out;
}

const TRAPS: [string, string][] = [
  // Casual phrasing, the way people actually type it.
  ["the wifi is hunter2, save it in Home", "password"],
  ["Wifi password: Sunflower2024!", "password"],
  ["my netflix password is fluffy and my email is ...", "password"],
  ["My password for the bank is Tr0ub4dor&3", "password"],
  ["I changed my password to Kitten77", "password"],
  ["Mom's password is sunshine", "password"],
  ["The guest wifi password is sunshine.", "password"],
  ["Network\nSSID: HomeNet\nPassword: marigold", "password"],
  ["password = 'correct horse battery staple'", "password"],
  ["router sticker: wifi password Sunflower2024!", "password"],
  ["Passwort: Geheim123", "password"],
  ["mot de passe : soleil2024", "password"],
  ["PIN: 4821", "PIN"],
  ["my bank card pin is 0937", "PIN"],
  ["pin code 55102", "PIN"],
  ["The garage code is 4321#", "access code"],
  ["alarm code: 908172", "access code"],
  ["CVV 123", "access code"],
  ["DB_PASSWORD=Xk9p2LmQ", "password"],
  ['{"user": "bob", "password": "Pa55word!"}', "password"],
  // Known formats.
  [`Use this key: ${fake("sk-ant-api03-", 40)}`, "API key or token"],
  [`OPENAI_API_KEY=${fake("sk-proj-", 48)}`, "API key or token"],
  [`token ${fake("ghp_", 36)}`, "API key or token"],
  ["aws id AKIA" + "Q3EXAMPLE7ZYXWVU", "API key or token"],
  [`maps key ${fake("AIza", 35)}`, "API key or token"],
  [`stripe ${fake("sk_live_", 24)}`, "API key or token"],
  [fake("eyJ", 20) + "." + fake("eyJ", 30) + "." + fake("", 40), "API key or token"],
  ["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----", "private key"],
  ["api key: " + fake("", 32, "0123456789abcdef"), "API key or token"],
  ["client_secret = " + fake("", 24), "API key or token"],
  ["postgres://admin:Xk9p2LmQ@db.example.com:5432/app", "connection string with a password"],
  ["Visa 4111 1111 1111 1111 exp 12/29", "card number"],
  ["card: 5555-5555-5555-4444", "card number"],
];

const ORDINARY: string[] = [
  // Recipes and notes that mention the word.
  "Grandma's secret ingredient is a pinch of nutmeg.",
  "Secret: 2 tbsp fish sauce, added at the end.",
  "Pin the dough to the board and fold it in thirds; bake 25 minutes at 200C.",
  "Remember to change the wifi password every year.",
  "The wifi is slow upstairs; move the router.",
  "The wifi is 5GHz only, the printer needs 2.4GHz.",
  "My password is stored in the vault under Bank.",
  "My password is weak, change it this weekend.",
  "The password is required and must be at least 12 characters.",
  "Password: see the vault (Home Wi-Fi).",
  "Password: in Bitwarden",
  "PIN is 4 digits; the bank locks the card after 3 wrong tries.",
  "Mountain pass: 2300m, open June to October.",
  // Technical designs.
  "Users reset their password through an email link (Supabase Auth).",
  "password: z.string().min(12)",
  "password: string",
  "password_hash: text not null",
  "const argon2id = (password: Uint8Array, salt: Uint8Array) => ...",
  "Owner setup and first password: `docs/phase1-m2-setup.md`.",
  "Password: https://example.com/reset (link in the email)",
  "password = request.form['password']",
  "DB_PASSWORD=${DB_PASSWORD}",
  'const password = Deno.env.get("DB_PASSWORD");',
  "postgres://postgres:[YOUR-PASSWORD]@db.abc.supabase.co:5432/postgres",
  "postgres://user:password@localhost:5432/dev",
  "api_key: <your key here>",
  "API key: stored in Supabase secrets as ANTHROPIC_API_KEY",
  "Token: ERC-20",
  "The access token expires after 1 hour; refresh tokens last 30 days.",
  "Password: ********",
  'Password: "see the vault"',
  '"password": "stored in Bitwarden"',
  "ISBN 978-0-306-40615-7, page 1234",
  "Call 0412 345 678 after 5pm",
  "Item id 3f2a9c1e-0b5d-4e8a-9f6b-2c7d1e0a4b3c",
  "Order 1234-5678-9012 shipped",
  "Hash the password Argon2id-style with a per-user salt.",
  "GPIO pin 13 drives the LED; pin 2 is ground.",
  "Commit 4b825dc642cb6eb9a060e54bf8d69288fbee4904 fixed the token refresh.",
];

for (const [text, kind] of TRAPS) {
  Deno.test(`catches: ${text.slice(0, 50)}`, () => {
    assertEquals(findCredential(text), kind);
  });
}

for (const text of ORDINARY) {
  Deno.test(`lets through: ${text.slice(0, 50)}`, () => {
    assertEquals(findCredential(text), null);
  });
}

Deno.test("scanFields checks metadata keys and tags, and names only the field", () => {
  assertEquals(scanFields({ title: "Router", metadata: { wifi_password: "Hunter2go" } }), {
    field: "metadata",
    kind: "password",
  });
  assertEquals(scanFields({ title: "Lock", tags: ["home", "pin 4821"] })?.field, "tags");
  assertEquals(scanFields({ title: "Soup", body: "Simmer 20 minutes.", metadata: { serves: 4 } }), null);
});

// ---- Through the tools --------------------------------------------------------------------

function fakeDb() {
  const calls: string[] = [];
  const db = {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve({ data: null, error: { message: "should not be reached" } });
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

async function call(name: string, args: Record<string, unknown>) {
  const { db, calls } = fakeDb();
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db, userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerSaveItem, registerUpdateItem, registerAttachFile, registerDescribeAttachment]) r(server, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const out = await res.json();
  return { isError: !!out.result.isError, text: out.result.content[0].text as string, calls };
}

const VALUE = "Sunflower2024!";
const KEY = fake("sk-ant-api03-", 40);
const ITEM = "11111111-1111-4111-8111-111111111111";

const REFUSED: [string, Record<string, unknown>, string][] = [
  ["save_item", { space: "Home", title: "Wifi", body: `Password: ${VALUE}`, item_type: "note" }, VALUE],
  ["save_item", { space: "Home", title: `wifi is ${VALUE}`, body: "router upstairs", item_type: "note" }, VALUE],
  ["save_item", { space: "Work", title: "API", body: "see below", item_type: "note", metadata: { api_key: KEY } }, KEY],
  ["update_item", { item_id: ITEM, body: `New key ${KEY}` }, KEY],
  ["update_item", { item_id: ITEM, change_note: `password is now ${VALUE}` }, VALUE],
  ["attach_file", { space: "Home", title: "Router label", note: `wifi password: ${VALUE}` }, VALUE],
  ["describe_attachment", { attachment_id: ITEM, description: `Sticker reading: password ${VALUE}` }, VALUE],
];

for (const [tool, args, secret] of REFUSED) {
  Deno.test(`${tool} refuses a credential without echoing it or touching the database`, async () => {
    const out = await call(tool, args);
    assertEquals(out.isError, true);
    assert(out.text.startsWith("Not saved:"), out.text);
    assert(out.text.includes("save_secret"));
    assert(!out.text.includes(secret), "the refusal must not repeat the value");
    for (let i = 0; i + 6 <= secret.length; i++) {
      assert(!out.text.includes(secret.slice(i, i + 6)), "no part of the value in the refusal");
    }
    assertEquals(out.calls, [], "nothing is saved, loaded or embedded");
  });
}

Deno.test("update_item with only harmless fields passes the check (reaches the database)", async () => {
  const out = await call("update_item", { item_id: ITEM, tags: ["weeknight"], change_note: "password rules updated" });
  assertEquals(out.calls, ["update_item"]);
  assert(!out.text.startsWith("Not saved:"));
});
