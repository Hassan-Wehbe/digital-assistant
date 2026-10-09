// My day (docs/phase6-day-planner-step2-plan.md, "How it works"): the chat function's day route.
// No model is called and no AI request is counted; a Pro feature, counted once per plan for fair use.
//
// Request:  POST, Authorization: Bearer <the user's access token>,
//           {"mode":"day", "date":"2026-10-09", "tz":"America/New_York", "now":"2026-10-09T13:05",
//            "events":[{"key", "title", "start", "end", "all_day", "location", "calendar",
//                       "point":{"lat","lng","by_name_only"}, "not_a_trip", "drop_off", "free", "busy_only", "declined"}],
//            "choices":{"together":[["key1","key2"]], "not_driving":["key3"]},
//            "options_for":"<task id>"}
//           The app reads the ticked calendars for that day and finds event places on the phone
//           (the geocoder, as "Is this it?"); the user's answers (Take both, Not driving, "Dentist is
//           Dr. Lee's office") stay on the phone and come with each request (Q7).
// Response: 401 without a valid sign-in; 400 for a malformed body; 403 {"error":"pro_required"};
//           429 {"error":"fair_use","used","limit"}; otherwise {"plan": DayPlan, "usage": {"used","limit"}}.
//
// From the database, as the user (RLS): Home (the place of kind home), saved places to match an
// event's location text by name, and open tasks for the day, all from searchable spaces only
// (rule 3: a restricted space never adds anything to the plan). Drive times from Mapbox and weather
// from the US National Weather Service (step 3; only points and times leave, never a title). Nothing
// is stored (Mapbox's terms do not allow keeping its results either); the log line holds counts
// only, never titles, places or times.
//
// The chat uses the same plan for "plan my day" (planForChat): when the app re-sends one day's
// calendar for get_day_agenda, the model gets the planner's numbers with it (agenda.ts).
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Choices, type DayPlan, type DriveTimes, planDay, type PlanEvent, type PlanPlace, type PlanTask } from "../_shared/dayplan/plan.ts";
import type { Weather } from "../_shared/dayplan/nws.ts";
import { localTime } from "../_shared/dayplan/time.ts";
import { HOME_KIND, PLACE_TYPE, placePoint, placeScope } from "../mcp/lib/places.ts";
import { normalizeTask, TASK_TYPE } from "../mcp/lib/tasks.ts";
import { type Agenda, type ChatPlan, choicesSchema, DAY, eventSchema, isTimeZone, LOCAL_TIME, MAX_AGENDA_EVENTS } from "./agenda.ts";

export { localTime };
export type { ChatPlan };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dayEvent = eventSchema.extend({
  /** The app's id for the event (choices name it). */
  key: z.string().min(1).max(200),
});

export const dayBody = z.object({
  mode: z.literal("day"),
  date: z.string().regex(DAY),
  tz: z.string().max(64).refine(isTimeZone),
  now: z.string().regex(LOCAL_TIME).optional(),
  events: z.array(dayEvent).max(MAX_AGENDA_EVENTS),
  choices: choicesSchema.optional(),
  options_for: z.string().regex(UUID).optional(),
});

export type DayBody = z.infer<typeof dayBody>;

/** One log line per plan: counts and codes only. */
export interface DayLog {
  event: "day";
  request: string;
  user: string;
  outcome: "ok" | "bad_request" | "pro_required" | "fair_use" | "connection";
  code?: string;
  events: number;
  tasks: number;
  drives: number;
  matched_places: number;
  /** Requests to Mapbox and NWS for this plan, and how many failed. */
  drive_requests?: number;
  drive_failures?: number;
  weather_requests?: number;
  weather_failures?: number;
}

