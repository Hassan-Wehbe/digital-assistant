// Find a place by name (docs/places-space-plan.md, D45 Q9): the app's "Find it on the map" sends
// what the user types ("Coral Gables lib") and gets Google's suggestions back ("Coral Gables Branch
// Library, 3443 Segovia St"). The Google key stays here, never on the phone, and the chat model
// never sees this function. Only suggestions are asked for, never Google's place details: the app
// keeps the place's Google id and the name the user confirmed, and finds the spot with the phone's
// own map lookup from the address shown (Google's terms let only the id be kept for good).
//
// The caller's sign-in says who they are (CLAUDE.md rule 5); no service-role key. Every request is
// counted in usage tracking (D34, google_places) and at most DAILY_REQUESTS are sent per user per
// day (UTC), about 20 places. Nothing typed is logged or stored: the log line holds a status only.
//
//   POST /functions/v1/place-search   Bearer token;
//        {"text": "coral gables lib", "session": "<one id per search>", "near": {"lat": .., "lng": ..}?}
//   200  {"available": true, "suggestions": [{"place_id", "name", "address", "kind"?}]}
//   200  {"available": false, "reason": "not_set_up" | "daily_limit"}: the app offers the address box

import { rejectCredentials } from "../mcp/lib/credentials.ts";

export interface Suggestion {
  place_id: string;
  name: string;
  address: string;
  /** A Wilma place kind guessed from Google's types, when it is clear (library, park, ...). */
  kind?: string;
}

export interface UsageRow {
  kind: "google_places" | "fair_use_hit";
  detail: string;
  count: number;
  cost_cents?: number;
  failures?: number;
}

export interface AutocompleteRequest {
  text: string;
  session: string;
  near?: { lat: number; lng: number };
}

export interface SearchDeps {
  /** The signed-in caller's id, or null for a missing, expired or fake token. */
  verifyToken(token: string): Promise<string | null>;
  /** Google's key (a Supabase secret), or undefined when it is not set up yet. */
  apiKey(): string | undefined;
  /** How many suggestion requests the caller sent today (UTC), from their own usage rows. */
  usedToday(token: string): Promise<number>;
  /** The caller's usage rows (never throws for the caller: a failure only goes in the log). */
  record(token: string, rows: UsageRow[]): Promise<void>;
  /** Google's answer as JSON; throws on a network error or a status that is not 2xx. */
  autocomplete(key: string, req: AutocompleteRequest): Promise<unknown>;
  /** A status and a fixed outcome word: never what was typed. */
  log(entry: { event: string; status: number; outcome: string }): void;
}

/** About 20 places a day (about 4-5 requests each while typing). */
export const DAILY_REQUESTS = 100;
/** Google's Autocomplete (New) list price, $2.83 per 1,000 requests (October 2026). */
export const CENTS_PER_REQUEST = 0.283;
export const MAX_SUGGESTIONS = 5;
export const NOT_ANSWERING = "The place search is not answering right now. Type the address instead.";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const PLACE_ID = /^[A-Za-z0-9_-]{1,300}$/;
const SESSION = /^[A-Za-z0-9_-]{8,64}$/;

/** Google's place types to a Wilma kind (mcp/lib/places.ts PLACE_KINDS); the first clear one wins. */
export function kindFromTypes(types: unknown): string | undefined {
  if (!Array.isArray(types)) return undefined;
  for (const t of types) {
    if (typeof t !== "string") continue;
    if (t === "library") return "library";
    if (/^(park|national_park|dog_park|playground|garden|beach|hiking_area)$/.test(t)) return "park";
    if (/^(swimming_pool|gym|fitness_center|stadium|sports_.+|athletic_field|golf_course|ice_skating_rink)$/.test(t)) return "sports";
    if (/^(school|primary_school|secondary_school|preschool|university|child_care_agency)$/.test(t)) return "school";
    if (/^(doctor|dentist|dental_clinic|pharmacy|drugstore|hospital|medical_lab|physiotherapist|veterinary_care)$/.test(t)) return "health";
    if (/^(cafe|coffee_shop|bakery|tea_house|ice_cream_shop|dessert_shop)$/.test(t)) return "cafe";
    if (/^(bar|pub|wine_bar|night_club)$/.test(t)) return "bar";
    if (t === "restaurant" || t.endsWith("_restaurant") || t === "meal_takeaway") return "restaurant";
    if (/^(lodging|hotel|motel|resort_hotel|bed_and_breakfast)$/.test(t)) return "hotel";
    if (/^(museum|tourist_attraction|art_gallery|zoo|aquarium|amusement_park|historical_landmark)$/.test(t)) return "to-visit";
    if (t === "store" || t.endsWith("_store") || /^(shopping_mall|supermarket|market)$/.test(t)) return "shop";
  }
  return undefined;
}

