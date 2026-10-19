// Date night and family day (docs/planners-plan.md step 2, design D40; owner 2026-10-19: all as
// recommended). The pure parts, no database and no network: the short list of the user's saved
// places (code, Q1), what the model is told, and the checks on its answer. outing.ts runs them.
//
// The model only ever sees facts about places from this short list (title, kind, cuisine, price,
// rating, last visit, occasions, minutes away), the free hours, the weather, the budget or mood,
// and for a family day roles and ages ("2 adults, children aged 6 and 9"), never a name (Q4): the
// request has no field for one. It must answer with JSON naming short-list places by number; any
// place it invents, any time outside the free hours or over a calendar event, any line that looks
// like a credential (rule 9) is dropped here. A plan with no place left is no plan.
import { findCredential } from "../mcp/lib/credentials.ts";
import type { Point } from "../_shared/dayplan/plan.ts";

export type OutingKind = "date" | "family";

export interface OutingAsk {
  kind: OutingKind;
  date: string;
  /** Local "HH:MM" window: date night from start for three hours by default; family day 9 to 6 (Q9). */
  start: string;
  end: string;
  /** Date night: 1-3 (matched to a place's price level 1-4: 3 means any). */
  budget?: number;
  /** Date night: a favourite (been, rated well, not lately) or somewhere new (want to go) (Q8). */
  mood?: "favourite" | "new";
  /** Family day (Q5: Wilma judges a place's setting). */
  setting?: "outdoor" | "indoor" | "either";
  /** Family day: roles and ages only (Q4). */
  who?: { adults: number; child_ages: number[] };
  /** Places from the plan shown before (Another idea): left out when others fit. */
  avoid?: string[];
}

