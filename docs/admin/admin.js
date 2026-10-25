// The admin page (usage tracking steps 3-4; docs/usage-tracking-plan.md, D34), layout B: tabs.
// Sign in with a Wilma account; am_i_admin() decides what is shown, and every admin_* function
// refuses a non-admin on its own (the database, not this page, keeps the numbers private).
// Figures and short user ids only; an email is fetched one at a time, on tap (Q2), and lives only
// in the page until hidden or the page is closed. Everything is written with textContent or
// createElement, never parsed as HTML.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../oauth/config.js";
import { hbars, legend, lines, stackedBars } from "./charts.js";
import {
  AI_SOURCES, COST_BASES, count, dailyCsv, dailySeries, daysBefore, explore, MAPBOX_DEFAULT, mapboxCents, money,
  monthChoices, monthlySeries, monthName, monthsCsv, monthTotals, proCost, shortDay, sideBySide, spread, tiles,
  USER_COLUMNS, userRows, usersCsv,
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
  overview: null, daily: null, series: [], users: [], month: null, days: 30,
  sort: { key: "cost", dir: -1 }, plan: "all", text: "",
  // Mapbox's price for this visit (Q5): the Pricing tab changes it, nothing keeps it.
  mapbox: { ...MAPBOX_DEFAULT },
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
  state.overview = state.daily = null;
  $("report").replaceChildren();
  $("pe-out").replaceChildren();
  $("pe-note").textContent = "";
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
  state.daily = daily;
  state.series = dailySeries(daily, from, to);
  state.month = overview.month;
  state.users = users ?? [];
  state.thisMonthUsers = state.users;

  const since = overview.tracking_since ? `counting since ${shortDay(overview.tracking_since)}` : "no daily counts yet";
  const kept = upkeep?.failed ? " · the monthly snapshot could not be taken (try reloading)"
    : upkeep?.snapshots_taken ? ` · this month's snapshot taken for ${count(upkeep.snapshots_taken)} accounts` : "";
  $("asof").textContent = `Figures to ${shortDay(to)} (UTC), ${since}${kept}.`;

  for (const sel of document.querySelectorAll("select.month")) {
    sel.replaceChildren(...monthChoices(overview).map((m) => {
      const o = node("option", monthName(m));
      o.value = m;
      return o;
    }));
    sel.value = state.month;
  }
  $("mb-free").value = String(state.mapbox.free);
  $("mb-price").value = (state.mapbox.centsPer1000 / 100).toFixed(2);

  status(null);
  show("dash");
  drawTiles();
  drawMonths();
  drawSeries();
  drawSpread();
  drawUsers();
  drawExplorer();
  drawReport();
  selectTab(location.hash.slice(1) || "overview", false);
}

// ---------------------------------------------------------------- tabs and the period

const TABS = ["overview", "costs", "users", "pricing", "reports"];

