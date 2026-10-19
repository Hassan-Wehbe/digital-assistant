// Date night and family day (docs/planners-plan.md step 2, design D40): the chat function's outing
// route. A Pro feature like My day, counted once per plan for fair use (Q7: Another idea is another
// plan), and one AI request, counted against the month's AI allowance.
//
// Request:  POST, Authorization: Bearer <the user's access token>,
//           {"mode":"outing", "kind":"date"|"family", "date":"2026-10-23", "tz":"America/New_York",
//            "start"?:"19:00", "end"?:"22:00", "budget"?:1-3, "mood"?:"favourite"|"new",
//            "setting"?:"outdoor"|"indoor"|"either", "who"?:{"adults":2,"child_ages":[6,9]},
//            "events":[...as My day...], "start_from"?:{"home":id}, "avoid"?:[place ids]}
//           `who` holds roles and ages only: the app works them out from the household and never
//           sends a name (Q4), and the body refuses any other field.
// Response: 401 without a valid sign-in; 400 for a malformed body; 403 {"error":"pro_required"};
//           429 {"error":"fair_use"|"allowance_used"}; 200 {"plan": null, "reason": "no_home" |
//           "no_places" | "no_plan"}; otherwise 200 {"plan": OutingPlan, "usage": {"used","limit"}}.
//
// How (outing_plan.ts): code short-lists the user's saved places from searchable spaces only (rule
// 3), drive times from home (Mapbox) and the hourly rain there (NWS) are added, one AI request turns
// the numbered short list into a timed plan, and code checks it: places only from the list, times
// in the free hours, never over a calendar event. Then the real drives for the chosen order. Only
// points and times go to Mapbox and NWS; the plan is never stored (Mapbox's terms). The log line
// holds counts and codes only.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Llm, LlmError, RoutesConfigError } from "../_shared/llm/index.ts";
import type { Point } from "../_shared/dayplan/plan.ts";
import { PLACE_TYPE, placeScope } from "../mcp/lib/places.ts";
import { DAY, eventSchema, isTimeZone, LOCAL_TIME, MAX_AGENDA_EVENTS } from "./agenda.ts";
import { type DayDeps, gate, localTime, readHome } from "./day.ts";
import {
  type Busy, type Candidate, checkAnswer, type DraftStep, type OutingAsk, OUTING_SYSTEM, outingPrompt, type PlaceRow, shortlist, toMin, toTime,
} from "./outing_plan.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The model has this long to answer. */
export const OUTING_TIMEOUT_MS = 25_000;
/** record_ai_usage() refuses more than this per call. */
const MAX_RECORD_CENTS = 100;

export const outingBody = z.object({
  mode: z.literal("outing"),
  kind: z.enum(["date", "family"]),
  date: z.string().regex(DAY),
  tz: z.string().max(64).refine(isTimeZone),
  now: z.string().regex(LOCAL_TIME).optional(),
  start: z.string().regex(HHMM).optional(),
  end: z.string().regex(HHMM).optional(),
  budget: z.number().int().min(1).max(3).optional(),
  mood: z.enum(["favourite", "new"]).optional(),
  setting: z.enum(["outdoor", "indoor", "either"]).optional(),
  who: z.object({ adults: z.number().int().min(0).max(10), child_ages: z.array(z.number().int().min(0).max(17)).max(10) }).strict().optional(),
  events: z.array(eventSchema.extend({ key: z.string().min(1).max(200) })).max(MAX_AGENDA_EVENTS),
  start_from: z.object({ home: z.string().regex(UUID) }).strict().optional(),
  avoid: z.array(z.string().regex(UUID)).max(20).optional(),
}).strict();

export type OutingBody = z.infer<typeof outingBody>;

export interface OutingLog {
  event: "outing";
  request: string;
  user: string;
  kind?: "date" | "family";
  outcome: "ok" | "bad_request" | "pro_required" | "fair_use" | "allowance_used" | "no_home" | "no_places" | "no_plan" | "connection";
  code?: string;
  candidates: number;
  steps: number;
  /** Steps the model gave that the checks dropped. */
  dropped: number;
  model_calls: number;
  cost_cents: number;
  usage_recorded?: boolean;
  drive_requests: number;
}

