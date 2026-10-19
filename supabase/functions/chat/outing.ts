// Date night and family day (docs/planners-plan.md step 2, design D40): the chat function's outing
// route. A Pro feature like My day, counted once per plan for fair use (Q7: Another idea is another
// plan), and one AI request, counted against the month's AI allowance.
//
// Request:  POST, Authorization: Bearer <the user's access token>,
//           {"mode":"outing", "kind":"date"|"family", "date":"2026-10-23", "tz":"America/New_York",
//            "start"?:"19:00", "end"?:"22:00", "occasion"?:"dinner"|"lunch"|"coffee"|"drinks"|"activity",
//            "budget"?:1-3, "mood"?:"favourite"|"new",
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
// in the free hours, never over a busy time. The calendar gives busy times only: the model never sees
// an event's title and an event is never a step (owner, 2026-10-19); the plan says which times it went
// around. Then the real drives for the chosen order. Only
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
  type Busy, type Candidate, checkAnswer, type DraftStep, type Occasion, OCCASIONS, type OutingAsk, OUTING_SYSTEM, outingPrompt, type PlaceRow,
  shortlist, toMin, toTime,
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
  occasion: z.enum(OCCASIONS).optional(),
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
  /** false: the AI request is recorded with the chat message it belongs to (plan_outing), not here. */
  recordUsage?: boolean;
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
  home?: true;
  /** Minutes driving to this step from the one before (or from home). */
  drive_min?: number;
}