const short = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";

/** Google's answer, checked: place suggestions only, at most MAX_SUGGESTIONS, each with an id and a name. */
export function readSuggestions(raw: unknown): Suggestion[] {
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: Suggestion[] = [];
  for (const s of list) {
    const p = (s as { placePrediction?: Record<string, unknown> })?.placePrediction;
    if (!p || typeof p !== "object") continue;
    const id = typeof p.placeId === "string" ? p.placeId : "";
    const fmt = p.structuredFormat as { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } } | undefined;
    const name = short(fmt?.mainText?.text ?? (p.text as { text?: unknown })?.text, 200);
    if (!PLACE_ID.test(id) || !name) continue;
    const kind = kindFromTypes(p.types);
    out.push({ place_id: id, name, address: short(fmt?.secondaryText?.text, 300), ...(kind ? { kind } : {}) });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function readNear(v: unknown): { lat: number; lng: number } | undefined | null {
  if (v === undefined || v === null) return undefined;
  const { lat, lng } = v as Record<string, unknown>;
  const ok = (n: unknown, limit: number) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit;
  return ok(lat, 90) && ok(lng, 180) ? { lat: lat as number, lng: lng as number } : null;
}

export function createHandler(deps: SearchDeps) {
  return async (req: Request): Promise<Response> => {
    const done = (status: number, outcome: string, body: unknown) => {
      deps.log({ event: "place_search", status, outcome });
      return json(status, body);
    };
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const caller = token ? await deps.verifyToken(token).catch(() => null) : null;
    if (!caller || !token) return json(401, { error: "Sign in again first." });

    let body: { text?: unknown; session?: unknown; near?: unknown };
    try {
      body = await req.json();
    } catch {
      return done(400, "bad_request", { error: "Send the text to look for." });
    }
    const text = short(body.text, 1000);
    if (text.length < 3) return done(400, "bad_request", { error: "Type at least 3 letters." });
    if (text.length > 120) return done(400, "bad_request", { error: "Type a shorter name or address (120 letters at most)." });
    // Never send something that looks like a password to Google (rule 9's spirit): the same check as save_item.
    try {
      rejectCredentials({ text });
    } catch {
      return done(400, "refused", { error: "That looks like a password or a code; keep those in the vault, not in a place." });
    }
    if (typeof body.session !== "string" || !SESSION.test(body.session)) {
      return done(400, "bad_request", { error: "A search session id is needed." });
    }
    const near = readNear(body.near);
    if (near === null) return done(400, "bad_request", { error: "near must be {lat, lng}." });

    const key = deps.apiKey();
    if (!key) return done(200, "not_set_up", { available: false, reason: "not_set_up" });
    let used: number;
    try {
      used = await deps.usedToday(token);
    } catch {
      return done(502, "usage_unread", { error: NOT_ANSWERING });
    }
    if (used >= DAILY_REQUESTS) {
      await deps.record(token, [{ kind: "fair_use_hit", detail: "google_places", count: 1 }]).catch(() => {});
      return done(200, "daily_limit", { available: false, reason: "daily_limit" });
    }

    let raw: unknown;
    try {
      raw = await deps.autocomplete(key, { text, session: body.session, ...(near ? { near } : {}) });
    } catch {
      // A request Google refused may still be billed: counted, as a failure.
      await deps.record(token, [{ kind: "google_places", detail: "autocomplete", count: 1, cost_cents: CENTS_PER_REQUEST, failures: 1 }])
        .catch(() => {});
      return done(502, "google_error", { error: NOT_ANSWERING });
    }
    await deps.record(token, [{ kind: "google_places", detail: "autocomplete", count: 1, cost_cents: CENTS_PER_REQUEST }]).catch(() => {});
    return done(200, "ok", { available: true, suggestions: readSuggestions(raw) });
  };
}