export interface OutingDeps extends Pick<DayDeps, "clientFor" | "drives" | "weather" | "now"> {
  llm(): Pick<Llm, "stream">;
  log(entry: OutingLog): void;
}

/** A place in the plan, as the app shows it (Open in Maps). */
export interface PlaceRef {
  id: string;
  title: string;
  kind: string;
  cuisine?: string[];
  price_level?: number;
  address?: string;
  maps_url?: string;
  lat: number;
  lng: number;
}

export interface OutingStep {
  start: string;
  end: string;
  line: string;
  place?: PlaceRef;
  event?: { key: string; title: string };
  home?: true;
  /** Minutes driving to this step from the one before (or from home). */
  drive_min?: number;
}

export interface OutingPlan {
  kind: "date" | "family";
  date: string;
  title: string;
  /** The home it starts from (its name only). */
  from: string;
  /** When to leave home for the first stop. */
  leave_at?: string;
  steps: OutingStep[];
  /** Minutes back home from the last stop. */
  back_home_min?: number;
  alternative?: { place: PlaceRef; line: string; minutes?: number };
  /** Hourly rain in the window, at home. */
  rain: { at: string; rain_pct: number }[];
  credits: string[];
}

const ref = (c: Candidate): PlaceRef => ({
  id: c.id, title: c.title, kind: c.kind, ...(c.cuisine.length ? { cuisine: c.cuisine } : {}),
  ...(c.price_level ? { price_level: c.price_level } : {}), ...(c.address ? { address: c.address } : {}),
  ...(c.maps_url ? { maps_url: c.maps_url } : {}), lat: c.point.lat, lng: c.point.lng,
});

/** The user's saved places, live, from searchable spaces only (rule 3), checked again here. */
async function readPlaces(db: SupabaseClient): Promise<PlaceRow[]> {
  const { allowed } = await placeScope(db);
  if (!allowed.length) return [];
  const ok = new Set(allowed);
  const { data, error } = await db
    .from("item")
    .select("id, title, space_id, item_type, metadata, deleted_at")
    .eq("item_type", PLACE_TYPE)
    .is("deleted_at", null)
    .in("space_id", allowed)
    .limit(1000);
  if (error) throw new Error(`db:${error.code ?? "read"}`);
  return ((data ?? []) as (PlaceRow & { space_id: string; item_type: string; deleted_at: string | null })[])
    .filter((r) => r.item_type === PLACE_TYPE && !r.deleted_at && ok.has(r.space_id))
    .map((r) => ({ id: r.id, title: r.title, metadata: r.metadata }));
}

/** The window: date night from 7 pm (or the start given) for three hours; family day 9 to 6 (Q9). */
export function windowOf(body: Pick<OutingBody, "kind" | "start" | "end">): { start: string; end: string } | null {
  const start = body.start ?? (body.kind === "date" ? "19:00" : "09:00");
  const end = body.end ?? (body.kind === "date" ? toTime(Math.min(toMin(start) + 180, 23 * 60 + 59)) : "18:00");
  return toMin(end) - toMin(start) >= 60 ? { start, end } : null;
}

const json = (status: number, body: unknown) => ({ status, body });