interface Row {
  id: string;
  title: string;
  space_id: string;
  item_type: string;
  metadata: Record<string, unknown> | null;
  deleted_at: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Places and tasks the plan may use: the user's own, live, in searchable spaces only (rule 3). */
async function readItems(db: SupabaseClient): Promise<{ places: Row[]; tasks: Row[] }> {
  const { allowed } = await placeScope(db);
  if (!allowed.length) return { places: [], tasks: [] };
  const allowedSet = new Set(allowed);
  const read = async (type: string) => {
    const { data, error } = await db
      .from("item")
      .select("id, title, space_id, item_type, metadata, deleted_at")
      .eq("item_type", type)
      .is("deleted_at", null)
      .in("space_id", allowed)
      .limit(1000);
    if (error) throw new Error(`db:${error.code ?? "read"}`);
    // Checked again here, whatever the database returned.
    return ((data ?? []) as Row[]).filter((r) => r.item_type === type && !r.deleted_at && allowedSet.has(r.space_id));
  };
  return { places: await read(PLACE_TYPE), tasks: await read(TASK_TYPE) };
}

/** A saved place with a location, as the planner takes it. */
function asPlace(r: Row): PlanPlace | null {
  const p = placePoint(r.metadata);
  return p ? { ...p, label: r.title } : null;
}

export interface DayDeps {
  clientFor(token: string): SupabaseClient;
  /** Drive times for one plan (Mapbox, mapbox.ts; none without MAPBOX_TOKEN). */
  drives?(): (DriveTimes & { stats?: ProviderStats }) | null;
  /** Weather for one plan (NWS, nws.ts; none without NWS_CONTACT). */
  weather?(): (Weather & { stats?: ProviderStats }) | null;
  log(entry: DayLog): void;
}

interface ProviderStats {
  requests: number;
  failed: number;
}

/** An event as the app sends it, for the planner (the day route's and the re-sent agenda's). */
interface SentEvent {
  key: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location?: string | null;
  point?: { lat: number; lng: number; by_name_only?: boolean };
  not_a_trip?: boolean;
  drop_off?: boolean;
  free?: boolean;
  busy_only?: boolean;
  declined?: boolean;
}

interface PlanRequest {
  date: string;
  tz: string;
  now?: string;
  events: SentEvent[];
  choices?: Choices;
  optionsFor?: string;
}

/** Pro, and under today's fair-use limit (counted only when allowed): use_day_plan(), migration day_plan. */
type Gate = { allowed: true; used?: number; limit?: number } | { allowed: false; reason: "pro_required" | "fair_use"; used?: number; limit?: number };

async function gate(db: SupabaseClient): Promise<Gate | null> {
  const { data, error } = await db.rpc("use_day_plan");
  if (error || !data) return null;
  const g = data as { allowed: boolean; reason?: string; used?: number; limit?: number };
  if (g.allowed) return { allowed: true, used: g.used, limit: g.limit };
  return { allowed: false, reason: g.reason === "fair_use" ? "fair_use" : "pro_required", used: g.used, limit: g.limit };
}

/**
 * The plan for one day, as the user (RLS): Home, saved places (matched to events by name), the
 * day's open tasks, all from searchable spaces only (rule 3); drive times and weather from the
 * providers. Throws "db:<code>" when the database cannot be read. Fills the log's counts.
 */
async function makePlan(deps: DayDeps, db: SupabaseClient, req: PlanRequest, log: DayLog): Promise<DayPlan> {
  const { places, tasks } = await readItems(db);
  const homeRow = places.find((p) => p.metadata?.kind === HOME_KIND);
  const home = homeRow ? asPlace(homeRow) : null;
  // A saved place named like the event's location ("Aquatic Center", "Hinode Sushi, Oviedo") is
  // the most reliable point; else the phone's geocoder result; else the app asks "Where is this?".
  const byName = new Map<string, PlanPlace>();
  for (const r of places) {
    const p = r.metadata?.kind === HOME_KIND ? null : asPlace(r);
    if (p) byName.set(norm(r.title), p);
  }
  const events: PlanEvent[] = req.events.map((e) => {
    const text = e.location?.trim() ?? "";
    const saved = text ? byName.get(norm(text)) ?? byName.get(norm(text.split(",")[0])) : undefined;
    if (saved) log.matched_places += 1;
    const place: PlanPlace | null = saved ??
      (e.point ? { lat: e.point.lat, lng: e.point.lng, label: text || e.title, ...(e.point.by_name_only ? { by_name_only: true } : {}) } : null);
    return {
      key: e.key, title: e.title, start: e.start, end: e.end, all_day: e.all_day, location: e.location ?? null, place,
      not_a_trip: e.not_a_trip, drop_off: e.drop_off, free: e.free, busy_only: e.busy_only, declined: e.declined,
    };
  });

  // Open tasks for the day: due by then (overdue too), no date, or planned on it.
  const placeById = new Map(places.map((r) => [r.id, r]));
  const dayTasks: PlanTask[] = [];
  for (const r of tasks) {
    let t;
    try {
      t = normalizeTask(r.metadata ?? {});
    } catch {
      continue; // a task whose fields do not check is left out of the plan, never guessed
    }
    if (t.status !== "open") continue;
    const plannedLocal = t.planned_at ? localTime(t.planned_at, req.tz) : undefined;
    const plannedToday = plannedLocal?.startsWith(req.date);
    if (t.due_on && t.due_on > req.date && !plannedToday) continue;
    const placeRow = t.place_id ? placeById.get(t.place_id) : undefined;
    dayTasks.push({
      id: r.id, title: r.title, priority: t.priority,
      ...(t.duration_min ? { duration_min: t.duration_min } : {}),
      ...(t.duration_estimated ? { duration_estimated: true } : {}),
      ...(t.due_on ? { due_on: t.due_on } : {}),
      ...(t.repeat ? { repeat: t.repeat } : {}),
      ...(plannedToday ? { planned_at: plannedLocal } : {}),
      place: placeRow ? asPlace(placeRow) : null,
    });
  }
  log.tasks = dayTasks.length;

  const drives = deps.drives?.() ?? null;
  const weather = deps.weather?.() ?? null;
  const plan = await planDay({
    date: req.date, tz: req.tz, now: req.now, home, events, tasks: dayTasks,
    choices: req.choices, drives, weather, optionsFor: req.optionsFor,
  });
  log.drives = plan.rows.filter((r) => r.kind === "drive").length;
  if (drives?.stats) {
    log.drive_requests = drives.stats.requests;
    log.drive_failures = drives.stats.failed;
  }
  if (weather?.stats) {
    log.weather_requests = weather.stats.requests;
    log.weather_failures = weather.stats.failed;
  }
  return plan;
}

const json = (status: number, body: unknown) => ({ status, body });

/** The day route's answer: a status and a JSON body (chat.ts adds the headers). */
export async function dayPlan(deps: DayDeps, token: string, userId: string, raw: unknown): Promise<{ status: number; body: unknown }> {
  const log: DayLog = {
    event: "day", request: crypto.randomUUID(), user: userId, outcome: "ok", events: 0, tasks: 0, drives: 0, matched_places: 0,
  };
  const done = (status: number, body: unknown) => {
    deps.log(log);
    return json(status, body);
  };
  const parsed = dayBody.safeParse(raw);
  if (!parsed.success) {
    log.outcome = "bad_request";
    return done(400, { error: "bad_request", error_description: "send {mode: \"day\", date, tz, events: [...]}" });
  }
  const body = parsed.data;
  log.events = body.events.length;
  const db = deps.clientFor(token);

  const g = await gate(db);
  if (!g) {
    log.outcome = "connection";
    log.code = "db:no_gate";
    return done(503, { error: "connection", error_description: "Could not check your plan. Try again." });
  }
  if (!g.allowed) {
    if (g.reason === "fair_use") {
      log.outcome = "fair_use";
      return done(429, { error: "fair_use", used: g.used, limit: g.limit });
    }
    log.outcome = "pro_required";
    return done(403, { error: "pro_required" });
  }

  try {
    const plan = await makePlan(deps, db, {
      date: body.date, tz: body.tz, now: body.now, events: body.events, choices: body.choices, optionsFor: body.options_for,
    }, log);
    return done(200, { plan, usage: { used: g.used, limit: g.limit } });
  } catch (e) {
    log.outcome = "connection";
    log.code = e instanceof Error && e.message.startsWith("db:") ? e.message : e instanceof Error ? e.name : "unknown";
    return done(503, { error: "connection", error_description: "Could not make the plan. Try again." });
  }
}

/**
 * The planner on the calendar the app re-sent for get_day_agenda (one day only: "plan my day",
 * "plan tomorrow"). Pro and fair use as for My day (a chat plan counts as one plan). The events are
 * keyed e0, e1, ... in the agenda's order; `titles` maps them back. Logged like My day (counts only).
 */
export async function planForChat(deps: DayDeps, db: SupabaseClient, userId: string, agenda: Agenda, now = Date.now()): Promise<ChatPlan> {
  if (agenda.from !== agenda.to) return { made: false, reason: "not_one_day" };
  const log: DayLog = {
    event: "day", request: crypto.randomUUID(), user: userId, outcome: "ok", events: agenda.events.length, tasks: 0, drives: 0,
    matched_places: 0,
  };
  const out = await (async (): Promise<ChatPlan> => {
    const g = await gate(db);
    if (!g) return { made: false, reason: "connection" };
    if (!g.allowed) return { made: false, reason: g.reason };
    const events = agenda.events.map((e, i) => ({ ...e, key: `e${i}` }));
    const today = localTime(now, agenda.time_zone);
    const plan = await makePlan(deps, db, {
      date: agenda.from, tz: agenda.time_zone, now: today?.startsWith(agenda.from) ? today : undefined, events,
      choices: agenda.choices,
    }, log);
    return { made: true, plan, titles: new Map(events.map((e) => [e.key, e.busy_only ? "Busy" : e.title])) };
  })().catch((e): ChatPlan => {
    log.code = e instanceof Error && e.message.startsWith("db:") ? e.message : e instanceof Error ? e.name : "unknown";
    return { made: false, reason: "connection" };
  });
  if (!out.made && out.reason !== "not_one_day") log.outcome = out.reason;
  deps.log(log);
  return out;
}
