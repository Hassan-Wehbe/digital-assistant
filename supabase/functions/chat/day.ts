// My day (docs/phase6-day-planner-step2-plan.md, "How it works"): the chat function's day route.
// No model is called and no AI request is counted; a Pro feature, counted once per plan for fair use.
//
// Request:  POST, Authorization: Bearer <the user's access token>,
//           {"mode":"day", "date":"2026-10-09", "tz":"America/New_York", "now":"2026-10-09T13:05",
//            "events":[{"key", "title", "start", "end", "all_day", "location", "calendar",
//                       "point":{"lat","lng","by_name_only"}, "not_a_trip", "busy_only", "declined"}],
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
// (rule 3: a restricted space never adds anything to the plan). Nothing is stored; the log line
// holds counts only, never titles, places or times.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type DriveTimes, planDay, type PlanPlace, type PlanTask } from "../_shared/dayplan/plan.ts";
import { HOME_KIND, PLACE_TYPE, placePoint, placeScope } from "../mcp/lib/places.ts";
import { normalizeTask, TASK_TYPE } from "../mcp/lib/tasks.ts";
import { DAY, eventSchema, isTimeZone, LOCAL_TIME, MAX_AGENDA_EVENTS } from "./agenda.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dayEvent = eventSchema.extend({
  /** The app's id for the event (choices name it). */
  key: z.string().min(1).max(200),
  /** Where the phone's geocoder found the event's location text. */
  point: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    by_name_only: z.boolean().optional(),
  }).strict().optional(),
  not_a_trip: z.boolean().optional(),
});

export const dayBody = z.object({
  mode: z.literal("day"),
  date: z.string().regex(DAY),
  tz: z.string().max(64).refine(isTimeZone),
  now: z.string().regex(LOCAL_TIME).optional(),
  events: z.array(dayEvent).max(MAX_AGENDA_EVENTS),
  choices: z.object({
    together: z.array(z.array(z.string().max(200)).min(2).max(6)).max(20).optional(),
    not_driving: z.array(z.string().max(200)).max(100).optional(),
  }).strict().optional(),
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
  /** Drive times (Mapbox from step 3); none until then. */
  drives?(): DriveTimes | null;
  log(entry: DayLog): void;
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

  // Pro, and under today's fair-use limit (counted only when allowed): use_day_plan(), migration day_plan.
  const { data: gate, error: gateError } = await db.rpc("use_day_plan");
  if (gateError || !gate) {
    log.outcome = "connection";
    log.code = `db:${gateError?.code ?? "no_gate"}`;
    return done(503, { error: "connection", error_description: "Could not check your plan. Try again." });
  }
  const g = gate as { allowed: boolean; reason?: string; used?: number; limit?: number };
  if (!g.allowed) {
    if (g.reason === "fair_use") {
      log.outcome = "fair_use";
      return done(429, { error: "fair_use", used: g.used, limit: g.limit });
    }
    log.outcome = "pro_required";
    return done(403, { error: "pro_required" });
  }

  try {
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
    const events = body.events.map((e) => {
      const text = e.location?.trim() ?? "";
      const saved = text ? byName.get(norm(text)) ?? byName.get(norm(text.split(",")[0])) : undefined;
      if (saved) log.matched_places += 1;
      const place: PlanPlace | null = saved ??
        (e.point ? { lat: e.point.lat, lng: e.point.lng, label: text || e.title, ...(e.point.by_name_only ? { by_name_only: true } : {}) } : null);
      return {
        key: e.key, title: e.title, start: e.start, end: e.end, all_day: e.all_day, location: e.location ?? null, place,
        not_a_trip: e.not_a_trip, busy_only: e.busy_only, declined: e.declined,
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
      const plannedLocal = t.planned_at ? localTime(t.planned_at, body.tz) : undefined;
      const plannedToday = plannedLocal?.startsWith(body.date);
      if (t.due_on && t.due_on > body.date && !plannedToday) continue;
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

    const plan = await planDay({
      date: body.date, tz: body.tz, now: body.now, home, events, tasks: dayTasks,
      choices: body.choices, drives: deps.drives?.() ?? null, optionsFor: body.options_for,
    });
    log.drives = plan.rows.filter((r) => r.kind === "drive").length;
    return done(200, { plan, usage: { used: g.used, limit: g.limit } });
  } catch (e) {
    log.outcome = "connection";
    log.code = e instanceof Error && e.message.startsWith("db:") ? e.message : e instanceof Error ? e.name : "unknown";
    return done(503, { error: "connection", error_description: "Could not make the plan. Try again." });
  }
}

/** "2026-10-09T21:05:00Z" as the user's local "2026-10-09T17:05" in tz. */
export function localTime(moment: string, tz: string): string | undefined {
  const t = Date.parse(moment);
  if (!Number.isFinite(t)) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
