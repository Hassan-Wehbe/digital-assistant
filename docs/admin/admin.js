// The admin page (usage tracking step 3; docs/usage-tracking-plan.md, D34), layout B: three tabs.
// Sign in with a Wilma account; am_i_admin() decides what is shown, and every admin_* function
// refuses a non-admin on its own (the database, not this page, keeps the numbers private).
// Figures and short user ids only; an email is fetched one at a time, on tap (Q2), and lives only
// in the page until hidden or the page is closed. Everything is written with textContent or
// createElement, never parsed as HTML.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../oauth/config.js";
import { hbars, legend, lines, stackedBars } from "./charts.js";
import {
  AI_SOURCES, count, dailySeries, daysBefore, mapboxCents, MAPBOX_FREE_PER_MONTH, money, monthChoices,
  monthlySeries, monthName, shortDay, sideBySide, spread, tiles, USER_COLUMNS, userRows,
} from "./figures.js";

// Refuse to run inside a frame (GitHub Pages cannot send frame-ancestors headers).
if (window.top !== window.self) {
  document.documentElement.textContent = "";
  throw new Error("framed");
}

const $ = (id) => document.getElementById(id);
// Same sign-in session as the vault and consent pages (same site, same storage key).
const db = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { detectSessionInUrl: false },
});

const state = {
  overview: null, series: [], users: [], month: null, days: 30,
  sort: { key: "cost", dir: -1 }, plan: "all", text: "",
};

function status(message, kind = "muted") {
  const el = $("status");
  el.textContent = message ?? "";
  el.hidden = !message;
  el.className = kind === "error" ? "error" : "muted";
}

function show(id) {
  for (const s of ["login", "denied", "dash"]) $(s).hidden = s !== id;
}

async function rpc(fn, args = {}) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

// ---------------------------------------------------------------- sign-in and the admin check

async function start() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    status(null);
    $("account").hidden = true;
    return show("login");
  }
  $("who").textContent = session.user.email ?? "";
  $("account").hidden = false;
  status("Loading…");
  if (!(await rpc("am_i_admin"))) {
    status(null);
    return show("denied");
  }
  await load();
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  status("Signing in…");
  const { error } = await db.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  $("password").value = "";
  if (error) return status(error.message, "error");
  await run();
});

$("signout").addEventListener("click", async (e) => {
  e.preventDefault();
  await db.auth.signOut();
  // Take the numbers off the page, not just out of sight.
  state.overview = null;
  state.users = state.thisMonthUsers = [];
  for (const id of ["tiles", "table-months", "chart-active", "chart-cost", "chart-requests", "chart-lookups",
                    "chart-spread", "table-side", "table-users"]) $(id).replaceChildren();
  $("email").value = "";
  await run();
});

async function run() {
  try {
    await start();
  } catch (err) {
    show(null);
    status(err?.message === "admin only" ? "Not available." : `Could not load the numbers: ${err?.message ?? err}`, "error");
  }
}

// ---------------------------------------------------------------- loading

async function load() {
  // This month's snapshot and the 13-month clean-up (Q3, Q4). A failure here never hides the numbers.
  let upkeep = null;
  try {
    upkeep = await rpc("admin_usage_maintenance");
  } catch {
    upkeep = { failed: true };
  }
  const overview = await rpc("admin_usage_overview");
  const to = overview.today;
  const from = daysBefore(to, 364);
  const [daily, users] = await Promise.all([
    rpc("admin_usage_daily", { p_from: from, p_to: to }),
    rpc("admin_usage_users", { p_month: overview.month }),
  ]);
  state.overview = overview;
  state.series = dailySeries(daily, from, to);
  state.month = overview.month;
  state.users = users ?? [];
  state.thisMonthUsers = state.users;

  const since = overview.tracking_since ? `counting since ${shortDay(overview.tracking_since)}` : "no daily counts yet";
  const kept = upkeep?.failed ? " · the monthly snapshot could not be taken (try reloading)"
    : upkeep?.snapshots_taken ? ` · this month's snapshot taken for ${count(upkeep.snapshots_taken)} accounts` : "";
  $("asof").textContent = `Figures to ${shortDay(to)} (UTC), ${since}${kept}.`;

  const sel = $("month");
  sel.replaceChildren(...monthChoices(overview).map((m) => {
    const o = node("option", monthName(m));
    o.value = m;
    return o;
  }));
  sel.value = state.month;

  status(null);
  show("dash");
  drawTiles();
  drawMonths();
  drawSeries();
  drawSpread();
  drawUsers();
  selectTab(location.hash.slice(1) || "overview", false);
}

// ---------------------------------------------------------------- tabs and the period

const TABS = ["overview", "costs", "users"];

