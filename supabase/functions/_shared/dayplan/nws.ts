// Weather from the US National Weather Service (api.weather.gov; free, no key, US only), for the day
// planner (docs/phase6-day-planner-step2-plan.md, step 3, Q2): the hourly chance of rain at each
// place the user drives to, and the weather alerts in force there (storms, heat, flood).
//
// Per place: /points/{lat},{lng} (coordinates rounded to 4 decimals, as NWS asks) gives that
// place's hourly forecast address; then the hourly forecast and /alerts/active?point=... A place
// outside the US gets a 404 from /points: "outside_us". NWS asks every caller for a User-Agent
// naming the app and a contact (the Supabase secret NWS_CONTACT). Only the rounded point is sent.
// Nothing is kept between requests; MAX_POINTS bounds the requests one plan can make.
import type { Point } from "./plan.ts";
import { localTime } from "./time.ts";

export const NWS_URL = "https://api.weather.gov";
/** Places one plan may look up (3 requests each). */
export const MAX_POINTS = 6;
export const TIMEOUT_MS = 6_000;
/** Alerts kept per place. */
export const MAX_ALERTS = 5;

export interface HourRain {
  /** The hour's start, local time in the plan's time zone. */
  at: string;
  rain_pct: number;
}

export interface WeatherAlert {
  id: string;
  /** NWS's alert name: "Flood Watch", "Heat Advisory", "Severe Thunderstorm Warning". */
  event: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  /** Local times in the plan's time zone, when NWS gives them. */
  starts?: string;
  ends?: string;
}

export interface PlaceWeather {
  hourly: HourRain[];
  alerts: WeatherAlert[];
}

export interface Weather {
  /** The weather at a point on `date` (local, in tz); "outside_us" when NWS has no forecast there;
   * null when it could not be read. */
  at(point: Point, date: string, tz: string): Promise<PlaceWeather | "outside_us" | null>;
}

export interface WeatherStats {
  requests: number;
  failed: number;
}

export interface NwsOptions {
  /** How NWS can reach whoever runs the app (an email address or a web page): NWS_CONTACT. */
  contact: string;
  fetch?: typeof fetch;
}

/** NWS names its alerts from a fixed list: only plain names like these are passed on. */
const ALERT_NAME = /^[A-Za-z][A-Za-z ,'/()-]{1,79}$/;
const SEVERITIES = new Set(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]);

export function nwsWeather(opts: NwsOptions): Weather & { stats: WeatherStats } {
  const doFetch = opts.fetch ?? fetch;
  const stats: WeatherStats = { requests: 0, failed: 0 };
  const answers = new Map<string, Promise<PlaceWeather | "outside_us" | null>>();
  const headers = { "User-Agent": `Wilma digital assistant (${opts.contact})`, Accept: "application/geo+json" };

  async function get(url: string): Promise<{ status: number; data?: unknown }> {
    stats.requests += 1;
    try {
      const res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        await res.body?.cancel();
        return { status: res.status };
      }
      return { status: res.status, data: await res.json() };
    } catch {
      return { status: 0 };
    }
  }

  async function at(lat: string, lng: string, date: string, tz: string): Promise<PlaceWeather | "outside_us" | null> {
    const point = await get(`${NWS_URL}/points/${lat},${lng}`);
    if (point.status === 404) return "outside_us";
    const hourlyUrl = (point.data as { properties?: { forecastHourly?: unknown } })?.properties?.forecastHourly;
    // Only ever NWS's own address, whatever the answer says.
    if (typeof hourlyUrl !== "string" || !hourlyUrl.startsWith(`${NWS_URL}/`)) {
      stats.failed += 1;
      return null;
    }
    const [hourly, alerts] = await Promise.all([get(hourlyUrl), get(`${NWS_URL}/alerts/active?point=${lat},${lng}`)]);
    if (!hourly.data) {
      stats.failed += 1;
      return null;
    }
    const periods = (hourly.data as { properties?: { periods?: unknown } })?.properties?.periods;
    const rain: HourRain[] = [];
    for (const p of Array.isArray(periods) ? periods : []) {
      const start = typeof p?.startTime === "string" ? localTime(p.startTime, tz) : undefined;
      const pct = Number(p?.probabilityOfPrecipitation?.value ?? 0);
      if (!start || !start.startsWith(date) || !Number.isFinite(pct)) continue;
      rain.push({ at: start, rain_pct: Math.max(0, Math.min(100, Math.round(pct))) });
    }
    const found: WeatherAlert[] = [];
    const features = (alerts.data as { features?: unknown })?.features;
    if (!alerts.data) stats.failed += 1; // the forecast still shows; the alerts are just missing
    for (const f of Array.isArray(features) ? features : []) {
      const p = f?.properties ?? {};
      if (typeof p.id !== "string" || typeof p.event !== "string" || !ALERT_NAME.test(p.event)) continue;
      const ends = p.ends ?? p.expires;
      found.push({
        id: p.id.slice(0, 200),
        event: p.event,
        severity: SEVERITIES.has(p.severity) ? p.severity : "Unknown",
        ...(typeof (p.onset ?? p.effective) === "string" ? { starts: localTime(p.onset ?? p.effective, tz) } : {}),
        ...(typeof ends === "string" ? { ends: localTime(ends, tz) } : {}),
      });
      if (found.length >= MAX_ALERTS) break;
    }
    return { hourly: rain, alerts: found };
  }

  return {
    stats,
    at(p, date, tz) {
      // Rounded to 4 decimals (about 10 m), as NWS asks: also what is sent.
      const lat = String(Number(p.lat.toFixed(4)));
      const lng = String(Number(p.lng.toFixed(4)));
      const key = `${lat},${lng}@${date}`;
      let answer = answers.get(key);
      if (!answer) {
        if (answers.size >= MAX_POINTS) return Promise.resolve(null);
        answers.set(key, answer = at(lat, lng, date, tz));
      }
      return answer;
    },
  };
}