export interface OutingPlan {
  kind: "date" | "family";
  /** A date: what kind. */
  occasion?: Occasion;
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
  /** The busy times from the calendar it was planned around ("HH:MM"; never a title). */
  around: { start: string; end: string }[];
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

/** A date's usual start and length, by its kind (the start given wins). */
export const OCCASION_TIMES: Record<Occasion, { start: string; minutes: number }> = {
  dinner: { start: "19:00", minutes: 180 },
  lunch: { start: "12:00", minutes: 120 },
  coffee: { start: "10:00", minutes: 90 },
  drinks: { start: "20:00", minutes: 150 },
  activity: { start: "14:00", minutes: 240 },
};

/** The window: a date from its start for its kind's length; family day 9 to 6 (Q9). At least an hour. */
export function windowOf(body: Pick<OutingBody, "kind" | "start" | "end" | "occasion">): { start: string; end: string } | null {
  const usual = OCCASION_TIMES[body.occasion ?? "dinner"];
  const start = body.start ?? (body.kind === "date" ? usual.start : "09:00");
  const end = body.end ?? (body.kind === "date" ? toTime(Math.min(toMin(start) + usual.minutes, 23 * 60 + 59)) : "18:00");
  return toMin(end) - toMin(start) >= 60 ? { start, end } : null;
}

const json = (status: number, body: unknown) => ({ status, body });

/** What one outing came to (the route and the chat's plan_outing both read it). */
export type OutingOutcome =
  | { plan: OutingPlan; usage: { used?: number; limit?: number } }
  | { empty: "no_home" | "no_places" | "no_plan" }
  | { refused: "pro_required" | "fair_use" | "allowance_used"; used?: number; limit?: number }
  | { connection: true };

/**
 * One outing, as the user (RLS): home, the short list (searchable spaces only), Pro and fair use,
 * the AI allowance, drives and rain, one AI request, the checks, the real drives. Fills the log.
 */
export async function runOuting(
  deps: OutingDeps, db: SupabaseClient, body: OutingBody, window: { start: string; end: string }, log: OutingLog, signal?: AbortSignal,
): Promise<OutingOutcome> {
  log.kind = body.kind;
  const ask: OutingAsk = {
    kind: body.kind, date: body.date, start: window.start, end: window.end,
    ...(body.kind === "date"
      ? { occasion: body.occasion ?? "dinner", budget: body.budget ?? 3, mood: body.mood ?? "favourite" }
      : { setting: body.setting ?? "either", ...(body.who ? { who: body.who } : {}) }),
    ...(body.avoid ? { avoid: body.avoid } : {}),
  };
  const now = deps.now?.() ?? Date.now();
  const today = localTime(now, body.tz)?.slice(0, 10) ?? body.date;

  try {
    const home = await readHome(db, body.start_from?.home);
    if (!home) {
      log.outcome = "no_home";
      return { empty: "no_home" };
    }
    const homePoint: Point = { lat: home.lat, lng: home.lng };
    const cands = shortlist(await readPlaces(db), ask, homePoint, body.now?.slice(0, 10) ?? today);
    log.candidates = cands.length;
    if (!cands.length) {
      // Nothing to plan with: not counted, no AI request.
      log.outcome = "no_places";
      return { empty: "no_places" };
    }

    const g = await gate(db);
    if (!g) throw new Error("db:no_gate");
    if (!g.allowed) {
      log.outcome = g.reason;
      return { refused: g.reason, used: g.used, limit: g.limit };
    }
    const { data: allowance, error: allowanceError } = await db.rpc("my_ai_allowance");
    if (allowanceError || !allowance) throw new Error(`db:${allowanceError?.code ?? "no_allowance"}`);
    if (Number((allowance as { used_fraction: unknown }).used_fraction) >= 1) {
      log.outcome = "allowance_used";
      return { refused: "allowance_used" };
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

    // The calendar's busy times in the window: planned around, times only (never a title).
    const from = toMin(window.start);
    const to = toMin(window.end);
    const busy: Busy[] = body.events
      .filter((e) => !e.all_day && !e.free && !e.declined && e.start.startsWith(body.date))
      .filter((e) => toMin(e.start.slice(11, 16)) < to && toMin(e.end.slice(11, 16)) > from)
      .map((e) => ({ start: e.start, end: e.end.startsWith(body.date) ? e.end : `${body.date}T23:59` }))
      .sort((a, b) => a.start.localeCompare(b.start));

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
    if (log.model_calls > 0 && deps.recordUsage !== false) {
      const cents = Math.min(MAX_RECORD_CENTS, Math.max(0, Math.round(log.cost_cents * 10_000) / 10_000));
      const { error } = await db.rpc("record_ai_usage", { p_cost_cents: cents });
      log.usage_recorded = !error;
      if (error) log.code ??= `db:${error.code ?? "record_failed"}`;
    }

    const draft = answer ? checkAnswer(answer, ask, cands, busy) : null;
    if (!draft) {
      log.outcome = "no_plan";
      return { empty: "no_plan" };
    }
    log.dropped = draft.dropped;
    log.steps = draft.steps.length;

    // The real drives for the chosen order: home → each stop with a place → … → home.
    const pointOf = (s: DraftStep): Point | null => (s.place ? s.place.point : s.home ? homePoint : null);
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
        ...(s.place ? { place: ref(s.place) } : { home: true as const }),
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
      kind: body.kind, ...(body.kind === "date" ? { occasion: ask.occasion } : {}), date: body.date, title: draft.title, from: home.label,
      ...(leaveAt ? { leave_at: leaveAt } : {}),
      steps,
      ...(backHome !== undefined ? { back_home_min: backHome } : {}),
      ...(draft.alternative
        ? { alternative: { place: ref(draft.alternative.place), line: draft.alternative.line, ...(draft.alternative.place.minutes !== undefined ? { minutes: draft.alternative.place.minutes } : {}) } }
        : {}),
      around: busy.slice(0, 10).map((b) => ({ start: b.start.slice(11, 16), end: b.end.slice(11, 16) })),
      rain: rain.map((h) => ({ at: h.at, rain_pct: h.rain_pct })),
      credits: [...(drives ? ["Drive times © Mapbox"] : []), ...(rain.length ? ["Weather: US National Weather Service"] : [])],
    };
    return { plan, usage: { used: g.used, limit: g.limit } };
  } catch (e) {
    log.outcome = "connection";
    log.code ??= e instanceof Error && e.message.startsWith("db:") ? e.message : e instanceof Error ? e.name : "unknown";
    return { connection: true };
  }
}

/** A new log line for one outing (counts and codes only). */
export const outingLog = (userId: string): OutingLog => ({
  event: "outing", request: crypto.randomUUID(), user: userId, outcome: "ok", candidates: 0, steps: 0, dropped: 0, model_calls: 0,
  cost_cents: 0, drive_requests: 0,
});

/** The route ({"mode":"outing"}): the outcome as a status and a JSON body. */
export async function outingPlan(deps: OutingDeps, token: string, userId: string, raw: unknown, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const log = outingLog(userId);
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
  const out = await runOuting(deps, deps.clientFor(token), parsed.data, window, log, signal);
  if ("plan" in out) return done(200, { plan: out.plan, usage: out.usage });
  if ("empty" in out) return done(200, { plan: null, reason: out.empty });
  if ("refused" in out) {
    if (out.refused === "pro_required") return done(403, { error: "pro_required" });
    if (out.refused === "fair_use") return done(429, { error: "fair_use", used: out.used, limit: out.limit });
    return done(429, { error: "allowance_used" });
  }
  return done(503, { error: "connection", error_description: "Could not make the plan. Try again." });
}

// ---- In the chat: plan_outing (planners step 4) --------------------------------------------------

export const PLAN_OUTING = "plan_outing";
/** What the app lists in "can" for the plan card. */
export const CAN_OUTING = "outing";

export const PLAN_OUTING_SPEC = {
  name: PLAN_OUTING,
  description:
    "Chat app only. Plans a date (dinner, lunch, coffee, drinks or an activity, any day) or a family day from the " +
    "user's own saved places, around their calendar's busy times, with drive times from home and the weather " +
    "(\"plan a date night Friday\", \"a coffee date Tuesday at 10\", \"a family day Saturday, outdoors\"). Pro, like My day; " +
    "one plan each call (counted). The app shows the plan as a card with Add to calendar; nothing is added or " +
    "saved by you. Never put a name in it: for a family day give adults and the children's ages if the user said " +
    "them, else leave them out and the user's household setting is used (ages only).",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["date", "family"] },
      date: { type: "string", description: "YYYY-MM-DD, from today's date when they say \"Friday\" or \"tomorrow\"" },
      occasion: { type: "string", enum: [...OCCASIONS], description: "A date: what kind (default dinner): \"coffee date\" coffee, \"lunch date\" lunch" },
      start: { type: "string", description: "HH:MM, only if they said a time (by default: dinner 19:00, lunch 12:00, coffee 10:00, drinks 20:00, activity 14:00; family day 09:00)" },
      end: { type: "string", description: "HH:MM, only if they said when it ends" },
      budget: { type: "integer", minimum: 1, maximum: 3, description: "A date: 1 cheap … 3 any (default 3)" },
      mood: { type: "string", enum: ["favourite", "new"], description: "A date: a favourite, or somewhere new they want to try" },
      setting: { type: "string", enum: ["outdoor", "indoor", "either"], description: "Family day" },
      adults: { type: "integer", minimum: 0, maximum: 10, description: "Family day: only if the user said" },
      child_ages: { type: "array", items: { type: "integer", minimum: 0, maximum: 17 }, maxItems: 10, description: "Family day: only if the user said" },
    },
    required: ["kind", "date"],
    additionalProperties: false,
  },
};

