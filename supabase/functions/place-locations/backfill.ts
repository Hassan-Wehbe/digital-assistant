// One-off pass (docs/places-plan.md step 8, Q15): places saved before the server read locations
// from Google Maps links get theirs now. The same rules as save_item (mcp/lib/maps_link.ts): a long
// link with coordinates is read without a request, a short link is opened once; a location a place
// already has is never touched; a failure leaves the place as it was.
//
// A dry run (the default) makes no request and writes nothing: it only counts. Counts are all this
// returns or logs: never a link, a title, a point or an id.
import { coordinatesInLink, isShortMapsLink, type LinkFailure, locationFromMapsLink } from "../mcp/lib/maps_link.ts";
import { placePoint, type Point } from "../mcp/lib/places.ts";

/** At most this many links are opened per run (5 s each at worst); run again for the rest. */
export const MAX_PER_RUN = 20;

export interface PlaceRow {
  id: string;
  space_id: string;
  owner_user_id: string;
  updated_at: string; // the write happens only if the place was not edited meanwhile
  metadata: Record<string, unknown> | null;
}

export interface BackfillStore {
  /** Every live place (item_type "place", not deleted), with its owner. */
  listPlaces(): Promise<PlaceRow[]>;
  /**
   * Writes the row's own metadata plus the point, only if that row (same id, same space, so the
   * same owner) is not deleted, was not edited since it was read, and still has no location.
   * Returns whether a row was written.
   */
  saveLocation(row: PlaceRow, metadata: Record<string, unknown>): Promise<boolean>;
}

export interface BackfillCounts {
  dry_run: boolean;
  users: number;
  places: number;
  already_located: number;
  without_link: number;
  link_has_coordinates: number; // read from the link itself, no request
  short_links: number; // need one request each
  other_links: number; // a long link without coordinates: nothing to read
  filled: number;
  not_written: number; // the place changed meanwhile (edited, got a location, or was deleted)
  failed: Partial<Record<LinkFailure, number>>;
  left_for_next_run: number;
}

export async function backfillPlaceLocations(
  store: BackfillStore,
  { apply = false, fetchFn = globalThis.fetch }: { apply?: boolean; fetchFn?: typeof fetch } = {},
): Promise<BackfillCounts> {
  const rows = await store.listPlaces();
  const counts: BackfillCounts = {
    dry_run: !apply, users: new Set(rows.map((r) => r.owner_user_id)).size, places: rows.length,
    already_located: 0, without_link: 0, link_has_coordinates: 0, short_links: 0, other_links: 0,
    filled: 0, not_written: 0, failed: {}, left_for_next_run: 0,
  };

  const todo: { row: PlaceRow; link: string }[] = [];
  for (const row of rows) {
    const m = row.metadata ?? {};
    const link = typeof m.maps_url === "string" ? m.maps_url : "";
    if (placePoint(m) || m.lat !== undefined || m.lng !== undefined) counts.already_located++;
    else if (!link) counts.without_link++;
    else if (coordinatesInLink(link)) {
      counts.link_has_coordinates++;
      todo.push({ row, link });
    } else if (isShortMapsLink(link)) {
      counts.short_links++;
      todo.push({ row, link });
    } else counts.other_links++;
  }
  if (!apply) return counts;

  let opened = 0;
  for (const { row, link } of todo) {
    const needsRequest = !coordinatesInLink(link);
    if (needsRequest && opened >= MAX_PER_RUN) {
      counts.left_for_next_run++;
      continue;
    }
    if (needsRequest) opened++;
    const found = await locationFromMapsLink(link, fetchFn);
    if ("code" in found) {
      counts.failed[found.code] = (counts.failed[found.code] ?? 0) + 1;
      continue;
    }
    const point: Point = found.point;
    const written = await store.saveLocation(row, { ...(row.metadata ?? {}), lat: point.lat, lng: point.lng });
    if (written) counts.filled++;
    else counts.not_written++;
  }
  return counts;
}
