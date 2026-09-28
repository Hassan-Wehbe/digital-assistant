// Real-browser test of attachments against the live project: attach_file ->
// upload page (a PNG and a .vsdx, one wrong file refused) -> find both by
// search -> download link -> delete. The page is served locally the way GitHub
// Pages serves it (tests/browser/serve.py); tool calls go to the deployed MCP server.
//
// Needs a THROWAWAY test user (never your real account); delete it afterwards,
// which removes its spaces, items and attachment rows. Its Storage files are
// deleted by this test (delete_attachment) or can be removed in the dashboard.
// From the repo root:
//   python3 tests/browser/serve.py docs &
//   E2E_EMAIL=... E2E_PASSWORD=... node tests/browser/attachments_flow.mjs
// Optional: PLAYWRIGHT=/path/to/playwright/index.mjs, BROWSER_ARGS="--proxy-server=..."
import { deflateRawSync } from "node:zlib";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const LOCAL = "http://127.0.0.1:8765/digital-assistant/files";
const B = process.env.SUPABASE_URL ?? "https://motvckmpusxiuelpwqxy.supabase.co";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_fUOMLFoWl6Avh7NqvhKBNQ_swuHkZGd";
const { E2E_EMAIL: EMAIL, E2E_PASSWORD: PW } = process.env;
const RUN = Math.random().toString(36).slice(2, 8);
const ok = (c, m) => { if (!c) throw new Error("FAILED: " + m); console.log("  ok:", m); };

// A 1x1 PNG and a small .vsdx (zip of Visio XML parts) built here.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
function zip(files) {
  const parts = [], central = [];
  const le = (n, b) => Buffer.from(Array.from({ length: b }, (_, i) => (n >>> (8 * i)) & 0xff));
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), nm = Buffer.from(name);
    const local = Buffer.concat([le(0x04034b50, 4), le(20, 2), le(0, 2), le(8, 2), le(0, 8), le(data.length, 4),
      le(raw.length, 4), le(nm.length, 2), le(0, 2), nm, data]);
    central.push(Buffer.concat([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(8, 2), le(0, 8),
      le(data.length, 4), le(raw.length, 4), le(nm.length, 2), le(0, 8), le(0, 4), le(offset, 4), nm]));
    parts.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...parts, cd, le(0x06054b50, 4), le(0, 4), le(files.length, 2), le(files.length, 2),
    le(cd.length, 4), le(offset, 4), le(0, 2)]);
}
const WORD = `kestrel${RUN}`;
const VSDX = zip([
  ["visio/document.xml", "<VisioDocument/>"],
  ["visio/pages/pages.xml", "<Pages><Page ID='0' Name='Call flow'><Rel r:id='rId1'/></Page></Pages>"],
  ["visio/pages/_rels/pages.xml.rels", "<Relationships><Relationship Id='rId1' Target='page1.xml'/></Relationships>"],
  ["visio/pages/page1.xml", `<PageContents><Shapes><Shape><Text>Ingress SBC</Text></Shape><Shape><Text>${WORD} overflow queue</Text></Shape></Shapes></PageContents>`],
]);

