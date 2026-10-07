// Coordinates from a Google Maps link (docs/places-plan.md step 8, Q15; design D26).
//
// A Google Maps share gives only a short link (https://maps.app.goo.gl/...) and the name. When a
// place is saved with such a link and no location, the server opens the link once and reads the
// coordinates from the Google Maps address it leads to (`!3d<lat>!4d<lng>` or `@lat,lng`). A long
// link that already carries coordinates needs no request at all. Google's current share links
// lead to a Maps page whose address has no coordinates (live log, 2026-10-07: no_coordinates
// after 2 requests, status 200), so that last page is read for them (owner's choice (a)).
//
// This is a request from our server on a link the user gave, so it is kept narrow (SSRF):
// - only the short-link hosts start a request, https only, no port, no user:password;
// - redirects are followed by hand, at most MAX_REDIRECTS, and every hop must stay on a Google
//   Maps host (GOOGLE_MAPS_HOP); anything else is refused without being requested;
// - one TIMEOUT_MS limit for the whole chain; no cookies, credentials or custom headers are sent;
// - a page is read only when the chain ends on a Google Maps hop with an HTML page (status 200):
//   at most MAX_PAGE_BYTES, within the same time limit, searched only for the place's coordinates
//   (pageCoordinates) and then dropped; every other answer is cancelled unread. Nothing but
//   lat/lng is stored;
// - nothing is logged here: callers log codes and counts only (linkLogLine), never the link or
//   the point.
// Any failure returns a code and the place stays as it was.
import { isMapsLink, type PlaceMetadata, placePoint, type Point } from "./places.ts";

export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 5000;
export const MAX_PAGE_BYTES = 1_000_000;

/** Where the coordinates were found: in a link, or by which pattern in the page. */
export type FoundIn = "link" | "page_pin" | "page_image" | "page_view" | "page_state";

/**
 * What happened, for the log: requests made, the last HTTP status (0: none), the bytes of page
 * read and where the point was found. Never the link, the page or the point.
 */
export interface LinkTrace {
  requests: number;
  status: number;
  page_bytes: number;
  found?: FoundIn;
}
export type LinkLocation = ({ point: Point } | { code: LinkFailure }) & { trace?: LinkTrace };
export type LinkFailure =
  | "not_a_short_link" // nothing to follow (and the link itself has no coordinates)
  | "off_google" // a redirect left Google Maps: not requested
  | "too_many_redirects"
  | "timeout"
  | "http_status" // an error status, or a redirect without a usable Location
  | "no_coordinates" // the chain ended on a page whose address has no coordinates
  | "network";

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** https, the default port, no user:password. */
function plainHttps(u: URL): boolean {
  return u.protocol === "https:" && !u.username && !u.password && !u.port;
}

/** A link that may start a request: maps.app.goo.gl/... or goo.gl/maps/... */
export function isShortMapsLink(url: string): boolean {
  const u = parse(url);
  if (!u || !plainHttps(u)) return false;
  const host = u.hostname.toLowerCase();
  return host === "maps.app.goo.gl" || (host === "goo.gl" && u.pathname.startsWith("/maps/"));
}

/**
 * A Google Maps address a redirect may lead to (and be requested). Strict on purpose: exact hosts
 * and, for google.com, only the /maps path. Country domains (google.co.uk, ...) are not on it:
 * they cannot be listed strictly, so a hop there is refused.
 */
export function isGoogleMapsHop(u: URL): boolean {
  if (!plainHttps(u)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "maps.app.goo.gl" || host === "maps.google.com") return true;
  if (host === "goo.gl") return u.pathname.startsWith("/maps/");
  if (host === "www.google.com" || host === "google.com") return u.pathname === "/maps" || u.pathname.startsWith("/maps/");
  return false;
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const PIN = new RegExp(String.raw`!3d${NUM}!4d${NUM}`);
const VIEW = new RegExp(String.raw`/@${NUM},${NUM}(?:[,/?#]|$)`);

/** A lat/lng pair in range, rounded like a saved place's (6 decimals, about 10 cm). */
function checked(lat: string, lng: string): Point | null {
  const p = placePoint({ lat: Number(lat), lng: Number(lng) });
  return p ? { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 } : null;
}

/**
 * The coordinates written in a Google Maps (or geo:) link, without any request: the place's pin
 * (`!3d<lat>!4d<lng>`) when there is one, else the map's centre (`/@lat,lng`). Null when the link
 * has none, or they are out of range.
 */
export function coordinatesInLink(url: string): Point | null {
  const geo = url.match(/^geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:[;?]|$)/i);
  if (geo) return checked(geo[1], geo[2]);
  if (!isMapsLink(url)) return null;
  let s = url;
  try {
    s = decodeURIComponent(url);
  } catch {
    // keep it as it is
  }
  const pin = s.match(PIN);
  if (pin) return checked(pin[1], pin[2]);
  const view = s.match(VIEW);
  return view ? checked(view[1], view[2]) : null;
}

/** A place page's coordinates, most precise first. Patterns seen in Google Maps place pages. */
const PAGE_PATTERNS: [FoundIn, RegExp, "latlng" | "lnglat"][] = [
  // The place's pin, as in a long link's data= part.
  ["page_pin", new RegExp(String.raw`!3d${NUM}!4d${NUM}`), "latlng"],
  // The preview image (og:image) is a static map centred on the place: center=lat%2Clng.
  ["page_image", new RegExp(String.raw`[?&;]center=${NUM}(?:%2C|,)${NUM}`, "i"), "latlng"],
  // A Maps address in the page with the map's centre: /@lat,lng,
  ["page_view", new RegExp(String.raw`/@${NUM},${NUM},`), "latlng"],
  // The map's starting view: APP_INITIALIZATION_STATE=[[[altitude,lng,lat]
  ["page_state", new RegExp(String.raw`APP_INITIALIZATION_STATE=\[\[\[-?[\d.e+]+,${NUM},${NUM}\]`), "lnglat"],
];

