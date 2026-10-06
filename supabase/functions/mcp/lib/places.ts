// Places (docs/places-plan.md, design D26): an item with item_type "place" whose metadata holds
// what Wilma needs to find and recommend it. The server, not the model, decides the shape
// (rule 9 spirit): save_item / update_item pass place metadata through normalizePlace, which
// rejects unknown fields, bad links and out-of-range values with a message the model can act on.
// Credential-looking values are refused before this, by rejectCredentials (every metadata value).

export const PLACE_TYPE = "place";

export const PLACE_KINDS = ["restaurant", "cafe", "bar", "shop", "to-visit", "hotel", "other"] as const;
export const OCCASIONS = ["date_night", "kids", "business", "quick_lunch", "group", "special"] as const;
export const MAX_VISITS = 50;

export interface PlaceVisit {
  on: string;
  with?: string;
  note?: string;
}

export interface PlaceMetadata {
  address?: string;
  maps_url?: string;
  kind?: (typeof PLACE_KINDS)[number];
  status: "want" | "been";
  rating?: number;
  visited_on?: string;
  cuisine?: string[];
  price_level?: number;
  dishes_liked?: string[];
  would_return?: boolean;
  occasions?: (typeof OCCASIONS)[number][];
  visits?: PlaceVisit[];
  lat?: number;
  lng?: number;
  google_place_id?: string;
}

const FIELDS = [
  "address", "maps_url", "kind", "status", "rating", "visited_on", "cuisine", "price_level",
  "dishes_liked", "would_return", "occasions", "visits", "lat", "lng", "google_place_id",
];

export class PlaceError extends Error {}

const fail = (msg: string): never => {
  throw new PlaceError(`Place not saved: ${msg}`);
};

export function isPlace(itemType: string | null | undefined): boolean {
  return (itemType ?? "").trim().toLowerCase() === PLACE_TYPE;
}

/** A word as stored: lower case, spaces and dashes as one underscore ("Date night" -> "date_night"). */
const slug = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

function text(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return fail(`${field} must be text`);
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length > max) return fail(`${field} is longer than ${max} characters`);
  return t || undefined;
}

function list(v: unknown, field: string, maxItems: number, maxLen: number): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const raw = typeof v === "string" ? v.split(",") : v;
  if (!Array.isArray(raw)) return fail(`${field} must be a list of words`);
  if (raw.length > maxItems) return fail(`${field} has more than ${maxItems} entries`);
  const out: string[] = [];
  for (const x of raw) {
    const t = text(x, field, maxLen)?.toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length ? out : undefined;
}