const tok = (await (await fetch(B + "/auth/v1/token?grant_type=password", { method: "POST",
  headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).access_token;
ok(!!tok, "signed in (for the assistant's tool calls)");
let n = 0;
async function mcp(name, args) {
  const r = await fetch(B + "/functions/v1/mcp", { method: "POST", headers: { authorization: "Bearer " + tok,
    "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) });
  const out = JSON.parse(await r.text());
  const text = out.result.content[0].text;
  return { isError: !!out.result.isError, text, data: out.result.isError ? null : JSON.parse(text) };
}

const browser = await chromium.launch({ args: (process.env.BROWSER_ARGS ?? "").split(" ").filter(Boolean) });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("status of 410")) errors.push(m.text()); });
const local = (link) => link.replace("https://hassan-wehbe.github.io/digital-assistant/files", LOCAL);

console.log("attach_file");
const none = await mcp("attach_file", { description: "a photo" });
ok(none.isError && /Ask the user where the file belongs/.test(none.text), "no place or reason: refused, asks the user first");
await mcp("create_space", { name: "Flow" });
const att = await mcp("attach_file", { space: "Flow", title: `Routing design ${RUN}`, note: "Test item",
  description: `Whiteboard: caller to SBC to falcon${RUN} queue` });
ok(!att.isError && /\/files\/upload#t=/.test(att.data.upload_link) && att.data.item.created, "new item + upload link");

console.log("upload page");
await page.goto(local(att.data.upload_link));
await page.fill("#email", EMAIL); await page.fill("#password", PW); await page.click("#login button");
await page.waitForSelector("#pick:not([hidden])", { timeout: 20000 });
ok((await page.textContent("#m-item")) === `Routing design ${RUN}`, "page shows the item");
ok((await page.textContent("#m-desc")).includes(`falcon${RUN}`), "page shows the description from the chat");
await page.setInputFiles("#files", [{ name: "fake.png", mimeType: "image/png", buffer: VSDX }]);
ok((await page.textContent("#status")).includes("not a PNG picture"), "a zip named .png is refused");
await page.setInputFiles("#files", [
  { name: "whiteboard.png", mimeType: "image/png", buffer: PNG },
  { name: "Routing v2.vsdx", mimeType: "application/octet-stream", buffer: VSDX },
]);
await page.waitForFunction(() => document.querySelectorAll("#list .file").length === 2);
ok((await page.textContent("#list")).includes("words of diagram text found"), "Visio text read in the browser");
await page.fill("#list .file:nth-child(1) input", "Photo from the workshop");
await page.click("#upload");
await page.waitForSelector("#done:not([hidden])", { timeout: 30000 });
ok((await page.textContent("#done-summary")).startsWith("2 files attached"), "2 files attached");
ok((await page.textContent("#done-list")).includes("whiteboard.png (with the description from the chat)"),
  "description went to the only picture");

console.log("search, get_item, download");
const byVisio = await mcp("search_items", { query: WORD });
ok(byVisio.data.results.some((r) => r.id === att.data.item.id), "found by Visio text");
const byDesc = await mcp("search_items", { query: `falcon${RUN}` });
ok(byDesc.data.results.some((r) => r.id === att.data.item.id), "found by the picture description");
const byCaption = await mcp("search_items", { query: "workshop photo", space: "Flow" });
ok(byCaption.data.results.some((r) => r.id === att.data.item.id), "found by caption");
const item = await mcp("get_item", { item_id: att.data.item.id });
ok(item.data.attachments.length === 2, "get_item lists 2 attachments");
ok(!item.text.includes("storage_key"), "no storage path shown to the model");
const png = item.data.attachments.find((a) => a.filename === "whiteboard.png");
ok(png.size_bytes === PNG.length && png.mime_type === "image/png", "size and type recorded from Storage");
const link = await mcp("get_attachment_link", { attachment_id: png.id });
const dl = await fetch(link.data.download_link);
ok(dl.ok && Buffer.from(await dl.arrayBuffer()).equals(PNG), "download link returns the same bytes");

console.log("one-time link, delete");
await page.goto("about:blank");
await page.goto(local(att.data.upload_link));
await page.waitForFunction(() => document.getElementById("status").className === "error", null, { timeout: 20000 });
ok((await page.textContent("#status")).includes("already used"), "upload link works once");
const del = await mcp("delete_attachment", { attachment_id: png.id });
ok(!del.isError && del.data.deleted, "delete_attachment");
const after = await fetch(link.data.download_link);
ok(!after.ok, "the file is gone from Storage");
const vsdx = (await mcp("get_item", { item_id: att.data.item.id })).data.attachments[0];
await mcp("delete_attachment", { attachment_id: vsdx.id });
ok((await mcp("get_item", { item_id: att.data.item.id })).data.attachments.length === 0, "no attachments left");

ok(errors.length === 0, "no page errors: " + JSON.stringify(errors));
await browser.close();
console.log("ATTACHMENTS FLOW: all passed");
