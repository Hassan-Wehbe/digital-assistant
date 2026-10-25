// The admin page's arithmetic (docs/admin/figures.js): tiles, the daily and monthly series, the
// spread, side by side, and the per-user table's filter and sort.
import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  dailySeries, daysBetween, daysBefore, mapboxCents, money, monthChoices, monthlySeries, sideBySide, spread,
  tiles, userRows,
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