function int(v: unknown, field: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    return fail(`${field} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/** A calendar date, YYYY-MM-DD, not more than a day in the future. */
function date(v: unknown, field: string, today: Date): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return fail(`${field} must be a date like 2026-10-12`);
  const d = v.trim();
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return fail(`${field} is not a real date`);
  if (t.getTime() > today.getTime() + 36 * 3600_000) return fail(`${field} is in the future`);
  if (t.getUTCFullYear() < 1900) return fail(`${field} is too far in the past`);
  return d;
}

/** Only Google Maps links (https) or geo: links: what Open in Maps can open safely. */
export function isMapsLink(url: string): boolean {
  if (/^geo:-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?([;?].*)?$/i.test(url)) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl") return u.pathname.startsWith("/maps");
  if (/^maps\.google\.[a-z.]{2,6}$/.test(host)) return true;
  if (/^(www\.)?google\.[a-z.]{2,6}$/.test(host)) return u.pathname.startsWith("/maps");
  return false;
}

function kind(v: unknown): PlaceMetadata["kind"] {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return fail("kind must be text");
  const k = slug(v).replace(/_/g, "-").replace("café", "cafe").replace(/^(visit|to-see|sight|attraction)$/, "to-visit");
  if (!(PLACE_KINDS as readonly string[]).includes(k)) return fail(`kind must be one of ${PLACE_KINDS.join(", ")}`);
  return k as PlaceMetadata["kind"];
}

function occasions(v: unknown): PlaceMetadata["occasions"] {
  const words = list(v, "occasions", OCCASIONS.length, 40);
  if (!words) return undefined;
  const out = words.map(slug);
  const bad = out.find((o) => !(OCCASIONS as readonly string[]).includes(o));
  if (bad) return fail(`occasions must come from ${OCCASIONS.join(", ")} (not "${bad}")`);
  return out as PlaceMetadata["occasions"];
}

function visits(v: unknown, today: Date): PlaceVisit[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return fail("visits must be a list");
  if (v.length > MAX_VISITS) return fail(`visits has more than ${MAX_VISITS} entries`);
  const out = v.map((x, n): PlaceVisit => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return fail(`visit ${n + 1} must have a date ("on")`);
    const r = x as Record<string, unknown>;
    const extra = Object.keys(r).find((k) => !["on", "with", "note"].includes(k));
    if (extra) return fail(`visit ${n + 1} has an unknown field "${extra}" (use on, with, note)`);
    const on = date(r.on, `visit ${n + 1} date`, today) ?? fail(`visit ${n + 1} must have a date ("on")`);
    const visit: PlaceVisit = { on };
    const w = text(r.with, `visit ${n + 1} "with"`, 100);
    const note = text(r.note, `visit ${n + 1} note`, 300);
    if (w) visit.with = w;
    if (note) visit.note = note;
    return visit;
  });
  // Newest first.
  out.sort((a, b) => b.on.localeCompare(a.on));
  return out.length ? out : undefined;
}

function coordinate(v: unknown, field: string, limit: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > limit) {
    return fail(`${field} must be a number from -${limit} to ${limit}`);
  }
  return Math.round(v * 1e6) / 1e6;
}

/**
 * The checked, tidied metadata of a place. Throws PlaceError with a short reason when a field
 * is unknown or wrong. A place is "want to go" until it has a rating, a visit or status "been";
 * the latest visit sets visited_on.
 */
export function normalizePlace(input: Record<string, unknown> | null | undefined, today = new Date()): PlaceMetadata {
  const m = input ?? {};
  if (typeof m !== "object" || Array.isArray(m)) fail("metadata must be an object");
  const unknown = Object.keys(m).find((k) => !FIELDS.includes(k));
  if (unknown) fail(`unknown place field "${unknown}" (known: ${FIELDS.join(", ")})`);

  const out: PlaceMetadata = { status: "want" };
  const address = text(m.address, "address", 300);
  if (address) out.address = address;

  const url = text(m.maps_url, "maps_url", 500);
  if (url) {
    if (!isMapsLink(url)) fail("maps_url must be a Google Maps link (https://maps.app.goo.gl/..., https://www.google.com/maps/...) or a geo: link");
    out.maps_url = url;
  }

  const k = kind(m.kind);
  if (k) out.kind = k;

  const status = m.status === undefined || m.status === null || m.status === "" ? undefined : slug(String(m.status));
  if (status !== undefined && status !== "want" && status !== "been") fail('status must be "want" or "been"');

  const rating = int(m.rating, "rating", 1, 5);
  const vs = visits(m.visits, today);
  let visitedOn = date(m.visited_on, "visited_on", today);
  if (vs && (!visitedOn || vs[0].on > visitedOn)) visitedOn = vs[0].on;

  const been = status === "been" || rating !== undefined || visitedOn !== undefined;
  if (status === "want" && been) fail('a place with a rating or a visit has status "been"');
  out.status = been ? "been" : "want";
  if (rating !== undefined) out.rating = rating;
  if (visitedOn) out.visited_on = visitedOn;

  const cuisine = list(m.cuisine, "cuisine", 10, 40);
  if (cuisine) out.cuisine = cuisine;
  const price = int(m.price_level, "price_level", 1, 4);
  if (price !== undefined) out.price_level = price;
  const dishes = list(m.dishes_liked, "dishes_liked", 20, 80);
  if (dishes) out.dishes_liked = dishes;
  if (m.would_return !== undefined && m.would_return !== null) {
    if (typeof m.would_return !== "boolean") fail("would_return must be true or false");
    out.would_return = m.would_return as boolean;
  }
  const occ = occasions(m.occasions);
  if (occ) out.occasions = occ;
  if (vs) out.visits = vs;

  const lat = coordinate(m.lat, "lat", 90);
  const lng = coordinate(m.lng, "lng", 180);
  if ((lat === undefined) !== (lng === undefined)) fail("lat and lng go together");
  if (lat !== undefined && lng !== undefined) {
    out.lat = lat;
    out.lng = lng;
  }

  const placeId = text(m.google_place_id, "google_place_id", 300);
  if (placeId) {
    if (!/^[A-Za-z0-9_-]+$/.test(placeId)) fail("google_place_id has unexpected characters");
    out.google_place_id = placeId;
  }
  return out;
}

/** "We went again last Friday with Sarah": the visit goes first, and the place counts as been. */
export function addVisit(
  current: Record<string, unknown> | null | undefined,
  visit: { on: string; with?: string; note?: string; rating?: number },
  today = new Date(),
): PlaceMetadata {
  const m = { ...(current ?? {}) };
  const { rating, ...v } = visit;
  const past = Array.isArray(m.visits) ? m.visits : [];
  if (past.length >= MAX_VISITS) past.splice(MAX_VISITS - 1);
  m.visits = [v, ...past];
  if (m.status === "want") delete m.status;
  if (rating !== undefined) m.rating = rating;
  return normalizePlace(m, today);
}

const OCCASION_WORDS: Record<string, string> = {
  date_night: "date night", kids: "with kids", business: "business", quick_lunch: "quick lunch",
  group: "group", special: "special occasion",
};

/**
 * The place's fields as plain lines, added to the text that meaning search reads (item_chunk).
 * Keyword search reads the metadata itself (migration 20261006120000_place_search.sql).
 */
export function placeText(m: PlaceMetadata): string {
  const lines = [
    m.kind && `Kind: ${m.kind === "to-visit" ? "place to visit" : m.kind}`,
    m.address && `Address: ${m.address}`,
    m.cuisine && `Cuisine: ${m.cuisine.join(", ")}`,
    m.price_level && `Price: ${"$".repeat(m.price_level)}`,
    m.status === "been" ? `Been there${m.rating ? `, rated ${m.rating}/5` : ""}` : "Want to go",
    m.would_return !== undefined && (m.would_return ? "Would go back" : "Would not go back"),
    m.dishes_liked && `Dishes liked: ${m.dishes_liked.join(", ")}`,
    m.occasions && `Good for: ${m.occasions.map((o) => OCCASION_WORDS[o]).join(", ")}`,
    ...(m.visits ?? []).slice(0, 10).map((v) =>
      `Visit ${v.on}${v.with ? ` with ${v.with}` : ""}${v.note ? `: ${v.note}` : ""}`
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

/** The body as meaning search reads it: a place's fields follow the text. */
export function withPlace(body: string, place: PlaceMetadata | null): string {
  if (!place) return body;
  const fields = placeText(place);
  return body.trim() ? `${body}\n\n${fields}` : fields;
}
