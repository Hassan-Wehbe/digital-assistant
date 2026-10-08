import { z } from "zod";
import { resolveSpace, type Space } from "../lib/spaces.ts";
import { addressedAs, DEFAULT_DISTANCE_UNIT, type DistanceUnit } from "../lib/assistant.ts";
import {
  distanceKm, inUnit as toUnit, KM_PER_MILE, normalizePlace, PlaceError, PLACE_TYPE, placePoint, placeScope, type Point,
} from "../lib/places.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

/** At most this many places are read per call; plenty for one person's saved places. */
export const MAX_PLACES_SCANNED = 1000;
export { KM_PER_MILE };
/** "Near" without a distance: 10 miles (about 16 km; places step 8, Q12), for km users too. */
export const NEARBY_KM = 10 * KM_PER_MILE;
/** Places without a saved location listed with every answer, by name and address only. */
export const MAX_WITHOUT_LOCATION = 10;

/** One log line per call: which filters were set and how many places came out, never names or points. */
export interface FindPlacesLog {
  event: "find_places";
  from: "point" | "place";
  within: number;
  unit: DistanceUnit;
  filters: string[];
  scanned: number;
  matching: number;
  results: number;
  other_nearby: number;
  nearest_outside: boolean;
  without_location: number;
  /** Set when the call was refused before any place was read: "filter_not_understood". */
  error?: string;
}

const defaultLog = (entry: FindPlacesLog) => console.log(JSON.stringify(entry));

