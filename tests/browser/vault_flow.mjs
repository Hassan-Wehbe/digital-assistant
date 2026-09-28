// Real-browser test of the vault pages against the live project: setup ->
// save (entry page) -> reveal -> recover with the recovery key -> reveal ->
// 30 s auto-hide. The pages are served locally the way GitHub Pages serves
// them (tests/browser/serve.py); tool calls go to the deployed MCP server.
//
// Needs a THROWAWAY test user with no vault (never your real account);
// delete it afterwards. From the repo root:
//   python3 tests/browser/serve.py docs &
//   E2E_EMAIL=... E2E_PASSWORD=... node tests/browser/vault_flow.mjs
// Optional: PLAYWRIGHT=/path/to/playwright/index.mjs, BROWSER_ARGS="--proxy-server=..."
// (in Claude Code on the web: the proxy plus --ignore-certificate-errors-spki-list
// set to the SHA-256 SPKI hash of the sandbox proxy's CA only).
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const LOCAL = "http://127.0.0.1:8765/digital-assistant/vault";
const B = process.env.SUPABASE_URL ?? "https://motvckmpusxiuelpwqxy.supabase.co";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_fUOMLFoWl6Avh7NqvhKBNQ_swuHkZGd";
const { E2E_EMAIL: EMAIL, E2E_PASSWORD: PW } = process.env;
const PASS1 = "flow test passphrase " + Math.random().toString(36).slice(2);
const PASS2 = "second flow passphrase " + Math.random().toString(36).slice(2);
const VALUE = "Browser-Flow-" + Math.random().toString(36).slice(2);
const ok = (c, m) => { if (!c) throw new Error("FAILED: " + m); console.log("  ok:", m); };

const browser = await chromium.launch({ args: (process.env.BROWSER_ARGS ?? "").split(" ").filter(Boolean) });
const ctx = await browser.newContext();
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:8765" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// The expected "link already used" refusal comes back as HTTP 410 (PT410), which
// the browser logs; ignore only that.
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("status of 410")) errors.push(m.text());
});
const local = (link) => link.replace("https://hassan-wehbe.github.io/digital-assistant/vault", LOCAL);

