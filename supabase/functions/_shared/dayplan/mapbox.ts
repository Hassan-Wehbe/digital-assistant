// Drive times from Mapbox Directions (docs/phase6-day-planner-step2-plan.md, step 3).
//
// One request per drive: the driving-traffic profile with the planned departure (depart_at), whose
// duration is the drive with traffic, and duration_typical, the usual drive at that time. Only two
// points and a time are sent, never a title or a name (plan.ts hands this nothing else). The token
// is the Supabase secret MAPBOX_TOKEN: server only, never in the app, the repo, a log or an error.
//
// Mapbox's terms do not allow caching or storing Directions results, so nothing is kept between
// requests: a provider lives for one plan, and only repeats of the same drive within that plan are
// answered from the first answer. MAX_REQUESTS bounds what one plan can cost.
import type { DriveTimes, Leg, Point } from "./plan.ts";
import { momentOf } from "./time.ts";

export const DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/";
/** Requests one plan may make (a busy day is 6 to 10; task options add a few). */
export const MAX_REQUESTS = 40;
export const TIMEOUT_MS = 5_000;

export interface MapboxOptions {
  token: string;
  fetch?: typeof fetch;
  /** Now, for "is this departure already past?" (tests set it). */
  now?: () => number;
}

/** What one plan's provider did, for the log line (counts only). */
export interface DriveStats {
  requests: number;
  failed: number;
}

/** Coordinates as Mapbox takes them (lng,lat), 5 decimals (about a metre). */
const coord = (p: Point) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

/** A departure as Mapbox's depart_at: UTC, "2026-10-09T20:25:00Z". */
const departAt = (t: number) => new Date(t).toISOString().slice(0, 16) + ":00Z";

export function mapboxDrives(opts: MapboxOptions): DriveTimes & { stats: DriveStats } {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const stats: DriveStats = { requests: 0, failed: 0 };
  const answers = new Map<string, Promise<Leg | null>>();

  async function ask(from: Point, to: Point, depart: number | null): Promise<Response | null> {
    if (stats.requests >= MAX_REQUESTS) return null;
    stats.requests += 1;
    const params = new URLSearchParams({
      alternatives: "false", overview: "false", steps: "false", access_token: opts.token,
    });
    if (depart !== null) params.set("depart_at", departAt(depart));
    try {
      return await doFetch(`${DIRECTIONS_URL}${coord(from)};${coord(to)}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null; // never rethrown: the error could quote the address, token and all
    }
  }

  async function leg(from: Point, to: Point, departLocal: string, tz: string): Promise<Leg | null> {
    const t = momentOf(departLocal, tz);
    // A departure already past (or about now) is asked without depart_at: today's traffic now.
    const depart = t !== null && t > now() + 60_000 ? t : null;
    let res = await ask(from, to, depart);
    // A departure Mapbox will not plan for (too far ahead): the drive with traffic as of now.
    if (res?.status === 422 && depart !== null) {
      await res.body?.cancel();
      res = await ask(from, to, null);
    }
    if (!res || !res.ok) {
      await res?.body?.cancel();
      stats.failed += 1;
      return null;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      stats.failed += 1;
      return null;
    }
    const route = (data as { code?: unknown; routes?: unknown[] })?.code === "Ok"
      ? (data as { routes?: Record<string, unknown>[] }).routes?.[0]
      : undefined;
    const seconds = Number(route?.duration);
    if (!route || !Number.isFinite(seconds) || seconds < 0) {
      stats.failed += 1;
      return null;
    }
    const out: Leg = { minutes: Math.ceil(seconds / 60) };
    const typical = Number(route.duration_typical);
    if (route.duration_typical !== undefined && Number.isFinite(typical) && typical >= 0) out.typical_minutes = Math.ceil(typical / 60);
    return out;
  }

  return {
    stats,
    leg(from, to, departLocal, tz) {
      const key = `${coord(from)};${coord(to)}@${departLocal}`;
      let p = answers.get(key);
      if (!p) answers.set(key, p = leg(from, to, departLocal, tz));
      return p;
    },
  };
}
