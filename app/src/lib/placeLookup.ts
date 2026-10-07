// Job 4 (docs/places-plan.md, "Locations for shared places"): a place shared from Google Maps
// comes with a name (sometimes an address) and a short link, never coordinates. The phone's own
// map lookup (on most Android phones, Google's) is asked for "name, address"; the share screen
// then asks "Is this it?" and only a Yes puts the point into the place.
//
// Only the place's name and address are sent, never where the phone is: these deps have no way
// to read the position. Android lets an app use its map lookup only once the location permission
// is given, so the lookup runs by itself only when it already is; otherwise the person taps
// "Find it on the map", which asks for it (as "Use where I am now" does).
//
// The phone calls come in as `deps` (lib/location.ts, deviceGeocoder), so this is tested
// without a phone.

export interface GeocodeDeps {
  permission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  askPermission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  geocode: (query: string) => Promise<{ latitude: number; longitude: number }[]>;
}

export type LookupResult =
  | { found: { lat: number; lng: number } }
  | { none: true }
  /** The location permission is not given (`canAsk`: a tap can still ask for it). */
  | { permission: { canAsk: boolean } };

export const LOOKUP_TIMEOUT_MS = 10_000;
const MAX_QUERY = 400;

/** "Hinode Sushi, 123 Main St, Oviedo" (the name alone without an address; null with neither). */
export function lookupQuery(name: string, address: string): string | null {
  const n = name.trim();
  const a = address.trim();
  // Some apps share "Name, address": no need to say the name twice.
  const q = !a ? n : !n || a.toLowerCase().startsWith(n.toLowerCase()) ? a : `${n}, ${a}`;
  return q ? q.slice(0, MAX_QUERY) : null;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const onTheMap = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Ask the phone's map lookup where `query` is. `ask`: the person tapped, so the permission may be
 * asked for; otherwise it is only checked. A failure, a time-out or an odd answer is "none".
 */
export async function lookUpPlace(deps: GeocodeDeps, query: string, ask: boolean, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<LookupResult> {
  try {
    let p = await deps.permission();
    if (!p.granted && ask && p.canAskAgain) p = await deps.askPermission();
    if (!p.granted) return { permission: { canAsk: p.canAskAgain } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((done) => {
      timer = setTimeout(() => done(null), timeoutMs);
    });
    const results = await Promise.race([deps.geocode(query), late]).finally(() => clearTimeout(timer));
    const first = Array.isArray(results) ? results[0] : undefined;
    if (!first || !onTheMap(first.latitude, first.longitude)) return { none: true };
    return {
      found: { lat: round(first.latitude), lng: round(first.longitude) },
    };
  } catch {
    return { none: true };
  }
}
