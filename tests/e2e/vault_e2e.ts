// End-to-end test of the vault against the deployed MCP server and database.
// Plays both sides: the assistant (MCP tool calls) and the owner's browser
// (vault pages: same crypto.js, same database functions). Every MCP response
// is scanned: no plaintext, no ciphertext, no payload field may appear.
//
// Needs a THROWAWAY test user with no vault (never your real account).
// Delete the user afterwards; that removes its spaces, secrets and logs.
//
//   E2E_EMAIL=... E2E_PASSWORD=... DENO_CERT=/root/.ccr/ca-bundle.crt \
//     deno run -A --config supabase/functions/mcp/deno.json tests/e2e/vault_e2e.ts
import { createVault, openSecret, sealSecret, unlockWithPassphrase } from "../../docs/vault/crypto.js";

const B = Deno.env.get("SUPABASE_URL") ?? "https://motvckmpusxiuelpwqxy.supabase.co";
const KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "sb_publishable_fUOMLFoWl6Avh7NqvhKBNQ_swuHkZGd";
const EMAIL = Deno.env.get("E2E_EMAIL")!;
const PASSWORD = Deno.env.get("E2E_PASSWORD")!;
const PASSPHRASE = crypto.randomUUID() + " e2e passphrase";
const V1 = { username: "e2e-user@example.invalid", password: `First-${crypto.randomUUID()}` };
const V2 = { username: "e2e-user@example.invalid", password: `Second-${crypto.randomUUID()}` };
const PRIVATE = { text: `Private note ${crypto.randomUUID()}` };

const forbidden: string[] = [V1.password, V2.password, PRIVATE.text, PASSPHRASE, "payload"];
function assert(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`  ok: ${what}`);
}

const signIn = await fetch(`${B}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
assert(signIn.ok, `sign-in (${signIn.status})`);
const token = (await signIn.json()).access_token as string;

let n = 0;
async function mcp(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${B}/functions/v1/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  for (const f of forbidden) if (raw.includes(f)) throw new Error(`LEAK: ${name} response contains ${JSON.stringify(f)}`);
  const out = JSON.parse(raw);
  if (out.error) throw new Error(`${name}: protocol error ${JSON.stringify(out.error)}`);
  const text = out.result.content[0].text as string;
  console.log(`${name}${out.result.isError ? " (tool error)" : ""}: ${text.slice(0, 160).replaceAll("\n", " ")}`);
  return { isError: !!out.result.isError, text, data: out.result.isError ? null : JSON.parse(text) };
}

/** The vault page's database calls: same functions, the owner's browser session. */
async function page(fn: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${B}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${fn}: ${body.message ?? res.status}`);
  return body;
}
const tokenOf = (link: string) => new URL(link).hash.replace(/^#t=/, "");

async function enter(link: string, fields: Record<string, string>) {
  const t = tokenOf(link);
  const req = await page("get_secret_entry_request", { p_token: t });
  const payload = sealSecret(req.public_key, req.secret_id, req.secret_type, fields);
  forbidden.push(payload);
  await page("complete_secret_entry", { p_token: t, p_payload_enc: payload });
  return req.secret_id as string;
}

async function reveal(link: string) {
  const t = tokenOf(link);
  const meta = await page("get_reveal_request", { p_token: t });
  const keys = unlockWithPassphrase(await page("get_vault_keys"), PASSPHRASE);
  const sealed = await page("reveal_secret", { p_token: t });
  assert(sealed.secret_id === meta.secret_id, "reveal returns the secret the link was for");
  return openSecret(keys, sealed.payload_enc, sealed.secret_id).fields;
}

console.log("1. vault not set up yet");
const early = await mcp("save_secret", { space: "Work", name: "x", secret_type: "login" });
assert(early.isError && early.text.includes("/vault/setup"), "save_secret before setup points to the setup page");

console.log("2. owner sets up the vault in the browser");
const { record } = createVault(PASSPHRASE);
await page("setup_vault", {
  p_public_key: record.public_key, p_wrapped_private_key: record.wrapped_private_key,
  p_recovery_wrapped_private_key: record.recovery_wrapped_private_key,
  p_vault_salt: record.vault_salt, p_kdf_params: record.kdf_params,
});

console.log("3. save a login (assistant gets a link, owner types the value)");
await mcp("create_space", { name: "Work" });
await mcp("create_space", { name: "Private", restricted: true });
const saved = await mcp("save_secret", {
  space: "Work", name: "Gartner sandbox login", secret_type: "login", url: "https://sandbox.gartner.example",
});
assert(/\/vault\/enter#t=[A-Za-z0-9_-]{43}$/.test(saved.data.entry_link), "entry link uses a #t= fragment");
const id = await enter(saved.data.entry_link, V1);
assert(id === saved.data.secret.id, "the stored secret has the id the assistant was told");
let reused = false;
try { await enter(saved.data.entry_link, V1); } catch { reused = true; }
assert(reused, "an entry link works once");

const priv = await mcp("save_secret", { space: "Private", name: "Gartner private note", secret_type: "note" });
await enter(priv.data.entry_link, PRIVATE);

console.log("4. find (restricted space excluded)");
const found = await mcp("find_secret", { query: "gartner" });
assert(found.data.results.length === 1 && found.data.results[0].name === "Gartner sandbox login",
  "find_secret returns only the non-restricted secret");
const scoped = await mcp("find_secret", { space: "Private" });
assert(scoped.data.results.length === 0, "find_secret scoped to a restricted space returns nothing");

console.log("5. reveal (owner unlocks with the passphrase)");
const got = await mcp("get_secret", { name: "gartner sandbox login" });
assert(/\/vault\/reveal#t=/.test(got.data.reveal_link), "get_secret returns a reveal link");
const v1 = await reveal(got.data.reveal_link);
assert(v1.password === V1.password && v1.username === V1.username, "decrypted value matches what was typed");
let reusedReveal = false;
try { await reveal(got.data.reveal_link); } catch { reusedReveal = true; }
assert(reusedReveal, "a reveal link works once");

console.log("6. new value, rename, reveal again");
const upd = await mcp("update_secret", { secret_id: id, new_value: true, name: "Gartner sandbox (EU)" });
assert(upd.data.secret.name === "Gartner sandbox (EU)", "renamed");
await enter(upd.data.entry_link, V2);
const v2 = await reveal((await mcp("get_secret", { secret_id: id })).data.reveal_link);
assert(v2.password === V2.password, "reveal shows the new value");

console.log("7. the database refuses ciphertext to users");
const direct = await fetch(`${B}/rest/v1/secret?select=payload_enc`, {
  headers: { apikey: KEY, authorization: `Bearer ${token}` },
});
assert(direct.status === 401 || direct.status === 403, `select payload_enc over REST is refused (${direct.status})`);

console.log("8. access log and delete");
const del = await mcp("delete_secret", { secret_id: id });
assert(del.data.deleted, "deleted");
const log = await (await fetch(`${B}/rest/v1/secret_access_log?select=action,channel&secret_id=eq.${id}&order=occurred_at`, {
  headers: { apikey: KEY, authorization: `Bearer ${token}` },
})).json();
const actions = log.map((r: { action: string }) => r.action).join(",");
assert(actions === "create,reveal,update,update,reveal,delete", `access log: ${actions}`);
const gone = await mcp("get_secret", { secret_id: id });
assert(gone.isError, "a deleted secret is gone");

console.log(`\nVault E2E: all assertions passed; ${n} MCP responses scanned, no values or ciphertext leaked.`);
