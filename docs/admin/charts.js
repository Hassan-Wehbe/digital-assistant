// Small SVG charts for the admin page, drawn with createElementNS (never parsed from text) so the
// page needs no charts library and no inline styles under its Content-Security-Policy. Colours come
// from CSS classes (c1..c8, see admin.css), so light and dark need no redraw. Each bar or point
// carries a <title>, which the browser shows on hover and screen readers read.

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Draw at the container's own width, so text stays its real size on a phone and a laptop. */
function width(container) {
  return Math.max(300, Math.round(container.clientWidth) || 640);
}

function frame(container, w, h, label) {
  container.replaceChildren();
  const s = el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label });
  container.append(s);
  return s;
}

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function grid(s, { w, h, left, bottom, top, max, format }) {
  // Five steps: with niceMax's tops (1, 2, 2.5, 5, 10) every step is a round number.
  for (let i = 0; i <= 5; i++) {
    const v = (max * i) / 5;
    const y = h - bottom - ((h - bottom - top) * i) / 5;
    s.append(el("line", { x1: left, x2: w, y1: y, y2: y, class: "grid" }));
    s.append(el("text", { x: left - 6, y: y + 3, "text-anchor": "end" }, format(v)));
  }
}

function xLabels(s, labels, { x, h, every }) {
  labels.forEach((l, i) => {
    if (i % every === 0 || (i === labels.length - 1 && labels.length < 14)) {
      s.append(el("text", { x: x(i), y: h - 6, "text-anchor": "middle" }, l));
    }
  });
}

/** A legend: a swatch and a name per series. */
export function legend(container, series) {
  container.replaceChildren(...series.map((sr) => {
    const item = document.createElement("span");
    const sw = document.createElement("i");
    sw.className = `sw ${sr.cls}`;
    item.append(sw, sr.name);
    return item;
  }));
}

/**
 * Stacked bars: labels (one per bar), series [{name, cls, values}] stacked bottom to top.
 * `format` writes an axis or hover value; `title(i)` names bar i in hover text.
 */
export function stackedBars(container, { labels, series, format, title = (i) => labels[i], label }) {
  const w = width(container), h = 230, left = 52, bottom = 22, top = 10;
  const totals = labels.map((_, i) => series.reduce((sum, sr) => sum + sr.values[i], 0));
  const max = niceMax(Math.max(0, ...totals));
  const s = frame(container, w, h, label);
  grid(s, { w, h, left, bottom, top, max, format });
  const step = (w - left - 4) / Math.max(1, labels.length);
  const bw = Math.max(1, Math.min(28, step - (labels.length > 60 ? 0.5 : 2)));
  const x = (i) => left + i * step + step / 2;
  const scale = (v) => ((h - bottom - top) * v) / max;
  labels.forEach((_, i) => {
    let y = h - bottom;
    const g = el("g");
    g.append(el("title", {}, `${title(i)}: ${format(totals[i])}` +
      series.filter((sr) => sr.values[i] > 0).map((sr) => `\n${sr.name}: ${format(sr.values[i])}`).join("")));
    for (const sr of series) {
      const bh = scale(sr.values[i]);
      if (bh <= 0) continue;
      y -= bh;
      g.append(el("rect", { x: x(i) - bw / 2, y, width: bw, height: bh, class: sr.cls }));
    }
    // An invisible full-height target, so a thin or empty bar still has a hover.
    g.append(el("rect", { x: x(i) - step / 2, y: top, width: step, height: h - bottom - top, class: "hit" }));
    s.append(g);
  });
  xLabels(s, labels, { x, h, every: Math.ceil(labels.length / Math.max(3, Math.floor(w / 110))) });
}

/** Lines: labels along the bottom, series [{name, cls, values}], with the last value marked. */
export function lines(container, { labels, series, format, title = (i) => labels[i], label, area = false }) {
  const w = width(container), h = 170, left = 52, bottom = 22, top = 12;
  const max = niceMax(Math.max(0, ...series.flatMap((sr) => sr.values)));
  const s = frame(container, w, h, label);
  grid(s, { w, h, left, bottom, top, max, format });
  const n = labels.length;
  const x = (i) => (n <= 1 ? (left + w) / 2 : left + 6 + (i * (w - left - 12)) / (n - 1));
  const y = (v) => h - bottom - ((h - bottom - top) * v) / max;
  for (const sr of series) {
    const pts = sr.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (area && n > 1) {
      s.append(el("path", { d: `M${x(0)},${h - bottom} L${pts.join(" L")} L${x(n - 1)},${h - bottom}Z`, class: `area ${sr.cls}` }));
    }
    if (n > 1) s.append(el("path", { d: `M${pts.join(" L")}`, class: `line ${sr.cls}` }));
    const last = n - 1;
    s.append(el("circle", { cx: x(last), cy: y(sr.values[last] ?? 0), r: 4, class: sr.cls }));
  }
  // Hover targets, one per label, naming every series' value.
  const step = n > 1 ? (w - left - 12) / (n - 1) : w - left;
  labels.forEach((_, i) => {
    const g = el("g");
    g.append(el("title", {}, title(i) + series.map((sr) => `\n${sr.name}: ${format(sr.values[i])}`).join("")));
    g.append(el("rect", { x: x(i) - step / 2, y: top, width: step, height: h - bottom - top, class: "hit" }));
    s.append(g);
  });
  xLabels(s, labels, { x, h, every: Math.ceil(n / Math.max(3, Math.floor(w / 110))) });
}

/** Horizontal bars, one per row [{name, value, note, cls}], longest = the widest. */
export function hbars(container, { rows, format, label }) {
  const w = width(container), row = 34, left = 100, h = rows.length * row + 8;
  const room = Math.min(220, w * 0.4);
  const max = Math.max(0, ...rows.map((r) => r.value)) || 1;
  const s = frame(container, w, h, label);
  rows.forEach((r, i) => {
    const y = 6 + i * row;
    const bw = ((w - left - room) * r.value) / max;
    const g = el("g");
    g.append(el("title", {}, `${r.name}: ${format(r.value)}${r.note ? " · " + r.note : ""}`));
    g.append(el("text", { x: 0, y: y + 18, class: "name" }, r.name));
    g.append(el("rect", { x: left, y: y + 5, width: Math.max(r.value > 0 ? 2 : 0, bw), height: 20, rx: 3, class: r.cls }));
    g.append(el("text", { x: left + bw + 8, y: y + 19 }, `${format(r.value)}${r.note ? " · " + r.note : ""}`));
    s.append(g);
  });
}