/** "Restaurants" -> "restaurant", "cafés" -> "café": the kind as one word, the way it is stored. */
const singular = (k: string) => k.trim().replace(/(?<=[a-zé])s$/i, "");

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
export const registerFindPlaces: RegisterTool = (server, { db, assistantName, distanceUnit, log = defaultLog }) => {
  const unit: DistanceUnit = distanceUnit ?? DEFAULT_DISTANCE_UNIT;
  const unitName = unit === "mi" ? "miles" : "km";
  const inUnit = (km: number) => toUnit(km, unit);
  const say = (km: number) => {
    const d = inUnit(km);
    const name = unit === "mi" ? (d === 1 ? "mile" : "miles") : "km";
    return d === 0 ? `less than 0.1 ${unit === "mi" ? "miles" : "km"}` : `${d} ${name}`;
  };
  server.registerTool(
    "find_places",
    {
      title: "Find places near a point",
      description:
        `Saved places (item_type "place") nearest to a point, with the straight-line distance in ${unitName}, ` +
        "the user's unit (not a travel time). The point is either lat and lng the user gave (a location they " +
        "shared, or a geo: or Google Maps link that contains coordinates) or near_place, a saved place that " +
        "has a location. Never guess coordinates from an address, a street or a city name. Without within, " +
        `only places within ${unit === "mi" ? "10 miles" : "16 km"} count ("near", "nearby"); when none is, ` +
        "nearest_outside is the closest one further away. Matching places without a saved location are " +
        "always listed in without_location (name and address, never a distance). When the filters (kind, " +
        "status, cuisine, occasion) leave nothing nearby, other_nearby lists the nearby places they ruled out, " +
        "each with why (not_matching). summary says the answer in one plain sentence: start from it. " +
        "Results carry each place's fields (status, rating, cuisine, occasions, visits...). " +
        "Restricted spaces are never searched." +
        addressedAs(assistantName, "which restaurants are near Tawlet?"),
      inputSchema: {
        lat: z.number().min(-90).max(90).optional().describe("Latitude of the point, with lng"),
        lng: z.number().min(-180).max(180).optional().describe("Longitude of the point, with lat"),
        near_place: z.string().max(200).optional()
          .describe("Instead of lat/lng: a saved place (name or id) to measure from"),
        within: z.number().positive().max(20000).optional()
          .describe(`Only places at most this far, in unit (default ${unitName}); default ${unit === "mi" ? "10 miles" : "16 km"}`),
        unit: z.enum(["mi", "km"]).optional().describe(`The unit of within, when the user named one; default ${unit}`),
        within_km: z.number().positive().max(20000).optional().describe("Older form of within, in km"),
        space: z.string().optional().describe("Only this space and its sub-spaces (name, path or id)"),
        kind: z.string().optional().describe("restaurant, cafe, bar, shop, to-visit, hotel, home or other"),
        status: z.enum(["want", "been"]).optional().describe('"want" (not been yet) or "been"'),
        cuisine: z.string().max(40).optional().describe("e.g. italian"),
        occasion: z.string().max(40).optional()
          .describe("date_night, kids, business, quick_lunch, group or special"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        const { lat, lng, near_place, within, within_km, space, kind, status, cuisine, occasion } = args;
        const radiusKm = within !== undefined
          ? ((args.unit ?? unit) === "mi" ? within * KM_PER_MILE : within)
          : within_km ?? NEARBY_KM;
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
        // The log line's parts: filter names and counts only, never their values, a name or a point.
        const filtersSet = [
          kind && "kind", status && "status", cuisine && "cuisine", occasion && "occasion", space && "space",
          (within !== undefined || within_km !== undefined) && "within",
        ].filter(Boolean) as string[];
        const counts = {
          event: "find_places" as const, from: hasPoint ? "point" as const : "place" as const,
          within: inUnit(radiusKm), unit, matching: 0, results: 0, other_nearby: 0, nearest_outside: false,
          without_location: 0,
        };
        // Filters, written the way places are stored ("Date night" -> date_night, "Café" -> cafe).
        let wanted;
        try {
          wanted = normalizePlace({
            kind: kind ? singular(kind) : undefined,
            occasions: occasion ? [occasion] : undefined,
            cuisine: cuisine ? [cuisine] : undefined,
          });
        } catch (e) {
          if (e instanceof PlaceError) {
            log({ ...counts, filters: filtersSet, scanned: 0, error: "filter_not_understood" });
            throw new Error(e.message.replace(/^Place not saved: /, "Filter not understood: "));
          }
          throw e;
        }

        // Only the user's own searchable spaces (rule 3): lib/places.ts placeScope, shared with the
        // chat's show_places.
        const { spaces, allowed } = await placeScope(db);
        const scope = space ? subtree(spaces, resolveSpace(spaces, space).id) : null;

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
        // Home is where distances may be measured from ("restaurants near home"), never a place to suggest.
        if (kind === undefined || singular(kind) !== "home") rows = rows.filter((r) => r.metadata?.kind !== "home");

        const pathOf = new Map(spaces.map((s) => [s.id, s.path]));
        const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);
        /** The filters a place does not meet, as the user would read them ("cuisine sushi"). */
        const misses = (m: Record<string, unknown>): string[] => {
          const out: string[] = [];
          if (wanted.kind && m.kind !== wanted.kind) out.push(`kind ${wanted.kind}`);
          if (status && (m.status ?? "want") !== status) out.push(`status ${status}`);
          if (wanted.cuisine && !list(m.cuisine).includes(wanted.cuisine[0])) out.push(`cuisine ${wanted.cuisine[0]}`);
          if (wanted.occasions && !list(m.occasions).includes(wanted.occasions[0])) out.push(`occasion ${wanted.occasions[0]}`);
          return out;
        };
        const inScope = rows.filter((r) => r.id !== anchorId && (!scope || scope.has(r.space_id)));
        const matching = inScope.filter((r) => !misses(r.metadata ?? {}).length);

        const located: { row: PlaceRow; km: number }[] = [];
        const unlocated: PlaceRow[] = [];
        for (const row of matching) {
          const p = placePoint(row.metadata);
          if (!p) unlocated.push(row);
          else located.push({ row, km: distanceKm(origin, p) });
        }
        located.sort((a, b) => a.km - b.km);
        const inside = located.filter((l) => l.km <= radiusKm);
        const measured = ({ row, km }: { row: PlaceRow; km: number }) => ({
          id: row.id,
          title: row.title,
          space: pathOf.get(row.space_id),
          distance: inUnit(km),
          unit,
          place: row.metadata,
        });

        // Forgiving filters: when they leave nothing nearby, the nearby places they ruled out still
        // come back, each with the filters it does not meet, so a word stored differently ("sushi"
        // vs "japanese") never turns into "there is nothing near you".
        const otherNearby: { row: PlaceRow; km: number; not: string[] }[] = [];
        if (!inside.length) {
          for (const row of inScope) {
            const not = misses(row.metadata ?? {});
            const p = placePoint(row.metadata);
            if (!not.length || !p) continue;
            const km = distanceKm(origin, p);
            if (km <= radiusKm) otherNearby.push({ row, km, not });
          }
          otherNearby.sort((a, b) => a.km - b.km);
        }

        const out: Record<string, unknown> = {
          summary: "",
          from,
          within: { distance: inUnit(radiusKm), unit },
          results: inside.slice(0, limit).map(measured),
        };
        if (otherNearby.length) {
          out.other_nearby = otherNearby.slice(0, limit).map((o) => ({ ...measured(o), not_matching: o.not }));
        }
        // Nothing that close: the nearest one further away, so Wilma can offer it (Q12).
        if (!inside.length && located.length) out.nearest_outside = measured(located[0]);
        // Always named, never with a distance: they have no saved position (Q16).
        out.without_location = unlocated.slice(0, MAX_WITHOUT_LOCATION).map((row) => ({
          id: row.id,
          title: row.title,
          space: pathOf.get(row.space_id),
          address: typeof row.metadata?.address === "string" ? row.metadata.address : null,
        }));
        if (unlocated.length > MAX_WITHOUT_LOCATION) out.without_location_more = unlocated.length - MAX_WITHOUT_LOCATION;
        if (rows.length >= MAX_PLACES_SCANNED) out.note = `Only the ${MAX_PLACES_SCANNED} most recently changed places were checked.`;

        // One plain sentence the model can say as it is.
        const filterWords = [
          wanted.kind && wanted.kind, status && `status ${status}`, wanted.cuisine && `cuisine ${wanted.cuisine[0]}`,
          wanted.occasions && `occasion ${wanted.occasions[0]}`,
        ].filter(Boolean) as string[];
        const what = (n: number) => `saved place${n === 1 ? "" : "s"}${filterWords.length ? ` (${filterWords.join(", ")})` : ""}`;
        const radius = say(radiusKm);
        const about = (km: number) => (inUnit(km) === 0 ? say(km) : `about ${say(km)}`);
        const parts: string[] = [];
        if (inside.length) {
          const n = inside.length;
          parts.push(`${n} ${what(n)} ${n === 1 ? "is" : "are"} within ${radius}; the nearest is ${inside[0].row.title}, ${about(inside[0].km)} away.`);
        } else {
          parts.push(`No ${what(1)} within ${radius}.`);
          if (otherNearby.length) {
            const named = otherNearby.slice(0, 5).map((o) => `${o.row.title} (${about(o.km)}, not ${o.not.join(", not ")})`);
            parts.push(`Within ${radius} but not matching every filter: ${named.join("; ")}.`);
          }
          if (located.length) parts.push(`The nearest matching one is ${located[0].row.title}, ${about(located[0].km)} away.`);
        }
        if (unlocated.length) {
          parts.push(`${unlocated.length} matching place${unlocated.length === 1 ? " has" : "s have"} no saved location, so no distance: ` +
            `${unlocated.slice(0, 5).map((r) => r.title).join(", ")}${unlocated.length > 5 ? ", ..." : ""}.`);
        }
        out.summary = parts.join(" ");

        log({
          ...counts,
          filters: filtersSet,
          scanned: rows.length,
          matching: matching.length,
          results: inside.length,
          other_nearby: otherNearby.length,
          nearest_outside: "nearest_outside" in out,
          without_location: unlocated.length,
        });
        return ok(out);
      }),
  );
};