/** The place's coordinates in a Google Maps page's text, or null. Nothing else is taken from it. */
export function pageCoordinates(html: string): { point: Point; found: FoundIn } | null {
  for (const [found, re, order] of PAGE_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    const point = order === "latlng" ? checked(m[1], m[2]) : checked(m[2], m[1]);
    if (point) return { point, found };
  }
  return null;
}

/** At most MAX_PAGE_BYTES of the page as text, within the deadline; the rest is cancelled. */
async function readPage(res: Response, deadline: Promise<never>, trace: LinkTrace): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  try {
    while (trace.page_bytes < MAX_PAGE_BYTES) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      const room = MAX_PAGE_BYTES - trace.page_bytes;
      const part = value.length > room ? value.subarray(0, room) : value;
      parts.push(part);
      trace.page_bytes += part.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(trace.page_bytes);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(all);
}

/** Google's cookie-consent page (EU visitors) carries the Maps address in ?continue=; read, never requested. */
function consentTarget(u: URL): URL | null {
  if (!plainHttps(u) || u.hostname.toLowerCase() !== "consent.google.com") return null;
  const next = parse(u.searchParams.get("continue") ?? "");
  return next && isGoogleMapsHop(next) ? next : null;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * The coordinates behind a Google Maps link: read from the link itself, or by following a short
 * link (see the rules at the top of this file). `fetchFn` is for tests.
 */
export async function locationFromMapsLink(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<LinkLocation> {
  const trace: LinkTrace = { requests: 0, status: 0, page_bytes: 0 };
  const found = await follow(url, fetchFn, timeoutMs, trace);
  return { ...found, trace };
}

async function follow(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  trace: LinkTrace,
): Promise<{ point: Point } | { code: LinkFailure }> {
  const direct = coordinatesInLink(url);
  if (direct) {
    trace.found = "link";
    return { point: direct };
  }
  if (!isShortMapsLink(url)) return { code: "not_a_short_link" };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("timeout", "TimeoutError"));
    }, timeoutMs);
  });
  deadline.catch(() => {}); // raced below; this only stops an unhandled rejection between hops
  try {
    let current = new URL(url);
    for (let redirects = 0;; redirects++) {
      if (!isGoogleMapsHop(current)) return { code: "off_google" };
      trace.requests++;
      const res = await Promise.race([
        fetchFn(current.href, { method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal }),
        deadline,
      ]);
      trace.status = res.status;
      if (res.status === 200 && /^text\/html\b/i.test(res.headers.get("content-type") ?? "")) {
        // The chain ended on a Google Maps page (this hop passed isGoogleMapsHop): read it for
        // the place's coordinates only.
        const inPage = pageCoordinates(await readPage(res, deadline, trace));
        if (!inPage) return { code: "no_coordinates" };
        trace.found = inPage.found;
        return { point: inPage.point };
      }
      // Any other answer is never read.
      res.body?.cancel().catch(() => {});
      if (!REDIRECT.has(res.status)) return { code: res.ok ? "no_coordinates" : "http_status" };
      if (redirects + 1 > MAX_REDIRECTS) return { code: "too_many_redirects" };
      const location = res.headers.get("location");
      let next: URL;
      try {
        if (!location) return { code: "http_status" };
        next = new URL(location, current);
      } catch {
        return { code: "http_status" };
      }
      const consent = consentTarget(next);
      const hop = consent ?? next;
      if (!isGoogleMapsHop(hop)) return { code: "off_google" };
      const point = coordinatesInLink(hop.href);
      if (point) {
        trace.found = "link";
        return { point };
      }
      if (consent) return { code: "no_coordinates" };
      current = hop;
    }
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === "TimeoutError")) {
      return { code: "timeout" };
    }
    return { code: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A place with its location filled in from its Maps link, when it has a link and no location.
 * A location the place already has is never replaced. On any failure the place is returned as it
 * was, with the failure code (for counts; never logged with the link).
 */
export async function withLinkLocation(
  place: PlaceMetadata,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<{ place: PlaceMetadata; filled: boolean; code?: LinkFailure; log?: string }> {
  if (place.lat !== undefined || place.lng !== undefined || !place.maps_url) return { place, filled: false };
  const found = await locationFromMapsLink(place.maps_url, fetchFn);
  const log = linkLogLine(found);
  if ("code" in found) return { place, filled: false, code: found.code, log };
  return { place: { ...place, lat: found.point.lat, lng: found.point.lng }, filled: true, log };
}

/**
 * The one log line about a link lookup: the outcome code, how many requests were made, the last
 * HTTP status, the bytes of page read and where the point was found (a fixed word). Built only
 * from those, so it can never hold the link, the page or the point.
 */
export function linkLogLine(found: LinkLocation): string {
  const code = "code" in found ? found.code : "ok";
  const { requests, status, page_bytes, found: where } = found.trace ?? { requests: 0, status: 0, page_bytes: 0 };
  return JSON.stringify({ event: "maps_link", code, requests, status, page_bytes, found: where ?? null });
}