export interface ChatOutingContext {
  db: SupabaseClient;
  userId: string;
  tz?: string;
  /** The calendar the app re-sent for this message (get_day_agenda), when there is one. */
  events?: { date: string; list: OutingBody["events"] };
  /** The app shows the plan card. */
  can: boolean;
}

const chatInput = z.object({
  kind: z.enum(["date", "family"]),
  date: z.string().regex(DAY),
  start: z.string().regex(HHMM).optional(),
  end: z.string().regex(HHMM).optional(),
  occasion: z.enum(OCCASIONS).optional(),
  budget: z.number().int().min(1).max(3).optional(),
  mood: z.enum(["favourite", "new"]).optional(),
  setting: z.enum(["outdoor", "indoor", "either"]).optional(),
  adults: z.number().int().min(0).max(10).optional(),
  child_ages: z.array(z.number().int().min(0).max(17)).max(10).optional(),
}).strict();

/** The household as roles and ages (RLS: the user's own rows); never a label (Q4). */
async function householdWho(db: SupabaseClient, year: number): Promise<{ adults: number; child_ages: number[] } | undefined> {
  const { data, error } = await db.from("household_member").select("kind, birth_year").limit(10);
  if (error || !data?.length) return undefined;
  const rows = data as { kind: string; birth_year: number | null }[];
  return {
    adults: rows.filter((r) => r.kind === "adult").length,
    child_ages: rows.filter((r) => r.kind === "child" && typeof r.birth_year === "number").map((r) => Math.min(17, Math.max(0, year - r.birth_year!))),
  };
}