/** A saved place as read (searchable spaces only; outing.ts reads them). */
export interface PlaceRow {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

export interface Candidate {
  id: string;
  title: string;
  kind: string;
  cuisine: string[];
  price_level?: number;
  rating?: number;
  status: "want" | "been";
  last_visit?: string;
  occasions: string[];
  point: Point;
  address?: string;
  maps_url?: string;
  km: number;
  /** Minutes from the home it starts from, when the drive could be worked out. */
  minutes?: number;
}

export const MAX_CANDIDATES = 8;
export const MAX_KM = 60;
export const MAX_STEPS = 6;
export const MAX_LINE = 140;
export const MAX_TITLE = 60;
const FOOD = new Set(["restaurant", "cafe", "bar"]);

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function km(a: Point, b: Point): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lastVisit(m: Record<string, unknown>): string | undefined {
  const days = [str(m.visited_on), ...(Array.isArray(m.visits) ? m.visits.map((v) => str((v as Record<string, unknown>)?.date)) : [])]
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return days.at(-1);
}

function toCandidate(r: PlaceRow, home: Point): Candidate | null {
  const m = r.metadata ?? {};
  const lat = num(m.lat);
  const lng = num(m.lng);
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const kind = str(m.kind) ?? "other";
  if (kind === "home" || kind === "hotel") return null;
  const point = { lat, lng };
  return {
    id: r.id, title: r.title.slice(0, 120), kind, cuisine: list(m.cuisine).slice(0, 3),
    ...(num(m.price_level) !== undefined ? { price_level: num(m.price_level) } : {}),
    ...(num(m.rating) !== undefined ? { rating: num(m.rating) } : {}),
    status: m.status === "been" ? "been" : "want",
    ...(lastVisit(m) ? { last_visit: lastVisit(m) } : {}),
    occasions: list(m.occasions),
    point,
    ...(str(m.address) ? { address: str(m.address) } : {}),
    ...(str(m.maps_url) ? { maps_url: str(m.maps_url) } : {}),
    km: km(home, point),
  };
}

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/**
 * The short list (Q1: code, not the model): at most MAX_CANDIDATES saved places within MAX_KM of
 * home, best first. Date night: within the budget; A favourite: been, rated 4 or 5, not visited for
 * 30 days, or marked date night; Somewhere new: want to go. Family day: marked kids, places to visit,
 * and a few low-priced places to eat. `avoid` (Another idea) only when enough others fit.
 */
export function shortlist(rows: PlaceRow[], ask: OutingAsk, home: Point, today: string): Candidate[] {
  const all = rows.map((r) => toCandidate(r, home)).filter((c): c is Candidate => c !== null && c.km <= MAX_KM);
  let picked: Candidate[];
  if (ask.kind === "date") {
    const budget = ask.budget ?? 3;
    const fits = all.filter((c) =>
      (FOOD.has(c.kind) || c.kind === "to-visit" || c.occasions.includes("date_night")) &&
      (budget >= 3 || c.price_level === undefined || c.price_level <= budget)
    );
    const mood = ask.mood ?? "favourite";
    const favourite = (c: Candidate) =>
      c.status === "been" && (c.occasions.includes("date_night") || (c.rating ?? 0) >= 4) &&
      (!c.last_visit || daysBetween(c.last_visit, today) >= 30);
    const fresh = (c: Candidate) => c.status === "want";
    const score = (c: Candidate) =>
      (c.occasions.includes("date_night") ? 20 : 0) + (c.rating ?? 0) * 3 + (c.kind === "restaurant" ? 4 : 0) - c.km / 5;
    picked = fits.filter(mood === "favourite" ? favourite : fresh).sort((a, b) => score(b) - score(a));
    // A walk or a drink after dinner: a couple of nearby date-night or to-visit places of either kind.
    const extras = fits.filter((c) => !picked.includes(c) && c.kind !== "restaurant" && (c.occasions.includes("date_night") || c.kind === "to-visit"))
      .sort((a, b) => a.km - b.km).slice(0, 2);
    picked = [...picked.slice(0, MAX_CANDIDATES - extras.length), ...extras];
  } else {
    const kids = (c: Candidate) => c.occasions.includes("kids");
    const things = all.filter((c) => !FOOD.has(c.kind) && (kids(c) || c.kind === "to-visit"))
      .sort((a, b) => Number(kids(b)) - Number(kids(a)) || a.km - b.km);
    const food = all.filter((c) => FOOD.has(c.kind) && (kids(c) || (c.price_level ?? 2) <= 2))
      .sort((a, b) => Number(kids(b)) - Number(kids(a)) || (b.rating ?? 0) - (a.rating ?? 0) || a.km - b.km);
    picked = [...things.slice(0, 5), ...food.slice(0, 3)];
  }
  const avoid = new Set(ask.avoid ?? []);
  const fresh = picked.filter((c) => !avoid.has(c.id));
  return (fresh.length >= 2 ? fresh : picked).slice(0, MAX_CANDIDATES);
}

/** A calendar event the plan must keep (busy in the window). */
export interface Busy {
  key: string;
  title: string;
  start: string;
  end: string;
}

const hm = (local: string) => local.slice(11, 16);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "child aged 6", "2 adults, children aged 6 and 9": roles and ages, never a name (Q4). */
export function whoWords(who: OutingAsk["who"]): string {
  if (!who) return "not said";
  const parts: string[] = [];
  if (who.adults) parts.push(`${who.adults} adult${who.adults === 1 ? "" : "s"}`);
  const ages = [...who.child_ages].sort((a, b) => a - b);
  if (ages.length) {
    parts.push(ages.length === 1 ? `a child aged ${ages[0]}` : `children aged ${ages.slice(0, -1).join(", ")} and ${ages.at(-1)}`);
  }
  return parts.join(", ") || "not said";
}

export const OUTING_SYSTEM = `You plan one outing for the user of a personal assistant app, from places they saved
themselves. You answer with JSON only, no other text:
{"title": "...", "steps": [{"place": 1, "start": "HH:MM", "minutes": 90, "line": "..."}], "alternative": {"place": 2, "line": "..."}}
Rules:
- Use only the numbered places you are given ("place": its number). Never invent a place.
- A calendar event the user already has stays as it is: include it as {"event": "<its key>", "start", "minutes"} at its time if it falls in the window; plan around it.
- For a family day you may add {"home": true, "start", "minutes", "line"} for time at home (rest, rain).
- Steps in time order, inside the window, never overlapping each other or an event; leave room for the drives (minutes away are given).
- A date night: usually dinner, then perhaps a walk or a drink nearby. A family day: things that suit the children's ages, a lunch, outdoor things in the dry hours.
- title: at most ${MAX_TITLE} characters ("Dinner and a walk"). line: one short, warm sentence, at most ${MAX_LINE} characters, from the facts given only.
- alternative: one other place from the list, if one fits.`;

/** What the model is told: facts only, numbered places, no ids, no names. */
export function outingPrompt(ask: OutingAsk, cands: Candidate[], busy: Busy[], rain: { at: string; rain_pct: number }[], today: string): string {
  const lines = cands.map((c, i) => {
    const facts = [
      c.kind, c.cuisine.join("/") || null, c.price_level ? "$".repeat(c.price_level) : null,
      c.status === "been" ? `been${c.rating ? `, rated ${c.rating}/5` : ""}${c.last_visit ? `, last visit ${c.last_visit}` : ""}` : "want to go",
      c.occasions.length ? `good for: ${c.occasions.join(", ").replace(/_/g, " ")}` : null,
      c.minutes !== undefined ? `${c.minutes} min drive` : `${Math.round(c.km)} km away`,
    ].filter(Boolean);
    return `${i + 1}. ${c.title} (${facts.join("; ")})`;
  });
  const rainLine = rain.length
    ? rain.filter((h) => h.at.slice(11, 16) >= ask.start && h.at.slice(11, 16) <= ask.end).map((h) => `${hm(h.at)} ${h.rain_pct}%`).join(", ")
    : "unknown";
  return [
    `Plan a ${ask.kind === "date" ? "date night" : "family day"} on ${ask.date} (today is ${today}), between ${ask.start} and ${ask.end}.`,
    ask.kind === "date"
      ? `Budget: ${"$".repeat(ask.budget ?? 3)}${(ask.budget ?? 3) >= 3 ? " or more" : ""}. Mood: ${ask.mood === "new" ? "somewhere new they want to try" : "a favourite they have not been to lately"}.`
      : `Who: ${whoWords(ask.who)}. Setting: ${ask.setting ?? "either"} (judge indoor or outdoor from what each place is).`,
    `Calendar events in the window: ${busy.length ? busy.map((b) => `${b.key}: "${b.title}" ${hm(b.start)}-${hm(b.end)}`).join("; ") : "none"}.`,
    `Chance of rain by hour: ${rainLine}.`,
    "Places:",
    ...lines,
  ].join("\n");
}

export interface DraftStep {
  start: string;
  end: string;
  line: string;
  place?: Candidate;
  event?: Busy;
  home?: true;
}

export interface Draft {
  title: string;
  steps: DraftStep[];
  alternative?: { place: Candidate; line: string };
  /** Steps the model gave that were dropped by the checks (logged as a count). */
  dropped: number;
}

/** A line the user will read: one line, short, never something that looks like a credential (rule 9). */
function cleanLine(v: unknown, max = MAX_LINE): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!s || findCredential(s)) return "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The first {...} in the model's text, parsed; null when there is none. */
function firstJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The model's answer, checked: places only from the short list (by number), events only from the
 * calendar, times inside the window and in order, nothing overlapping, at most MAX_STEPS. Anything
 * else is dropped; null when no place is left.
 */