function selectTab(name, focus = true) {
  if (!TABS.includes(name)) name = "overview";
  for (const t of TABS) {
    const b = $(`tab-${t}`);
    b.setAttribute("aria-selected", String(t === name));
    b.tabIndex = t === name ? 0 : -1;
    $(t).hidden = t !== name;
  }
  // The period chips sit just above the first chart of the open tab (the tiles do not depend on them).
  $("range").hidden = !["overview", "costs"].includes(name);
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
  const t = tiles(state.overview, state.thisMonthUsers, state.series, state.mapbox);
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
  $("mapbox-note").textContent = `Mapbox drive times this month: ${count(used)} of ${count(state.mapbox.free)} free` +
    ` (${money(mapboxCents(used, state.mapbox))}; then ${money(state.mapbox.centsPer1000)} per 1,000, as set on the` +
    " Pricing tab). Weather (api.weather.gov) is free.";
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
// One month for the Users, Pricing and Reports tabs and the spread: any of their month lists sets it.
for (const sel of document.querySelectorAll("select.month")) {
  sel.addEventListener("change", async () => {
    const m = sel.value;
    status("Loading…");
    try {
      state.users = (await rpc("admin_usage_users", { p_month: m })) ?? [];
      state.month = m;
      status(null);
    } catch (err) {
      status(`Could not load that month: ${err?.message ?? err}`, "error");
    }
    for (const other of document.querySelectorAll("select.month")) other.value = state.month;
    drawSpread();
    drawUsers();
    drawExplorer();
    drawReport();
  });
}

// ---------------------------------------------------------------- pricing (step 4)

$("pe-basis").replaceChildren(...COST_BASES.map(([v, name]) => {
  const o = node("option", name);
  o.value = v;
  return o;
}));
for (const id of ["pe-price", "pe-users", "pe-fee", "pe-basis", "pe-maps"]) $(id).addEventListener("input", drawExplorer);

function drawExplorer() {
  if (!state.overview) return;
  const price = Number($("pe-price").value);
  const users = Number($("pe-users").value);
  $("pe-price-out").textContent = `$${price.toFixed(2)}`;
  $("pe-users-out").textContent = count(users);
  const basis = $("pe-basis").value || "pro";
  const cost = proCost(state.users, { basis, month: state.month, overview: state.overview, price: state.mapbox,
    payMapbox: $("pe-maps").checked });
  const r = explore({ price, users, feePercent: $("pe-fee").value, costCents: cost.cents });
  const pct = `${Math.round(r.marginPercent * 100)}%`;
  const outs = [
    ["Cost per Pro user", money(cost.cents), false],
    ["Store's fee", money(r.fee), false],
    ["Margin per user", `${money(r.margin)} · ${pct}`, r.margin < 0],
    ["Margin per month", money(r.month), r.month < 0],
    ["Margin per year", money(r.year), r.year < 0],
    ["Break-even price", money(r.breakEven), false],
  ];
  $("pe-out").replaceChildren(...outs.map(([k, v, neg]) => {
    const d = node("div", k);
    d.prepend(node("b", v, neg ? "neg" : undefined));
    return d;
  }));
  const who = COST_BASES.find(([v]) => v === basis)[2];
  const scaled = cost.scale > 1.001 ? ` ${monthName(state.month)} is not over yet, so it is scaled up to a whole month at its pace so far.` : "";
  const maps = $("pe-maps").checked
    ? ` Mapbox: ${count(cost.mapboxCalls)} drive times a month each, ${money(cost.mapCents)}.`
    : ` Mapbox not counted (${count(cost.mapboxCalls)} drive times a month each, free while everyone together stays under ${count(state.mapbox.free)}).`;
  $("pe-note").textContent = cost.users
    ? `Cost: the average AI cost of the ${count(cost.users)} ${who} in ${monthName(state.month)}.${scaled}${maps}`
    : `Nobody in that group was active in ${monthName(state.month)} yet, so the cost shows as $0.00: pick another group or month.`;
}

for (const id of ["mb-free", "mb-price"]) {
  $(id).addEventListener("change", () => {
    const free = Number($("mb-free").value);
    const dollars = Number($("mb-price").value);
    if (Number.isFinite(free) && free >= 0) state.mapbox.free = Math.round(free);
    if (Number.isFinite(dollars) && dollars >= 0) state.mapbox.centsPer1000 = Math.round(dollars * 10000) / 100;
    $("mb-free").value = String(state.mapbox.free);
    $("mb-price").value = (state.mapbox.centsPer1000 / 100).toFixed(2);
    drawTiles();
    drawSeries();
    drawExplorer();
    drawReport();
  });
}

// ---------------------------------------------------------------- reports (step 4)

function table(head, rows) {
  const t = node("table");
  const thead = node("thead");
  const tr = node("tr");
  for (const h of head) tr.append(node("th", h));
  thead.append(tr);
  const body = node("tbody");
  for (const r of rows) {
    const row = node("tr");
    for (const c of r) row.append(node("td", c));
    body.append(row);
  }
  t.append(thead, body);
  const wrap = node("div", undefined, "tablewrap");
  wrap.append(t);
  return wrap;
}

/** The month's report, shown on the Reports tab and printed from it. Figures and short ids only. */
function drawReport() {
  if (!state.overview) return;
  const m = state.month;
  const totals = monthTotals(state.series, m);
  const inProgress = m === state.overview.month;
  const active = state.users.filter((u) => Number(u.active_days) > 0);
  const pro = active.filter((u) => u.plan === "pro").length;
  const mapCents = mapboxCents(totals.mapbox, state.mapbox);
  const all = totals.aiCost + mapCents;
  const t = tiles(state.overview, state.thisMonthUsers, state.series, state.mapbox);
  const facts = [
    ["Active users", count(active.length)],
    ["of them on Pro", count(pro)],
    ["Accounts now", count(state.overview.users)],
    ["AI cost", money(totals.aiCost)],
    ["Mapbox", `${count(totals.mapbox)} · ${money(mapCents)}`],
    ["Weather lookups", count(totals.weather)],
    ["Cost in all", money(all)],
    ["Per active user", money(active.length ? all / active.length : 0)],
    ["AI requests", count(totals.requests)],
    ["Messages", count(totals.messages)],
    ["Errors", count(totals.errors)],
    ["Limits hit", count(totals.limits)],
  ];
  if (inProgress) facts.push(["Projected month", money(t.projectedMonth)]);
  const dl = node("dl");
  for (const [k, v] of facts) {
    const d = node("div");
    d.append(node("dt", k), node("dd", v));
    dl.append(d);
  }
  const pct = (x, of) => (of ? `${Math.round((x / of) * 100)}%` : "–");
  const sp = spread(state.users);
  const top = [...active].sort((a, b) => (Number(b.cost_cents) || 0) - (Number(a.cost_cents) || 0)).slice(0, 10);
  const made = new Date().toISOString().slice(0, 16).replace("T", " ");
  $("report").replaceChildren(
    node("h3", `Wilma usage · ${monthName(m)}`),
    node("p", `Made ${made} UTC. ${inProgress ? `Month in progress: figures to ${shortDay(state.overview.today)}.` : "Whole month."}` +
      " Figures and short user ids only.", "muted"),
    dl,
    node("h4", "AI cost by purpose"),
    table(["Purpose", "Cost", "Share"], AI_SOURCES.map(([k, name]) => [name, money(totals.cost[k]), pct(totals.cost[k], totals.aiCost)])),
    node("h4", "Who costs what"),
    table(["Group", "Users", "Average", "Share of cost"], sp.groups.map((g) => [g.name, count(g.users), money(g.average), pct(g.share, 1)])),
    node("h4", "Side by side"),
    table(["Group", "Users", "AI cost", "Average", "Active days", "Messages"], sideBySide(state.users)
      .map((r) => [r.name, count(r.users), money(r.total), money(r.average), r.activeDays.toFixed(1), r.messages.toFixed(1)])),
    node("h4", "The ten costliest users"),
    table(["User", "Plan", "Active days", "Messages", "AI cost"], top.map((u) => [u.short_id, u.plan === "pro" ? "Pro" : "Free",
      count(u.active_days), count(u.kinds?.message?.count ?? 0), money(u.cost_cents)])),
  );
}

$("print").addEventListener("click", () => print());

/** Hand the browser a CSV file to save. The text is made here; nothing is sent anywhere. */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = node("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("dl-users").addEventListener("click", () => download(`wilma-users-${state.month.slice(0, 7)}.csv`, usersCsv(state.users)));
$("dl-daily").addEventListener("click", () => download(`wilma-daily-to-${state.overview.today}.csv`, dailyCsv(state.daily)));
$("dl-months").addEventListener("click", () => download("wilma-ai-cost-per-month.csv", monthsCsv(state.overview.ai_months)));

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
