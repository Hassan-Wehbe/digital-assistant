// Coordinates from a Google Maps link (docs/places-plan.md step 8, Q15; design D26).
//
// A long Google Maps link (or a geo: link) often carries the place's coordinates: the pin
// (`!3d<lat>!4d<lng>`) or the map's centre (`/@lat,lng`). When a place is saved with such a link
// and no location, they become its lat/lng. Nothing is requested: the link is only read.
//
// Short share links (maps.app.goo.gl/...) are not followed. Following them was tried live on
// 2026-10-07: the address they lead to has no coordinates, and the page Google sends a server
// does not hold the place's pin (its preview image was centred about 800 miles away), so the
// result would be wrong. Owner's decision, 2026-10-07: option (b), no link following; a shared
// place gets its location from "Use where I am now" or a long link with coordinates.
import { isMapsLink, type PlaceMetadata, placePoint, type Point } from "./places.ts";

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

/**
 * A place with its location filled in from its Maps link, when it has no location and the link
 * itself carries coordinates. A location the place already has is never replaced.
 */
export function withLinkLocation(place: PlaceMetadata): { place: PlaceMetadata; filled: boolean } {
  if (place.lat !== undefined || place.lng !== undefined || !place.maps_url) return { place, filled: false };
  const point = coordinatesInLink(place.maps_url);
  if (!point) return { place, filled: false };
  return { place: { ...place, lat: point.lat, lng: point.lng }, filled: true };
}
