import { z } from "zod";
import { loadSpaces, resolveSpace, type Space } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { distanceKm, normalizePlace, PlaceError, PLACE_TYPE, placePoint, type Point } from "../lib/places.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

/** At most this many places are read per call; plenty for one person's saved places. */
export const MAX_PLACES_SCANNED = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PlaceRow {
  id: string;
  title: string;
  space_id: string;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

/** The space and every space below it. */
function subtree(spaces: Space[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of spaces) {
      if (s.parent_id && out.has(s.parent_id) && !out.has(s.id)) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

/** A saved place by id or by name (exact, else the only one whose name contains the words). */
function findAnchor(rows: PlaceRow[], ref: string): PlaceRow {
  const r = ref.trim();
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const byId = UUID.test(r) ? rows.find((p) => p.id === r) : undefined;
  if (byId) return byId;
  const exact = rows.filter((p) => norm(p.title) === norm(r));
  const hits = exact.length ? exact : rows.filter((p) => norm(p.title).includes(norm(r)));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new Error(`"${ref}" matches several saved places: ${hits.slice(0, 10).map((p) => p.title).join(", ")}. Ask which one.`);
  }
  throw new Error(`No saved place called "${ref}". Search for it with search_items, or ask the user where they are.`);
}

/**
 * "Places near here": saved places sorted by straight-line distance from a point, computed here
 * from the coordinates stored by Save where I am (docs/places-plan.md step 5, design D26). No
 * map service is called. Only the user's own places in searchable spaces are read: restricted
 * spaces (and spaces under them) are never included, not even as the starting point (rule 3).
 */
export const registerFindPlaces: RegisterTool = (server, { db, assistantName }) => {
  server.registerTool(
    "find_places",
    {
      title: "Find places near a point",
      description:
        "Saved places (item_type \"place\") nearest to a point, with the straight-line distance in km " +
        "(not a travel time). The point is either lat and lng the user gave (a location they shared, or " +
        "a geo: or Google Maps link that contains coordinates) or near_place, a saved place that has a " +
        "location. Never guess coordinates from an address, a street or a city name. Places without a " +
        "saved location get no distance; they are listed by address only with include_without_location. " +
        "Results carry each place's fields (status, rating, cuisine, occasions, visits...). " +
        "Restricted spaces are never searched." +
        addressedAs(assistantName, "which restaurants are near Tawlet?"),
      inputSchema: {
        lat: z.number().min(-90).max(90).optional().describe("Latitude of the point, with lng"),
        lng: z.number().min(-180).max(180).optional().describe("Longitude of the point, with lat"),
        near_place: z.string().max(200).optional()
          .describe("Instead of lat/lng: a saved place (name or id) to measure from"),
        within_km: z.number().positive().max(20000).optional().describe("Only places at most this far"),
        space: z.string().optional().describe("Only this space and its sub-spaces (name, path or id)"),
        kind: z.string().optional().describe("restaurant, cafe, bar, shop, to-visit, hotel or other"),
        status: z.enum(["want", "been"]).optional().describe('"want" (not been yet) or "been"'),
        cuisine: z.string().max(40).optional().describe("e.g. italian"),
        occasion: z.string().max(40).optional()
          .describe("date_night, kids, business, quick_lunch, group or special"),
        include_without_location: z.boolean().optional()
          .describe("Also list matching places that have no saved location, by address, without a distance"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        const { lat, lng, near_place, within_km, space, kind, status, cuisine, occasion } = args;
        const limit = args.limit ?? 10;
        if ((lat === undefined) !== (lng === undefined)) throw new Error("lat and lng go together.");
        const hasPoint = lat !== undefined && lng !== undefined;
        if (hasPoint === !!near_place?.trim()) {
          throw new Error(
            "Give one starting point: lat and lng (a location the user shared) or near_place (a saved place " +
              "with a location). Never guess coordinates from an address or a city name; if you do not have " +
              "a point, ask the user which saved place they are near or to share their location.",
          );
        }
        // Filters, written the way places are stored ("Date night" -> date_night, "Café" -> cafe).
        let wanted;
        try {
          wanted = normalizePlace({
            kind: kind || undefined,
            occasions: occasion ? [occasion] : undefined,
            cuisine: cuisine ? [cuisine] : undefined,
          });
        } catch (e) {
          if (e instanceof PlaceError) throw new Error(e.message.replace(/^Place not saved: /, "Filter not understood: "));
          throw e;
        }

        const spaces = await loadSpaces(db);
        const scope = space ? subtree(spaces, resolveSpace(spaces, space).id) : null;
        // The same rule as search_items: only the user's own spaces that are not restricted and
        // not under a restricted space (searchable_space_ids, migration knowledge_path).
        const { data: ids, error: idsError } = await db.rpc("searchable_space_ids");
        if (idsError) throw dbError("Finding places failed", idsError);
        const searchable = new Set(
          ((ids ?? []) as unknown[]).map((v) =>
            typeof v === "string" ? v : String((v as Record<string, unknown>)?.searchable_space_ids)
          ),
        );
        const own = new Set(spaces.map((s) => s.id));
        const allowed = [...searchable].filter((id) => own.has(id));

        let rows: PlaceRow[] = [];
        if (allowed.length) {
          const { data, error } = await db
            .from("item")
            .select("id, title, space_id, metadata, updated_at")
            .eq("item_type", PLACE_TYPE)
            .is("deleted_at", null)
            .in("space_id", allowed)
            .order("updated_at", { ascending: false })
            .limit(MAX_PLACES_SCANNED);
          if (error) throw dbError("Finding places failed", error);
          // Checked again here, whatever the database returned: a row from a restricted space or
          // from someone else's space (an item shared with the user) is never used.
          const allowedSet = new Set(allowed);
          rows = ((data ?? []) as PlaceRow[]).filter((r) => allowedSet.has(r.space_id));
        }

        let from: Record<string, unknown>;
        let origin: Point;
        let anchorId: string | null = null;
        if (hasPoint) {
          origin = { lat: lat!, lng: lng! };
          from = { lat, lng };
        } else {
          const anchor = findAnchor(rows, near_place!);
          const p = placePoint(anchor.metadata);
          if (!p) {
            const address = typeof anchor.metadata?.address === "string" ? anchor.metadata.address : null;
            throw new Error(
              `"${anchor.title}" has no saved location, so distances cannot be measured from it` +
                (address ? ` (its address is "${address}")` : "") +
                ". Do not guess one; Save where I am in the app adds a location.",
            );
          }
          origin = p;
          anchorId = anchor.id;
          from = { place: anchor.title, id: anchor.id };
        }

        const pathOf = new Map(spaces.map((s) => [s.id, s.path]));
        const matching = rows.filter((r) => {
          if (r.id === anchorId) return false;
          if (scope && !scope.has(r.space_id)) return false;
          const m = r.metadata ?? {};
          const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);
          if (wanted.kind && m.kind !== wanted.kind) return false;
          if (status && (m.status ?? "want") !== status) return false;
          if (wanted.cuisine && !list(m.cuisine).includes(wanted.cuisine[0])) return false;
          if (wanted.occasions && !list(m.occasions).includes(wanted.occasions[0])) return false;
          return true;
        });

        const located: { row: PlaceRow; km: number }[] = [];
        const unlocated: PlaceRow[] = [];
        for (const row of matching) {
          const p = placePoint(row.metadata);
          if (!p) unlocated.push(row);
          else {
            const km = distanceKm(origin, p);
            if (within_km === undefined || km <= within_km) located.push({ row, km });
          }
        }
        located.sort((a, b) => a.km - b.km);

        const out: Record<string, unknown> = {
          from,
          results: located.slice(0, limit).map(({ row, km }) => ({
            id: row.id,
            title: row.title,
            space: pathOf.get(row.space_id),
            distance_km: Math.round(km * 10) / 10,
            place: row.metadata,
          })),
        };
        if (args.include_without_location) {
          // No distance for these, ever: they have no saved position.
          out.without_location = unlocated.slice(0, limit).map((row) => ({
            id: row.id,
            title: row.title,
            space: pathOf.get(row.space_id),
            address: typeof row.metadata?.address === "string" ? row.metadata.address : null,
            place: row.metadata,
          }));
        } else if (unlocated.length) {
          out.without_location_count = unlocated.length;
        }
        if (rows.length >= MAX_PLACES_SCANNED) out.note = `Only the ${MAX_PLACES_SCANNED} most recently changed places were checked.`;
        return ok(out);
      }),
  );
};
