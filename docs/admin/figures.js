// The admin page's arithmetic (usage tracking step 3; docs/usage-tracking-plan.md, D34). Pure
// functions over what the admin_usage_* functions return: no DOM, no network, so they are tested
// in tests/deno/admin_figures_test.ts. Money is in cents throughout, as the database keeps it.

/** The AI purposes, in the order the charts stack them, with the names the page shows. */
export const AI_SOURCES = [
  ["chat", "Chat"],
  ["day_plan", "Plan my day"],
  ["classify", "Search-box sorting"],
  ["memory", "Memory noticing"],
  ["outing", "Outings"],
  ["recipe_suggest", "Recipe suggestions"],
  ["recipe_import", "Reading recipes"],
];
const AI_KINDS = new Set(AI_SOURCES.map(([k]) => k));

/**
 * Mapbox drive times (Directions API): the first 100,000 requests a month are free, then about
 * $2.00 per 1,000 (Mapbox's price list, October 2026). Weather (api.weather.gov) costs nothing.
 * Step 4 makes the price editable on the page (Q5).
 */
export const MAPBOX_FREE_PER_MONTH = 100_000;
export const MAPBOX_CENTS_PER_1000 = 200;

export function mapboxCents(requestsThisMonth) {
  return (Math.max(0, requestsThisMonth - MAPBOX_FREE_PER_MONTH) / 1000) * MAPBOX_CENTS_PER_1000;
}

/** "2026-10-25" for a Date, in UTC (the database's day, Q1). */
export function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

/** The UTC day `n` days before (or after, for negative n) an ISO day. */
export function daysBefore(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return isoDay(d);
}

/** Every ISO day from `from` to `to`, both included. */
export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = daysBefore(d, -1)) out.push(d);
  return out;
}

/** "$12.34", or three decimals under a dollar so a fraction of a cent still shows. */
export function money(cents) {
  const c = Number(cents) || 0;
  return "$" + (c / 100).toFixed(Math.abs(c) < 100 && c !== 0 ? 3 : 2);
}

/** 1234567 -> "1,234,567". */
export function count(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}

/** 1536 -> "1.5 KB". */
export function bytes(n) {
  let v = Number(n) || 0;
  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (v < 1024 || unit === "GB") return unit === "B" ? `${v} B` : `${v.toFixed(1)} ${unit}`;
    v /= 1024;
  }
  return "";
}

/**
 * The daily series for the charts, from admin_usage_daily(from, to): one entry per day (days with
 * nothing still appear), each with the AI cost by purpose, requests, errors, Mapbox and weather
 * calls and failures, and the active users that day.
 */
export function dailySeries(daily, from, to) {
  const days = new Map(daysBetween(from, to).map((d) => [d, {
    day: d, cost: Object.fromEntries(AI_SOURCES.map(([k]) => [k, 0])), aiCost: 0,
    requests: 0, errors: 0, limits: 0, messages: 0, mapbox: 0, mapboxFailures: 0, weather: 0,
    weatherFailures: 0, active: 0, pro: 0,
  }]));
  for (const r of daily?.rows ?? []) {
    const d = days.get(r.day);
    if (!d) continue;
    const cost = Number(r.cost_cents) || 0;
    if (AI_KINDS.has(r.kind)) {
      d.cost[r.kind] += cost;
      d.aiCost += cost;
      d.requests += Number(r.count) || 0;
    }
    if (r.kind === "error") d.errors += Number(r.count) || 0;
    if (r.kind === "fair_use_hit") d.limits += Number(r.count) || 0;
    if (r.kind === "message") d.messages += Number(r.count) || 0;
    if (r.kind === "mapbox") { d.mapbox += Number(r.count) || 0; d.mapboxFailures += Number(r.failures) || 0; }
    if (r.kind === "weather") { d.weather += Number(r.count) || 0; d.weatherFailures += Number(r.failures) || 0; }
  }
  for (const a of daily?.active ?? []) {
    const d = days.get(a.day);
    if (d) { d.active = Number(a.users) || 0; d.pro = Number(a.pro) || 0; }
  }
  return [...days.values()];
}

