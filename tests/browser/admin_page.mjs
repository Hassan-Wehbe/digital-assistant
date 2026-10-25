// Real-browser check of the admin page (docs/admin/, usage tracking step 3) against a PRETEND
// database: every Supabase call is answered here, so no account is needed and nothing live is
// touched. Checks: sign-in, an admin sees the tabs, tiles and charts with no page or CSP errors and
// no sideways scrolling on a phone, the email appears only on tap (one admin_user_email call) and
// hides again, the filter, and a non-admin sees "Not available" after am_i_admin alone. From the
// repo root:
//   python3 tests/browser/serve.py docs &
//   node tests/browser/admin_page.mjs            (SHOTS=/some/dir to keep screenshots)
// Optional: PLAYWRIGHT=/path/to/playwright/index.mjs
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const OUT = process.env.SHOTS;
const ok = (c, m) => { if (!c) throw new Error("FAILED: " + m); console.log("  ok:", m); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = "x." + b64({ sub: "11111111-aaaa", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", email: "owner@example.com" }) + ".sig";
let seed = 3; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const today = "2026-10-25";
const day = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const rows = [], active = [];
for (let n = 0; n < 50; n++) {
  const d = day(n);
  for (const k of ["chat", "day_plan", "classify", "memory", "outing", "recipe_suggest", "recipe_import"]) {
    rows.push({ day: d, kind: k, detail: "", count: Math.round(rnd() * 20), cost_cents: 0 });
    rows.push({ day: d, kind: k, detail: "model-x", count: 0, cost_cents: +(rnd() * (k === "chat" ? 30 : 5)).toFixed(4) });
  }
  rows.push({ day: d, kind: "mapbox", detail: "", count: Math.round(rnd() * 40), failures: Math.round(rnd()) });
  rows.push({ day: d, kind: "weather", detail: "", count: Math.round(rnd() * 20), failures: 0 });
  rows.push({ day: d, kind: "error", detail: "chat:connection", count: Math.round(rnd() * 2) });
  active.push({ day: d, users: 10 + Math.round(rnd() * 8), pro: Math.round(rnd() * 3) });
}
const users = Array.from({ length: 25 }, (_, i) => ({
  user_id: `${(1000 + i).toString(16)}aaaa-0000-0000-0000-000000000000`, short_id: `${(1000 + i).toString(16)}aaaa`,
  plan: i % 5 ? "free" : "pro", joined: "2026-10-01", active_days: i === 24 ? 0 : Math.round(rnd() * 25),
  cost_cents: +(rnd() * (i < 2 ? 400 : 80)).toFixed(4),
  kinds: { message: { count: Math.round(rnd() * 200) }, mapbox: { count: Math.round(rnd() * 30) }, fair_use_hit: { count: i < 3 ? 2 : 0 } },
  snapshot: i % 3 ? { notes: Math.round(rnd() * 300), memories: 12, storage_bytes: Math.round(rnd() * 5e7) } : null,
}));
const calls = [];
async function mock(page, admin) {
  await page.route("https://motvckmpusxiuelpwqxy.supabase.co/**", async (route) => {
    const url = route.request().url();
    const fn = url.split("/rpc/")[1];
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.includes("/auth/v1/token")) return json({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: "11111111-aaaa", email: "owner@example.com", aud: "authenticated" } });
    if (url.includes("/auth/v1/logout")) return route.fulfill({ status: 204 });
    calls.push(fn);
    if (fn === "am_i_admin") return json(admin);
    if (!admin) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "admin only" }) });
    if (fn === "admin_usage_maintenance") return json({ snapshots_taken: 25, rows_deleted: 0, kept_from: "2025-09-01" });
    if (fn === "admin_usage_overview") return json({ today, users: 25, pro_users: 5, active_today: 12, active_7: 18, active_30: 24, month: "2026-10-01", month_cost_cents: 2345.6, month_days_so_far: 25, month_days: 31, ai_months: [{ month: "2026-09-01", cost_cents: 1800, requests: 3000 }, { month: "2026-10-01", cost_cents: 2345.6, requests: 3500 }], tracking_since: day(49) });
    if (fn === "admin_usage_daily") return json({ rows, active });
    if (fn === "admin_usage_users") return json(users);
    if (fn === "admin_user_email") return json("tester@example.com");
    return route.fulfill({ status: 404 });
  });
}
const browser = await chromium.launch();
  const errors = [];
  for (const [admin, scheme, w] of [[true, "light", 1200], [true, "dark", 390], [false, "light", 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !(m.text().includes("403") && !admin)) errors.push(m.text()); });
    await mock(page, admin);
    await page.goto("http://127.0.0.1:8765/digital-assistant/admin/");
    await page.waitForSelector("#login:not([hidden])");
    await page.fill("#email", "owner@example.com"); await page.fill("#password", "pw"); await page.click("#login button");
    const tag = `${admin ? "admin" : "denied"}-${scheme}-${w}`;
    if (!admin) {
      await page.waitForSelector("#denied:not([hidden])");
      ok(calls.splice(0).join(",") === "am_i_admin", `${tag}: Not available, after am_i_admin alone`);
      if (OUT) await page.screenshot({ path: `${OUT}/${tag}.png` });
      continue;
    }
    await page.waitForSelector("#dash:not([hidden])");
    ok(calls.splice(0).join(",") === "am_i_admin,admin_usage_maintenance,admin_usage_overview,admin_usage_daily,admin_usage_users",
      `${tag}: the check, the upkeep, then the numbers`);
    ok((await page.$$(".tile")).length === 6, `${tag}: six tiles`);
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${tag}: no sideways scrolling`);
    ok((await page.$$("td.email")).length === 0, `${tag}: no email before a tap`);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-overview.png`, fullPage: true });
    await page.click("#tab-costs"); if (w > 500) await page.click('#range button[data-days="365"]');
    ok((await page.$$("#chart-cost rect")).length > 0, `${tag}: cost chart drawn`);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-costs.png`, fullPage: true });
    await page.click("#tab-users");
    await page.click("#table-users tbody tr:first-child");
    await page.waitForSelector("#table-users td.email");
    ok(await page.textContent("#table-users td.email") === "tester@example.com" && calls.splice(0).join(",") === "admin_user_email",
      `${tag}: the email on tap, one call`);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-users.png`, fullPage: true });
    await page.click("#table-users tbody tr:first-child");
    ok((await page.$$("#table-users td.email")).length === 0, `${tag}: hidden again on a second tap`);
    await page.fill("#find", "400a");
    ok((await page.textContent("#user-count")).startsWith("1 of 25"), `${tag}: filter by user id`);
    await ctx.close();
  }
await browser.close();
ok(errors.length === 0, "no page errors: " + errors.join(" | "));