export async function outingPlan(deps: OutingDeps, token: string, userId: string, raw: unknown, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const log: OutingLog = {
    event: "outing", request: crypto.randomUUID(), user: userId, outcome: "ok", candidates: 0, steps: 0, dropped: 0, model_calls: 0,
    cost_cents: 0, drive_requests: 0,
  };
  const done = (status: number, body: unknown) => {
    log.cost_cents = Math.round(log.cost_cents * 10_000) / 10_000;
    deps.log(log);
    return json(status, body);
  };
  const parsed = outingBody.safeParse(raw);
  const window = parsed.success ? windowOf(parsed.data) : null;
  if (!parsed.success || !window) {
    log.outcome = "bad_request";
    return done(400, { error: "bad_request", error_description: "send {mode: \"outing\", kind, date, tz, events: [...]} with at least an hour between start and end" });
  }
  const body = parsed.data;
  log.kind = body.kind;
  const ask: OutingAsk = {
    kind: body.kind, date: body.date, start: window.start, end: window.end,
    ...(body.kind === "date" ? { budget: body.budget ?? 3, mood: body.mood ?? "favourite" } : { setting: body.setting ?? "either", ...(body.who ? { who: body.who } : {}) }),
    ...(body.avoid ? { avoid: body.avoid } : {}),
  };
  const db = deps.clientFor(token);
  const now = deps.now?.() ?? Date.now();
  const today = localTime(now, body.tz)?.slice(0, 10) ?? body.date;

  try {
    const home = await readHome(db, body.start_from?.home);
    if (!home) {
      log.outcome = "no_home";
      return done(200, { plan: null, reason: "no_home" });
    }
    const homePoint: Point = { lat: home.lat, lng: home.lng };
    const cands = shortlist(await readPlaces(db), ask, homePoint, body.now?.slice(0, 10) ?? today);
    log.candidates = cands.length;
    if (!cands.length) {
      // Nothing to plan with: not counted, no AI request.
      log.outcome = "no_places";
      return done(200, { plan: null, reason: "no_places" });
    }

    const g = await gate(db);
    if (!g) throw new Error("db:no_gate");
    if (!g.allowed) {
      log.outcome = g.reason;
      return g.reason === "fair_use" ? done(429, { error: "fair_use", used: g.used, limit: g.limit }) : done(403, { error: "pro_required" });
    }
    const { data: allowance, error: allowanceError } = await db.rpc("my_ai_allowance");
    if (allowanceError || !allowance) throw new Error(`db:${allowanceError?.code ?? "no_allowance"}`);
    if (Number((allowance as { used_fraction: unknown }).used_fraction) >= 1) {
      log.outcome = "allowance_used";
      return done(429, { error: "allowance_used" });
    }

    // Drive times from home to each place, and the rain there (points and times only).
    const drives = deps.drives?.() ?? null;
    const at = `${body.date}T${window.start}`;
    if (drives) {
      await Promise.all(cands.map(async (c) => {
        log.drive_requests += 1;
        const leg = await drives.leg(homePoint, c.point, at, body.tz).catch(() => null);
        if (leg) c.minutes = leg.minutes;
      }));
    }
    const weather = deps.weather?.() ?? null;
    const w = weather ? await weather.at(homePoint, body.date, body.tz).catch(() => null) : null;
    const rain = w && w !== "outside_us"
      ? w.hourly.filter((h) => h.at.startsWith(body.date) && h.at.slice(11, 13) >= window.start.slice(0, 2) && h.at.slice(11, 16) <= window.end)
      : [];

    // The calendar's own events in the window stay as they are.
    const from = toMin(window.start);
    const to = toMin(window.end);
    const busy: Busy[] = body.events
      .filter((e) => !e.all_day && !e.free && !e.declined && e.start.startsWith(body.date))
      .filter((e) => toMin(e.start.slice(11, 16)) < to && toMin(e.end.slice(11, 16)) > from)
      .map((e) => ({ key: e.key, title: e.busy_only ? "Busy" : e.title.slice(0, 100), start: e.start, end: e.end }));

    // One AI request: the numbered short list, the free hours, the weather; JSON back.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), OUTING_TIMEOUT_MS);
    signal?.addEventListener("abort", () => timeout.abort());
    let answer = "";
    try {
      for await (
        const ev of deps.llm().stream("default", {
          system: OUTING_SYSTEM,
          messages: [{ role: "user", content: outingPrompt(ask, cands, busy, rain, today) }],
          tools: [],
          signal: timeout.signal,
        })
      ) {
        if (ev.type === "done") {
          log.model_calls += 1;
          log.cost_cents += ev.usage.costCents;
          answer = ev.turn.text;
        }
      }
    } catch (e) {
      log.code = timeout.signal.aborted ? "timeout" : e instanceof LlmError ? `llm:${e.code}` : e instanceof RoutesConfigError ? "routes_config" : e instanceof Error ? e.name : "unknown";
    } finally {
      clearTimeout(timer);
    }
    if (log.model_calls > 0) {
      const cents = Math.min(MAX_RECORD_CENTS, Math.max(0, Math.round(log.cost_cents * 10_000) / 10_000));
      const { error } = await db.rpc("record_ai_usage", { p_cost_cents: cents });
      log.usage_recorded = !error;
      if (error) log.code ??= `db:${error.code ?? "record_failed"}`;
    }

    const draft = answer ? checkAnswer(answer, ask, cands, busy) : null;
    if (!draft) {
      log.outcome = "no_plan";
      return done(200, { plan: null, reason: "no_plan", usage: { used: g.used, limit: g.limit } });
    }
    log.dropped = draft.dropped;
    log.steps = draft.steps.length;

    // The real drives for the chosen order: home → each stop with a place → … → home.
    const pointOf = (s: DraftStep): Point | null => {
      if (s.place) return s.place.point;
      if (s.home) return homePoint;
      const e = s.event ? body.events.find((x) => x.key === s.event!.key) : undefined;
      return e?.point ? { lat: e.point.lat, lng: e.point.lng } : null;
    };
    const steps: OutingStep[] = [];
    let prev: Point = homePoint;
    let leaveAt: string | undefined;
    for (const [i, s] of draft.steps.entries()) {
      const p = pointOf(s);
      let drive: number | undefined;
      if (p && drives && (p.lat !== prev.lat || p.lng !== prev.lng)) {
        const known = i === 0 && s.place?.minutes !== undefined ? { minutes: s.place.minutes } : null;
        log.drive_requests += known ? 0 : 1;
        drive = (known ?? await drives.leg(prev, p, `${body.date}T${s.start}`, body.tz).catch(() => null))?.minutes;
      }
      if (i === 0 && drive !== undefined) leaveAt = toTime(Math.max(0, toMin(s.start) - drive));
      steps.push({
        start: s.start, end: s.end, line: s.line,
        ...(s.place ? { place: ref(s.place) } : s.event ? { event: { key: s.event.key, title: s.event.title } } : { home: true as const }),
        ...(drive !== undefined ? { drive_min: drive } : {}),
      });
      if (p) prev = p;
    }
    let backHome: number | undefined;
    if (drives && (prev.lat !== homePoint.lat || prev.lng !== homePoint.lng)) {
      log.drive_requests += 1;
      backHome = (await drives.leg(prev, homePoint, `${body.date}T${draft.steps.at(-1)!.end}`, body.tz).catch(() => null))?.minutes;
    }

    const plan: OutingPlan = {
      kind: body.kind, date: body.date, title: draft.title, from: home.label,
      ...(leaveAt ? { leave_at: leaveAt } : {}),
      steps,
      ...(backHome !== undefined ? { back_home_min: backHome } : {}),
      ...(draft.alternative
        ? { alternative: { place: ref(draft.alternative.place), line: draft.alternative.line, ...(draft.alternative.place.minutes !== undefined ? { minutes: draft.alternative.place.minutes } : {}) } }
        : {}),
      rain: rain.map((h) => ({ at: h.at, rain_pct: h.rain_pct })),
      credits: [...(drives ? ["Drive times © Mapbox"] : []), ...(rain.length ? ["Weather: US National Weather Service"] : [])],
    };
    return done(200, { plan, usage: { used: g.used, limit: g.limit } });
  } catch (e) {
    log.outcome = "connection";
    log.code ??= e instanceof Error && e.message.startsWith("db:") ? e.message : e instanceof Error ? e.name : "unknown";
    return done(503, { error: "connection", error_description: "Could not make the plan. Try again." });
  }
}