/** plan_outing in the chat: the same outing as the screens, worded by the model, shown as a card. */
export async function outingForChat(
  deps: OutingDeps, ctx: ChatOutingContext, input: Record<string, unknown>,
): Promise<{ isError: boolean; text: string; events: Record<string, unknown>[]; costCents: number }> {
  const log = outingLog(ctx.userId);
  const finish = (isError: boolean, text: string, events: Record<string, unknown>[] = []) => {
    const costCents = log.cost_cents;
    log.cost_cents = Math.round(log.cost_cents * 10_000) / 10_000;
    deps.log(log);
    return { isError, text, events, costCents };
  };
  const parsed = chatInput.safeParse(input);
  if (!parsed.success) {
    log.outcome = "bad_request";
    return finish(true, "plan_outing takes kind, date (YYYY-MM-DD) and optional start, end, budget 1-3, mood, setting, adults, child_ages. No names.");
  }
  const a = parsed.data;
  const tz = ctx.tz ?? "UTC";
  const now = deps.now?.() ?? Date.now();
  const year = Number((localTime(now, tz) ?? new Date(now).toISOString()).slice(0, 4));
  const who = a.kind === "family"
    ? (a.adults !== undefined || a.child_ages ? { adults: a.adults ?? 0, child_ages: a.child_ages ?? [] } : await householdWho(ctx.db, year))
    : undefined;
  const calendarChecked = ctx.events?.date === a.date;
  const body: OutingBody = {
    mode: "outing", kind: a.kind, date: a.date, tz,
    ...(a.start ? { start: a.start } : {}), ...(a.end ? { end: a.end } : {}),
    ...(a.kind === "date"
      ? { occasion: a.occasion ?? "dinner", budget: a.budget ?? 3, mood: a.mood ?? "favourite" }
      : { setting: a.setting ?? "either", ...(who ? { who } : {}) }),
    events: calendarChecked ? ctx.events!.list : [],
  };
  const window = windowOf(body);
  if (!window) {
    log.outcome = "bad_request";
    return finish(true, "start and end must leave at least an hour.");
  }
  const out = await runOuting({ ...deps, recordUsage: false }, ctx.db, body, window, log);
  if ("plan" in out) {
    const p = out.plan;
    const facts = {
      status: "shown",
      title: p.title, date: p.date, from: p.from, ...(p.leave_at ? { leave_at: p.leave_at } : {}),
      steps: p.steps.map((s) => ({
        time: `${s.start}-${s.end}`, what: s.place?.title ?? "home", ...(s.line ? { line: s.line } : {}),
        ...(s.drive_min !== undefined ? { drive_min: s.drive_min } : {}),
      })),
      ...(p.alternative ? { alternative: p.alternative.place.title } : {}),
      ...(p.rain.some((h) => h.rain_pct >= 50) ? { rain_likely: true } : {}),
      calendar_checked: calendarChecked,
      ...(p.around.length ? { planned_around_busy_times: p.around.map((b) => `${b.start}-${b.end}`) } : {}),
      message: (ctx.can
        ? "The app shows this plan as a card with Add to calendar and Open in Maps. Say it in two or three short sentences from these facts only; "
        : "This app cannot show the plan card: give the plan in a few short lines from these facts only; ") +
        "never add a place or a time. Nothing was added to the calendar or saved." +
        (calendarChecked
          ? " It was planned around their calendar's busy times; their events are not part of the plan."
          : " Their calendar was not checked for that day: say they can use Date night or Family day on Home to plan around it."),
    };
    return finish(false, JSON.stringify(facts), ctx.can ? [{ type: "outing_plan", plan: p }] : []);
  }
  if ("empty" in out) {
    const say = {
      no_home: "The user has no home saved, so drives cannot be worked out. Offer save_home, or say they can set where they leave from in My day.",
      no_places: "The user has no saved places that fit. Say Wilma plans from their own saved places, and suggest saving a few (restaurants, parks) and marking them date night or kids.",
      no_plan: "No plan could be made from their places this time. Say so in one sentence and offer to try again with other choices.",
    }[out.empty];
    return finish(false, JSON.stringify({ status: out.empty, message: say }));
  }
  if ("refused" in out) {
    const say = {
      pro_required: "Planning a date night or family day is part of Wilma Pro. Say so in one sentence; nothing was made.",
      fair_use: "Today's plans are used up. Say they can plan again tomorrow.",
      allowance_used: "This month's AI allowance is used up. Say so in one sentence.",
    }[out.refused];
    return finish(false, JSON.stringify({ status: out.refused, message: say }));
  }
  return finish(true, "The plan could not be made just now (a connection problem). Say so in one sentence.");
}