// token for MCP calls (the "assistant")
const tok = (await (await fetch(B + "/auth/v1/token?grant_type=password", { method: "POST",
  headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).access_token;
let n = 0;
async function mcp(name, args) {
  const r = await fetch(B + "/functions/v1/mcp", { method: "POST", headers: { authorization: "Bearer " + tok,
    "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) });
  const raw = await r.text();
  if (raw.includes(VALUE) || raw.includes(PASS1) || raw.includes(PASS2)) throw new Error("LEAK in " + name);
  return JSON.parse(JSON.parse(raw).result.content[0].text);
}

console.log("setup page");
await page.goto(LOCAL + "/setup");
await page.fill("#email", EMAIL); await page.fill("#password", PW); await page.click("#login button");
await page.waitForSelector("#choose:not([hidden])", { timeout: 20000 });
await page.fill("#pass1", "short"); await page.fill("#pass2", "short"); await page.check("#understand");
await page.click("#choose button.primary");
await page.waitForTimeout(500);
ok(await page.isHidden("#recovery") && await page.$eval("#pass1", (el) => !el.checkValidity()), "short passphrase refused (form validation)");
await page.fill("#pass1", PASS1); await page.fill("#pass2", PASS1);
await page.click("#choose button.primary");
await page.waitForSelector("#recovery:not([hidden])", { timeout: 30000 });
const rkey = (await page.textContent("#recovery-key")).trim();
ok(/^([A-Z2-7]{5}-){10}[A-Z2-7]{5}$/.test(rkey), "recovery key shown");
await page.fill("#confirm-key", rkey.replace(/.$/, rkey.endsWith("A") ? "B" : "A"));
await page.click("#recovery button.primary");
ok(/typo|not the recovery key|look like/.test(await page.textContent("#status")), "mistyped recovery key refused");
await page.fill("#confirm-key", rkey.toLowerCase());
await page.click("#recovery button.primary");
await page.waitForSelector("#done:not([hidden])", { timeout: 20000 });
ok((await page.textContent("#recovery-key")) === "", "recovery key wiped from the page after setup");
ok(await page.evaluate(() => Object.keys(localStorage).every((k) => k.startsWith("sb-"))), "only the login session is in localStorage");

console.log("save via entry page");
await mcp("create_space", { name: "Flow" });
const saved = await mcp("save_secret", { space: "Flow", name: "Flow test login", secret_type: "login", url: "https://flow.example" });
await page.goto(local(saved.entry_link));
await page.waitForSelector("#entry:not([hidden])", { timeout: 20000 });
ok((await page.textContent("#m-name")) === "Flow test login", "entry page shows the request");
await page.fill("#f-username", "flow-user"); await page.fill("#f-password", VALUE);
await page.click("#entry button.primary");
await page.waitForSelector("#done:not([hidden])", { timeout: 20000 });
ok(true, "saved");
const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
ok(!storage.includes(VALUE), "value not in browser storage");

console.log("reveal page");
const got = await mcp("get_secret", { name: "Flow test login" });
await page.goto(local(got.reveal_link));
await page.waitForSelector("#unlock:not([hidden])", { timeout: 20000 });
await page.fill("#passphrase", "wrong passphrase here");
await page.click("#unlock button.primary");
await page.waitForFunction(() => document.getElementById("status").className === "error", null, { timeout: 30000 });
ok((await page.textContent("#status")).includes("not right"), "wrong passphrase refused");
await page.fill("#passphrase", PASS1);
await page.click("#unlock button.primary");
await page.waitForSelector("#shown:not([hidden])", { timeout: 30000 });
ok(!(await page.textContent("#values")).includes(VALUE), "password masked until Show");
ok((await page.textContent("#values")).includes("flow-user"), "username shown");
await page.click("#values button:has-text('Show')");
ok((await page.textContent("#values")).includes(VALUE), "Show reveals the decrypted password");
await page.click("#values .secret-row:nth-child(2) button:has-text('Copy')");
ok((await page.evaluate(() => navigator.clipboard.readText())) === VALUE, "Copy puts it on the clipboard");
await page.click("#hide-now");
ok(!(await page.content()).includes(VALUE), "Hide now wipes the value from the page");
await page.goto("about:blank");
await page.goto(local(got.reveal_link));
await page.waitForFunction(() => document.getElementById("status").className === "error", null, { timeout: 20000 });
ok((await page.textContent("#status")).includes("already used"), "reveal link is single use");

console.log("recover page (recovery key -> new passphrase)");
await page.goto(LOCAL + "/recover");
await page.waitForSelector("#change:not([hidden])", { timeout: 20000 });
await page.fill("#recovery-key", rkey); await page.fill("#pass1", PASS2); await page.fill("#pass2", PASS2);
await page.click("#change button.primary");
await page.waitForSelector("#done:not([hidden])", { timeout: 30000 });
ok(true, "new passphrase set with the recovery key");
const got2 = await mcp("get_secret", { name: "Flow test login" });
await page.goto(local(got2.reveal_link));
await page.waitForSelector("#unlock:not([hidden])", { timeout: 20000 });
await page.fill("#passphrase", PASS2); await page.click("#unlock button.primary");
await page.waitForSelector("#shown:not([hidden])", { timeout: 30000 });
await page.click("#values button:has-text('Show')");
ok((await page.textContent("#values")).includes(VALUE), "new passphrase reveals the same secret");

console.log("30 s auto-hide");
await page.waitForSelector("#hidden-done:not([hidden])", { timeout: 40000 });
ok(!(await page.content()).includes(VALUE), "value gone after 30 s");
ok(errors.length === 0, "no page errors: " + JSON.stringify(errors));
await browser.close();
console.log("BROWSER FLOW: all passed");