/** The daily series added up by calendar month ("2026-10"), for the 12-month view. */
export function monthlySeries(series) {
  const months = new Map();
  for (const d of series) {
    const key = d.day.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { day: key, cost: Object.fromEntries(AI_SOURCES.map(([k]) => [k, 0])), aiCost: 0, requests: 0,
            errors: 0, limits: 0, messages: 0, mapbox: 0, mapboxFailures: 0, weather: 0, weatherFailures: 0,
            active: 0, pro: 0 };
      months.set(key, m);
    }
    for (const [k] of AI_SOURCES) m.cost[k] += d.cost[k];
    for (const f of ["aiCost", "requests", "errors", "limits", "messages", "mapbox", "mapboxFailures", "weather", "weatherFailures"]) {
      m[f] += d[f];
    }
    // Active users do not add up across days; the busiest day stands for the month.
    m.active = Math.max(m.active, d.active);
    m.pro = Math.max(m.pro, d.pro);
  }
  return [...months.values()];
}

/** The headline tiles, from admin_usage_overview(), this month's per-user list and series. */
export function tiles(overview, users, series) {
  const month = overview.month;
  const thisMonth = series.filter((d) => d.day >= month);
  const mapboxMonth = thisMonth.reduce((s, d) => s + d.mapbox, 0);
  const aiCents = Number(overview.month_cost_cents) || 0;
  const mapCents = mapboxCents(mapboxMonth);
  const cents = aiCents + mapCents;
  const activeMonth = users.filter((u) => Number(u.active_days) > 0).length;
  const soFar = Math.max(1, Number(overview.month_days_so_far) || 1);
  const perDay = cents / soFar;
  return {
    users: Number(overview.users) || 0,
    pro: Number(overview.pro_users) || 0,
    activeToday: Number(overview.active_today) || 0,
    active7: Number(overview.active_7) || 0,
    active30: Number(overview.active_30) || 0,
    activeMonth,
    cents,
    aiCents,
    mapCents,
    mapboxMonth,
    perActive: activeMonth ? cents / activeMonth : 0,
    projectedMonth: perDay * (Number(overview.month_days) || 30),
    projectedYear: perDay * 365,
  };
}

/**
 * Who costs what (one month): the users active that month, cheapest first, in four groups that do
 * not overlap: the bottom half, the middle, the top 10% (without the top 1%) and the top 1% (at
 * least one person once anyone is active). Each group: how many, the average and its share.
 */
export function spread(users) {
  const costs = users.filter((u) => Number(u.active_days) > 0).map((u) => Number(u.cost_cents) || 0)
    .sort((a, b) => a - b);
  const n = costs.length;
  const total = costs.reduce((s, c) => s + c, 0);
  const k1 = n ? Math.max(1, Math.round(n * 0.01)) : 0;
  const k10 = n ? Math.max(k1, Math.round(n * 0.1)) : 0;
  const half = Math.min(Math.floor(n / 2), n - k10);
  const parts = [
    ["Bottom half", costs.slice(0, half)],
    ["Middle", costs.slice(half, n - k10)],
    ["Top 10%", costs.slice(n - k10, n - k1)],
    ["Top 1%", costs.slice(n - k1)],
  ];
  return {
    users: n,
    total,
    groups: parts.map(([name, g]) => {
      const sum = g.reduce((s, c) => s + c, 0);
      return { name, users: g.length, average: g.length ? sum / g.length : 0, share: total ? sum / total : 0 };
    }),
  };
}

/**
 * Side by side (one month): Free and Pro, and the power users (the top 10% by cost, at least one)
 * against everyone else; only users active that month.
 */
export function sideBySide(users) {
  const active = users.filter((u) => Number(u.active_days) > 0)
    .sort((a, b) => (Number(b.cost_cents) || 0) - (Number(a.cost_cents) || 0));
  const kPower = active.length ? Math.max(1, Math.round(active.length * 0.1)) : 0;
  const sum = (list, f) => list.reduce((s, u) => s + (Number(f(u)) || 0), 0);
  const row = (name, list) => ({
    name,
    users: list.length,
    total: sum(list, (u) => u.cost_cents),
    average: list.length ? sum(list, (u) => u.cost_cents) / list.length : 0,
    activeDays: list.length ? sum(list, (u) => u.active_days) / list.length : 0,
    messages: list.length ? sum(list, (u) => kindCount(u, "message")) / list.length : 0,
  });
  return [
    row("Free", active.filter((u) => u.plan !== "pro")),
    row("Pro", active.filter((u) => u.plan === "pro")),
    row("Power users (top 10%)", active.slice(0, kPower)),
    row("Everyone else", active.slice(kPower)),
  ];
}