export function checkAnswer(text: string, ask: OutingAsk, cands: Candidate[], busy: Busy[]): Draft | null {
  const raw = firstJson(text);
  if (!raw || !Array.isArray(raw.steps)) return null;
  const from = toMin(ask.start);
  const to = toMin(ask.end);
  const busyMin = busy.map((b) => ({ b, s: toMin(hm(b.start)), e: toMin(hm(b.end)) }));
  const steps: DraftStep[] = [];
  const used = new Set<string>();
  let dropped = 0;
  let last = -1;
  for (const s of raw.steps.slice(0, MAX_STEPS * 2)) {
    const r = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>;
    const start = typeof r.start === "string" && HHMM.test(r.start) ? toMin(r.start) : NaN;
    const minutes = typeof r.minutes === "number" && Number.isInteger(r.minutes) ? r.minutes : NaN;
    const event = typeof r.event === "string" ? busyMin.find((x) => x.b.key === r.event) : undefined;
    const placeNo = typeof r.place === "number" && Number.isInteger(r.place) ? r.place : NaN;
    const place = Number.isFinite(placeNo) ? cands[placeNo - 1] : undefined;
    const home = r.home === true && ask.kind === "family";
    let ok = Number.isFinite(start) && Number.isFinite(minutes) && minutes >= 15 && minutes <= 300;
    // An event keeps its own time; anything else must fit the window, after the last step, and
    // never over an event.
    let s0 = start;
    let e0 = start + minutes;
    if (ok && event) {
      s0 = event.s;
      e0 = event.e;
    } else if (ok && (place || home)) {
      ok = s0 >= from && e0 <= to && !busyMin.some((x) => s0 < x.e && x.s < e0);
    } else ok = false;
    if (ok) ok = s0 >= last;
    if (ok && place) ok = !used.has(place.id);
    if (!ok || steps.length >= MAX_STEPS) {
      dropped += 1;
      continue;
    }
    if (place) used.add(place.id);
    last = e0;
    steps.push({
      start: toTime(s0), end: toTime(e0),
      line: event ? "From your calendar, kept as it is." : cleanLine(r.line),
      ...(place ? { place } : event ? { event: event.b } : { home: true as const }),
    });
  }
  if (!steps.some((s) => s.place)) return null;
  const alt = (typeof raw.alternative === "object" && raw.alternative !== null ? raw.alternative : {}) as Record<string, unknown>;
  const altPlace = typeof alt.place === "number" ? cands[alt.place - 1] : undefined;
  const title = cleanLine(raw.title, MAX_TITLE) || (ask.kind === "date" ? "Date night" : "Family day");
  return {
    title,
    steps,
    ...(altPlace && !used.has(altPlace.id) ? { alternative: { place: altPlace, line: cleanLine(alt.line) } } : {}),
    dropped,
  };
}

export { toMin, toTime };
