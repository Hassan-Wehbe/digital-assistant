// Job 4 (docs/places-plan.md, "Locations for shared places"): a place shared from Google Maps
// comes with a name (sometimes an address) and a short link, never coordinates. The phone's own
// map lookup (on most Android phones, Google's) is asked for "name, address"; the share screen
// then asks "Is this it?" and only a Yes puts the point into the place.
//
// Only the place's name and address are sent, never where the phone is: these deps have no way
// to read the position. To show what the match is ("Found at: Lockwood Blvd, Oviedo, FL, United
// States"), the spot found is then looked up the other way (its street and town); that spot is
// the place's, never the phone's. A name alone can match another place in another town (owner,
// versionCode 13: a café in Oviedo FL matched one in Orlando, a pizza place one in Oviedo,
// Spain), so the card says where. Android lets an app use its map lookup only once the location
// permission is given, so the lookup runs by itself only when it already is; otherwise the person taps
// "Find it on the map", which asks for it (as "Use where I am now" does).
//
// The phone calls come in as `deps` (lib/location.ts, deviceGeocoder), so this is tested
// without a phone.

export interface GeocodeDeps {
  permission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  askPermission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  geocode: (query: string) => Promise<{ latitude: number; longitude: number }[]>;
  /** The street and town at a spot found by `geocode` (never the phone's position). */
  describe: (point: { latitude: number; longitude: number }) => Promise<SpotAddress[]>;
}

/** The parts of the phone's street-and-town answer that the card shows. */
export interface SpotAddress {
  streetNumber?: string | null;
  street?: string | null;
  city?: string | null;
  district?: string | null;
  region?: string | null;
  country?: string | null;
}

export type LookupResult =
  /** `where`: the spot's street and town, null when the lookup did not say. */
  | { found: { lat: number; lng: number }; where: string | null }
  | { none: true }
  /** The location permission is not given (`canAsk`: a tap can still ask for it). */
  | { permission: { canAsk: boolean } };

export const LOOKUP_TIMEOUT_MS = 10_000;
/** The street-and-town lookup is extra: the card shows without it after this long. */
export const DESCRIBE_TIMEOUT_MS = 5_000;
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

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** "1155 Lockwood Blvd, Oviedo, FL, United States" (whatever parts the lookup gave; null with none). */
export function spotText(a: SpotAddress | undefined): string | null {
  if (!a || typeof a !== 'object') return null;
  const street = [text(a.streetNumber), text(a.street)].filter(Boolean).join(' ');
  const town = text(a.city) || text(a.district);
  const parts = [street, town, text(a.region), text(a.country)].filter(Boolean);
  return parts.length ? parts.join(', ').slice(0, 200) : null;
}

/** `work`, or null after `ms` (the timer is always cleared). */
async function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** The street and town at the spot found, or null on a failure, a time-out or an empty answer. */
async function describeSpot(deps: GeocodeDeps, point: { latitude: number; longitude: number }, ms: number): Promise<string | null> {
  try {
    const out = await within(deps.describe(point), ms);
    return Array.isArray(out) ? spotText(out[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Ask the phone's map lookup where `query` is. `ask`: the person tapped, so the permission may be
 * asked for; otherwise it is only checked. A failure, a time-out or an odd answer is "none".
 */
export async function lookUpPlace(deps: GeocodeDeps, query: string, ask: boolean, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<LookupResult> {
  try {
    let p = await deps.permission();
    if (!p.granted && ask && p.canAskAgain) p = await deps.askPermission();
    if (!p.granted) return { permission: { canAsk: p.canAskAgain } };
    const results = await within(deps.geocode(query), timeoutMs);
    const first = Array.isArray(results) ? results[0] : undefined;
    if (!first || !onTheMap(first.latitude, first.longitude)) return { none: true };
    const found = { lat: round(first.latitude), lng: round(first.longitude) };
    const where = await describeSpot(deps, { latitude: found.lat, longitude: found.lng }, Math.min(timeoutMs, DESCRIBE_TIMEOUT_MS));
    return { found, where };
  } catch {
    return { none: true };
  }
}