/** A user's count for one kind in admin_usage_users()'s `kinds`. */
export function kindCount(u, kind) {
  return Number(u?.kinds?.[kind]?.count) || 0;
}

/** The per-user table's columns: key, heading, value for sorting, text shown. */
export const USER_COLUMNS = [
  ["user", "User", (u) => u.short_id, (u) => u.short_id],
  ["plan", "Plan", (u) => u.plan, (u) => (u.plan === "pro" ? "Pro" : "Free")],
  ["joined", "Joined", (u) => u.joined, (u) => u.joined ?? ""],
  ["days", "Active days", (u) => Number(u.active_days) || 0, (u) => count(u.active_days)],
  ["messages", "Messages", (u) => kindCount(u, "message"), (u) => count(kindCount(u, "message"))],
  ["saves", "Saves", (u) => kindCount(u, "save"), (u) => count(kindCount(u, "save"))],
  ["searches", "Searches", (u) => kindCount(u, "search"), (u) => count(kindCount(u, "search"))],
  ["plans", "Day plans", (u) => kindCount(u, "day_plan"), (u) => count(kindCount(u, "day_plan"))],
  ["cost", "AI cost", (u) => Number(u.cost_cents) || 0, (u) => money(u.cost_cents)],
  ["maps", "Map calls", (u) => kindCount(u, "mapbox"), (u) => count(kindCount(u, "mapbox"))],
  ["weather", "Weather", (u) => kindCount(u, "weather"), (u) => count(kindCount(u, "weather"))],
  ["limits", "Limits hit", (u) => kindCount(u, "fair_use_hit"), (u) => count(kindCount(u, "fair_use_hit"))],
  ["errors", "Errors", (u) => kindCount(u, "error"), (u) => count(kindCount(u, "error"))],
  ["notes", "Notes", (u) => Number(u.snapshot?.notes) || 0, (u) => (u.snapshot ? count(u.snapshot.notes) : "–")],
  ["memories", "Memories", (u) => Number(u.snapshot?.memories) || 0, (u) => (u.snapshot ? count(u.snapshot.memories) : "–")],
  ["storage", "Storage", (u) => Number(u.snapshot?.storage_bytes) || 0, (u) => (u.snapshot ? bytes(u.snapshot.storage_bytes) : "–")],
];

/** Filter (plan: all | free | pro; text: part of a short id) and sort the per-user list. */
export function userRows(users, { plan = "all", text = "", key = "cost", dir = -1 } = {}) {
  const col = USER_COLUMNS.find((c) => c[0] === key) ?? USER_COLUMNS[8];
  const t = text.trim().toLowerCase();
  return users
    .filter((u) => plan === "all" || (plan === "pro" ? u.plan === "pro" : u.plan !== "pro"))
    .filter((u) => !t || String(u.short_id).includes(t))
    .sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return c * dir || String(a.short_id).localeCompare(String(b.short_id));
    });
}

/** The months to offer in the Users tab: from the first tracked month to this one, newest first. */
export function monthChoices(overview) {
  const last = overview.month;
  const first = (overview.tracking_since ?? last).slice(0, 7) + "-01";
  const out = [];
  for (let m = last; m >= first && out.length < 13; ) {
    out.push(m);
    const d = new Date(m + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() - 1);
    m = isoDay(d);
  }
  return out;
}

/** "2026-10-01" -> "October 2026". */
export function monthName(m) {
  return new Date(m.slice(0, 7) + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-10-25" -> "Oct 25"; "2026-10" -> "Oct". */
export function shortDay(d) {
  const date = new Date((d.length === 7 ? d + "-01" : d) + "T00:00:00Z");
  return date.toLocaleDateString("en-US", d.length === 7 ? { month: "short", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}