function selectTab(name, focus = true) {
  if (!TABS.includes(name)) name = "overview";
  for (const t of TABS) {
    const b = $(`tab-${t}`);
    b.setAttribute("aria-selected", String(t === name));
    b.tabIndex = t === name ? 0 : -1;
    $(t).hidden = t !== name;
  }
  // The period chips sit just above the first chart of the open tab (the tiles do not depend on them).
  $("range").hidden = name === "users";
  $(name).querySelector(".card")?.before($("range"));
  // Charts in a hidden tab were drawn without a width: draw the open tab's again.
  if (state.overview) {
    drawSeries();
    drawSpread();
  }
  if (focus) $(`tab-${name}`).focus();
  history.replaceState(null, "", `#${name}`);
}

for (const t of TABS) {
  $(`tab-${t}`).addEventListener("click", () => selectTab(t));
  $(`tab-${t}`).addEventListener("keydown", (e) => {
    const i = TABS.indexOf(t);
    if (e.key === "ArrowRight") selectTab(TABS[(i + 1) % TABS.length]);
    else if (e.key === "ArrowLeft") selectTab(TABS[(i + TABS.length - 1) % TABS.length]);
    else return;
    e.preventDefault();
  });
}

for (const b of $("range").querySelectorAll("button")) {
  b.addEventListener("click", () => {
    state.days = Number(b.dataset.days);
    for (const x of $("range").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    drawSeries();
  });
}

// ---------------------------------------------------------------- overview

function drawTiles() {
  const t = tiles(state.overview, state.thisMonthUsers, state.series);
  const list = [
    ["Users", count(t.users), `${count(t.pro)} on Pro`],
    ["Active · 30 days", count(t.active30), `${count(t.activeToday)} today · ${count(t.active7)} in 7 days`],
    ["Cost this month", money(t.cents), t.mapCents ? `AI ${money(t.aiCents)} · maps ${money(t.mapCents)}` : "AI; maps within the free tier"],
    ["Per active user", money(t.perActive), `${count(t.activeMonth)} active this month`],
    ["Projected · month", money(t.projectedMonth), "at this month's pace"],
    ["Projected · year", money(t.projectedYear), "at this month's pace"],
  ];
  $("tiles").replaceChildren(...list.map(([k, v, d]) => {
    const tile = node("div", undefined, "tile");
    tile.append(node("span", k, "k"), node("span", v, "v"), node("span", d, "d"));
    return tile;
  }));
}

function drawMonths() {
  const months = state.overview.ai_months ?? [];
  $("before").hidden = months.length === 0;
  const table = $("table-months");
  const head = node("tr");
  for (const h of ["Month", "AI cost", "Chat requests"]) head.append(node("th", h));
  const body = node("tbody");
  for (const m of [...months].reverse()) {
    const tr = node("tr");
    tr.append(node("td", monthName(m.month)), node("td", money(m.cost_cents)), node("td", count(m.requests)));
    body.append(tr);
  }
  const thead = node("thead");
  thead.append(head);
  table.replaceChildren(thead, body);
}

// ---------------------------------------------------------------- charts over time

function drawSeries() {
  const daily = state.series.slice(-state.days);
  const data = state.days > 90 ? monthlySeries(daily) : daily;
  const labels = data.map((d) => shortDay(d.day));
  const title = (i) => (state.days > 90 ? monthName(data[i].day + "-01") : shortDay(data[i].day));
  const whole = (v) => count(v);
  const period = state.days > 90 ? "per month, last 12 months" : `per day, last ${state.days} days`;

  const active = [
    { name: "Active users", cls: "c1", values: data.map((d) => d.active) },
    { name: "of them on Pro", cls: "c5", values: data.map((d) => d.pro) },
  ];
  legend($("legend-active"), active);
  lines($("chart-active"), { labels, series: active, format: whole, title, area: true,
    label: `Active users ${period}${state.days > 90 ? " (the busiest day)" : ""}` });

  const cost = AI_SOURCES.map(([k, name], i) => ({ name, cls: `c${i + 1}`, values: data.map((d) => d.cost[k]) }));
  legend($("legend-cost"), cost);
  stackedBars($("chart-cost"), { labels, series: cost, format: money, title, label: `AI cost by purpose, ${period}` });

  const requests = [
    { name: "AI requests", cls: "c1", values: data.map((d) => d.requests) },
    { name: "Errors", cls: "c6", values: data.map((d) => d.errors) },
    { name: "Limits hit", cls: "c3", values: data.map((d) => d.limits) },
  ];
  legend($("legend-requests"), requests);
  lines($("chart-requests"), { labels, series: requests, format: whole, title, label: `Requests and errors, ${period}` });

  const lookups = [
    { name: "Mapbox", cls: "c5", values: data.map((d) => d.mapbox) },
    { name: "Weather", cls: "c2", values: data.map((d) => d.weather) },
    { name: "Failed", cls: "c6", values: data.map((d) => d.mapboxFailures + d.weatherFailures) },
  ];
  legend($("legend-lookups"), lookups);
  lines($("chart-lookups"), { labels, series: lookups, format: whole, title, label: `Map and weather lookups, ${period}` });

  const month = state.overview.month;
  const used = state.series.filter((d) => d.day >= month).reduce((s, d) => s + d.mapbox, 0);
  $("mapbox-note").textContent = `Mapbox drive times this month: ${count(used)} of ${count(MAPBOX_FREE_PER_MONTH)} free` +
    ` (${money(mapboxCents(used))}; then about $2.00 per 1,000). Weather (api.weather.gov) is free.`;
}

// ---------------------------------------------------------------- the spread

function drawSpread() {
  const sp = spread(state.users);
  $("spread-title").textContent = `Who costs what · ${monthName(state.month)}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  hbars($("chart-spread"), {
    format: money,
    label: `Average AI cost per user by group, ${monthName(state.month)}`,
    rows: sp.groups.map((g, i) => ({
      name: g.name, value: g.average, cls: i >= 2 ? "c6" : "c1",
      note: g.users ? `${count(g.users)} ${g.users === 1 ? "user" : "users"} · ${pct(g.share)}` : "nobody yet",
    })),
  });
  const table = $("table-side");
  const head = node("tr");
  for (const h of ["Group", "Users", "AI cost", "Average", "Active days", "Messages"]) head.append(node("th", h));
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  for (const r of sideBySide(state.users)) {
    const tr = node("tr");
    tr.append(node("td", r.name), node("td", count(r.users)), node("td", money(r.total)), node("td", money(r.average)),
      node("td", r.activeDays.toFixed(1)), node("td", r.messages.toFixed(1)));
    body.append(tr);
  }
  table.replaceChildren(thead, body);
}

// ---------------------------------------------------------------- per user

function drawUsers() {
  const rows = userRows(state.users, { plan: state.plan, text: state.text, ...state.sort });
  $("user-count").textContent = `${count(rows.length)} of ${count(state.users.length)} accounts.`;
  const head = node("tr");
  for (const [key, name] of USER_COLUMNS) {
    const th = node("th");
    if (key === "user" || key === "plan") th.className = "left";
    const b = node("button", name + (key === state.sort.key ? (state.sort.dir < 0 ? " ↓" : " ↑") : ""));
    b.type = "button";
    if (key === state.sort.key) th.setAttribute("aria-sort", state.sort.dir < 0 ? "descending" : "ascending");
    b.addEventListener("click", () => {
      state.sort = { key, dir: key === state.sort.key ? -state.sort.dir : -1 };
      drawUsers();
    });
    th.append(b);
    head.append(th);
  }
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  for (const u of rows) {
    const tr = node("tr");
    tr.tabIndex = 0;
    for (const [key, , , text] of USER_COLUMNS) {
      if (key === "plan") {
        const td = node("td", undefined, "left");
        td.append(node("span", text(u), u.plan === "pro" ? "pill pro" : "pill"));
        tr.append(td);
      } else {
        tr.append(node("td", text(u), key === "user" ? "id" : undefined));
      }
    }
    const toggle = () => toggleEmail(u, tr.firstChild);
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    body.append(tr);
  }
  $("table-users").replaceChildren(thead, body);
}

/** Show one user's email in place of their short id (Q2), or hide it again. */
async function toggleEmail(u, cell) {
  if (cell.classList.contains("email")) {
    cell.textContent = u.short_id;
    cell.className = "id";
    return;
  }
  cell.textContent = "…";
  try {
    const email = await rpc("admin_user_email", { p_user_id: u.user_id });
    cell.textContent = email ?? "(no email)";
    cell.className = "email";
  } catch (err) {
    cell.textContent = u.short_id;
    status(`Could not show the email: ${err?.message ?? err}`, "error");
  }
}

$("plan").addEventListener("change", () => {
  state.plan = $("plan").value;
  drawUsers();
});
$("find").addEventListener("input", () => {
  state.text = $("find").value;
  drawUsers();
});
$("month").addEventListener("change", async () => {
  const m = $("month").value;
  status("Loading…");
  try {
    state.users = (await rpc("admin_usage_users", { p_month: m })) ?? [];
    state.month = m;
    status(null);
  } catch (err) {
    $("month").value = state.month;
    status(`Could not load that month: ${err?.message ?? err}`, "error");
  }
  drawSpread();
  drawUsers();
});

// Redraw the charts at the new width when the window changes size (a phone turned, say).
let resizing = 0;
addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    if (state.overview && !$("dash").hidden) {
      drawSeries();
      drawSpread();
    }
  }, 150);
});

run();
