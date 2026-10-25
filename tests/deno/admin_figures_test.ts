// The admin page's arithmetic (docs/admin/figures.js): tiles, the daily and monthly series, the
// spread, side by side, the per-user table's filter and sort; step 4: Mapbox's price, the Pro price
// explorer, the month's totals and the CSV files.
import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  csv, dailyCsv, dailySeries, daysBetween, daysBefore, explore, mapboxCents, money, monthChoices, monthlySeries,
  monthsCsv, monthTotals, proCost, sideBySide, spread, tiles, userRows, usersCsv,
} from "../../docs/admin/figures.js";

const user = (id: string, cost: number, days: number, plan = "free", kinds: Record<string, number> = {}) => ({
  user_id: id + "-0000", short_id: id, plan, joined: "2026-10-01", active_days: days, cost_cents: cost,
  kinds: Object.fromEntries(Object.entries(kinds).map(([k, c]) => [k, { count: c }])), snapshot: null,
});

Deno.test("days: UTC, both ends included, across a month end", () => {
  assertEquals(daysBefore("2026-11-01", 1), "2026-10-31");
  assertEquals(daysBefore("2026-10-31", -1), "2026-11-01");
  assertEquals(daysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});

Deno.test("money: cents to dollars, fractions of a cent still visible", () => {
  assertEquals(money(1234), "$12.34");
  assertEquals(money(0.5), "$0.005");
  assertEquals(money(0), "$0.00");
});

Deno.test("Mapbox: free up to 100,000 a month, then $2.00 per 1,000", () => {
  assertEquals(mapboxCents(99_999), 0);
  assertEquals(mapboxCents(101_000), 200);
});

Deno.test("daily series: every day appears; AI cost by purpose; the rest by kind", () => {
  const s = dailySeries({
    rows: [
      { day: "2026-10-24", kind: "chat", detail: "", count: 3, cost_cents: 0 },
      { day: "2026-10-24", kind: "chat", detail: "some-model", count: 0, cost_cents: 1.5 },
      { day: "2026-10-24", kind: "day_plan", detail: "my_day", count: 1, cost_cents: 0.25 },
      { day: "2026-10-24", kind: "mapbox", detail: "", count: 4, failures: 1 },
      { day: "2026-10-24", kind: "error", detail: "chat:connection", count: 1 },
      { day: "2026-10-24", kind: "fair_use_hit", detail: "day_plan", count: 2 },
      { day: "2026-10-26", kind: "chat", detail: "", count: 9 }, // outside the range: ignored
    ],
    active: [{ day: "2026-10-24", users: 2, pro: 1 }],
  }, "2026-10-23", "2026-10-25");
  assertEquals(s.map((d) => d.day), ["2026-10-23", "2026-10-24", "2026-10-25"]);
  const d = s[1];
  assertEquals(d.cost.chat, 1.5);
  assertEquals(d.cost.day_plan, 0.25);
  assertEquals(d.aiCost, 1.75);
  assertEquals(d.requests, 4);
  assertEquals([d.mapbox, d.mapboxFailures, d.errors, d.limits, d.active, d.pro], [4, 1, 1, 2, 2, 1]);
  assertEquals(s[0].aiCost + s[2].aiCost, 0);
});

Deno.test("monthly series: added up by month; active users are the busiest day", () => {
  const s = dailySeries({
    rows: [
      { day: "2026-09-30", kind: "chat", count: 1, cost_cents: 1 },
      { day: "2026-10-01", kind: "chat", count: 2, cost_cents: 2 },
      { day: "2026-10-02", kind: "chat", count: 3, cost_cents: 3 },
    ],
    active: [{ day: "2026-10-01", users: 5, pro: 0 }, { day: "2026-10-02", users: 3, pro: 1 }],
  }, "2026-09-30", "2026-10-02");
  const m = monthlySeries(s);
  assertEquals(m.map((x) => [x.day, x.aiCost, x.requests, x.active, x.pro]), [["2026-09", 1, 1, 0, 0], ["2026-10", 5, 5, 5, 1]]);
});

Deno.test("tiles: cost per active user and the projections at this month's pace", () => {
  const overview = { users: 4, pro_users: 1, active_today: 1, active_7: 2, active_30: 3, month: "2026-10-01",
    month_cost_cents: 100, month_days_so_far: 10, month_days: 31 };
  const users = [user("a", 60, 3), user("b", 40, 1), user("c", 0, 0)];
  const t = tiles(overview, users, []);
  assertEquals([t.users, t.pro, t.activeMonth, t.cents], [4, 1, 2, 100]);
  assertEquals(t.perActive, 50);
  assertAlmostEquals(t.projectedMonth, 310);
  assertAlmostEquals(t.projectedYear, 3650);
  // Mapbox past the free tier is added to the month's cost.
  const series = [{ day: "2026-10-05", mapbox: 101_000 }, { day: "2026-09-30", mapbox: 50_000 }];
  // deno-lint-ignore no-explicit-any
  const t2 = tiles(overview, users, series as any);
  assertEquals([t2.mapboxMonth, t2.mapCents, t2.cents], [101_000, 200, 300]);
});

Deno.test("spread: four groups that do not overlap, only active users", () => {
  const users = Array.from({ length: 20 }, (_, i) => user(`u${i}`, i + 1, 1));
  users.push(user("idle", 999, 0));
  const sp = spread(users);
  assertEquals(sp.users, 20);
  assertEquals(sp.groups.map((g) => g.users), [10, 8, 1, 1]);
  assertEquals(sp.groups.reduce((s, g) => s + g.users, 0), 20);
  assertEquals(sp.groups[0].average, 5.5); // 1..10
  assertEquals(sp.groups[3].average, 20);
  assertAlmostEquals(sp.groups.reduce((s, g) => s + g.share, 0), 1);
});

Deno.test("spread: one, two and no active users", () => {
  assertEquals(spread([user("a", 5, 1)]).groups.map((g) => g.users), [0, 0, 0, 1]);
  assertEquals(spread([user("a", 5, 1), user("b", 1, 1)]).groups.map((g) => g.users), [1, 0, 0, 1]);
  assertEquals(spread([]).groups.map((g) => [g.users, g.average, g.share]), [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
});

Deno.test("side by side: Free and Pro, power users (top 10%, at least one) and the rest", () => {
  const users = [user("a", 90, 10, "pro", { message: 50 }), user("b", 6, 2), user("c", 4, 2), user("d", 0, 0, "pro")];
  const [free, pro, power, rest] = sideBySide(users);
  assertEquals([free.users, free.total, free.average, free.activeDays], [2, 10, 5, 2]);
  assertEquals([pro.users, pro.total, pro.messages], [1, 90, 50]);
  assertEquals([power.name, power.users, power.total], ["Power users (top 10%)", 1, 90]);
  assertEquals([rest.users, rest.total], [2, 10]);
});

const ids = (rows: { short_id: string }[]) => rows.map((u) => u.short_id);

Deno.test("per-user table: filter by plan and id, sort either way, ties by id", () => {
  const users = [user("bbb", 5, 1, "pro", { message: 3 }), user("aaa", 5, 2), user("ccc", 9, 1, "free", { message: 7 })];
  assertEquals(ids(userRows(users)), ["ccc", "aaa", "bbb"]);
  assertEquals(ids(userRows(users, { key: "cost", dir: 1 })), ["aaa", "bbb", "ccc"]);
  assertEquals(ids(userRows(users, { key: "messages" })), ["ccc", "bbb", "aaa"]);
  assertEquals(ids(userRows(users, { plan: "pro" })), ["bbb"]);
  assertEquals(ids(userRows(users, { plan: "free", text: " CC " })), ["ccc"]);
});

Deno.test("month choices: from the first tracked month to this one, newest first, at most 13", () => {
  assertEquals(monthChoices({ month: "2026-10-01", tracking_since: "2026-10-25" }), ["2026-10-01"]);
  assertEquals(monthChoices({ month: "2027-01-01", tracking_since: "2026-11-03" }), ["2027-01-01", "2026-12-01", "2026-11-01"]);
  assertEquals(monthChoices({ month: "2026-10-01", tracking_since: null }), ["2026-10-01"]);
  assertEquals(monthChoices({ month: "2028-10-01", tracking_since: "2026-01-01" }).length, 13);
});

Deno.test("Mapbox: an edited price and free tier", () => {
  assertEquals(mapboxCents(15_000, { free: 10_000, centsPer1000: 50 }), 250);
  assertEquals(mapboxCents(5_000, { free: 10_000, centsPer1000: 50 }), 0);
});

const overview = { month: "2026-10-01", month_days: 31, month_days_so_far: 10 };

Deno.test("Pro cost: the chosen group's average, the month in progress scaled to a whole month", () => {
  const users = [
    user("p1", 30, 5, "pro", { mapbox: 100 }), user("p2", 10, 2, "pro", { mapbox: 300 }), user("p3", 99, 0, "pro"),
    user("f1", 5, 3), user("f2", 1, 1),
  ];
  const pro = proCost(users, { basis: "pro", month: "2026-10-01", overview });
  assertEquals(pro.users, 2); // p3 was not active
  assertAlmostEquals(pro.aiCents, 20 * 3.1);
  assertEquals(pro.mapCents, 0);
  const paid = proCost(users, { basis: "pro", month: "2026-10-01", overview, payMapbox: true, price: { free: 0, centsPer1000: 200 } });
  assertAlmostEquals(paid.mapboxCalls, 200 * 3.1);
  assertAlmostEquals(paid.cents, 20 * 3.1 + 0.62 * 200);
  // A past month is a whole month already.
  assertEquals(proCost(users, { basis: "pro", month: "2026-09-01", overview }).aiCents, 20);
  assertEquals(proCost(users, { basis: "power", month: "2026-09-01", overview }).aiCents, 30); // top 10% of 4: one user
  assertEquals(proCost(users, { basis: "everyone", month: "2026-09-01", overview }).aiCents, 11.5);
  assertEquals(proCost([], { basis: "pro", month: "2026-09-01", overview }).cents, 0);
});

Deno.test("price explorer: fee, margin per user, month and year, break-even", () => {
  const r = explore({ price: 5, users: 100, feePercent: 15, costCents: 50 });
  assertAlmostEquals(r.fee, 75);
  assertAlmostEquals(r.net, 425);
  assertAlmostEquals(r.margin, 375);
  assertAlmostEquals(r.marginPercent, 0.75);
  assertAlmostEquals(r.month, 37_500);
  assertAlmostEquals(r.year, 450_000);
  assertAlmostEquals(r.breakEven, 50 / 0.85);
  const loss = explore({ price: 0.99, users: 10, feePercent: 30, costCents: 200 });
  assertEquals(loss.margin < 0 && loss.month < 0, true);
});

Deno.test("month totals: one month from the series, an empty month as zeros", () => {
  const s = dailySeries({ rows: [
    { day: "2026-09-30", kind: "chat", count: 1, cost_cents: 1 },
    { day: "2026-10-02", kind: "classify", count: 2, cost_cents: 2 },
    { day: "2026-10-03", kind: "mapbox", count: 7 },
  ] }, "2026-09-30", "2026-10-03");
  const t = monthTotals(s, "2026-10-01");
  assertEquals([t.aiCost, t.cost.classify, t.cost.chat, t.requests, t.mapbox], [2, 2, 0, 2, 7]);
  assertEquals(monthTotals(s, "2026-08-01").aiCost, 0);
});

Deno.test("CSV: quoted where needed, numbers as numbers, formulas defused", () => {
  assertEquals(csv(["a", "b"], [["x,y", 'say "hi"'], [1.5, null], ["=SUM(A1)", "-2"], ["@x", "+1"]]),
    'a,b\r\n"x,y","say ""hi"""\r\n1.5,\r\n\'=SUM(A1),\'-2\r\n\'@x,\'+1\r\n');
});

Deno.test("CSV files: per user without emails, daily totals, months", () => {
  const u = { ...user("3f2a", 12.5, 4, "pro", { message: 9, mapbox: 2 }), email: "someone@example.com",
    snapshot: { notes: 3, memories: 1, storage_bytes: 2048 } };
  const text = usersCsv([u]);
  const [head, row] = text.trim().split("\r\n");
  assertEquals(head.split(",").slice(0, 6), ["user", "plan", "joined", "active_days", "ai_cost_cents", "message"]);
  assertEquals(row.split(",").slice(0, 6), ["3f2a", "pro", "2026-10-01", "4", "12.5", "9"]);
  assertEquals(row.split(",").slice(-3), ["3", "1", "2048"]);
  assertEquals(text.includes("@") || text.includes("user_id") || text.includes("-0000"), false);
  const daily = dailyCsv({ rows: [{ day: "2026-10-25", kind: "chat", detail: "some-model", cost_cents: 1.25, users: 2 }] });
  assertEquals(daily.trim().split("\r\n")[1], "2026-10-25,chat,some-model,0,0,0,0,0,1.25,0,2");
  assertEquals(monthsCsv([{ month: "2026-09-01", cost_cents: 1800, requests: 3000 }]),
    "month,ai_cost_cents,chat_requests\r\n2026-09,1800,3000\r\n");
});
