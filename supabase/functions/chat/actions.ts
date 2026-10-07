// Chat-only actions (docs/places-plan.md step 8, part 2 PR 2; Q11, Q13): things Wilma can do in
// the app's chat that are not MCP tools, so the Claude connector never sees them. The chat function
// and the evaluation (tests/eval/harness.ts) both use this file, so what is evaluated is what ships.
//
//   show_places({item_ids, near_place_id?})  place cards under Wilma's answer:
//       {"type":"places","cards":[{id,title,kind,cuisine,address,maps_url,lat,lng,distance?}]}
//   ask_for_location()                       the "📍 Share where I am" card:
//       {"type":"location_request"}
//
// Every id is checked as the user (lib/places.ts visiblePlaces): a place, not deleted, in one of
// their own searchable spaces. Anything else gets the same "not found", so a restricted, deleted or
// someone else's place cannot be told apart from one that does not exist (rule 3). Distances come
// from this message's shared point or from a saved place, computed here, never from the model.
// Older app versions drop these event types (app/src/lib/chatStream.ts), so Wilma's text still
// names the places and says how to share the location.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharedPoint } from "../_shared/assistant_prompt.ts";
import type { ToolSpec } from "../_shared/llm/index.ts";
import type { DistanceUnit } from "../mcp/lib/assistant.ts";
import { distanceKm, inUnit, placePoint, type Point, type VisiblePlace, visiblePlaces } from "../mcp/lib/places.ts";

/** Place cards per message, whatever the model asks for (Q13). */
export const MAX_PLACE_CARDS = 5;

export const ACTION_SPECS: ToolSpec[] = [
  {
    name: "show_places",
    description:
      "Chat app only. Shows saved places as cards under your reply (name, kind, address, distance, Open in " +
      "Maps). Use the ids of the places your answer recommends, from find_places or search_items results, " +
      `at most ${MAX_PLACE_CARDS}, in the order you name them. Changes nothing.`,
    inputSchema: {
      type: "object",
      properties: {
        item_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_PLACE_CARDS,
          description: "Ids of saved places (item_type place)",
        },
        near_place_id: {
          type: "string",
          description: "When the user asked near a saved place: its id, to measure the distances from it",
        },
      },
      required: ["item_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_for_location",
    description:
      "Chat app only. Shows the user a 📍 Share where I am card, for \"near me\" questions when they have not " +
      "shared their location with this message. Changes nothing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const ACTION_NAMES = new Set(ACTION_SPECS.map((s) => s.name));

export interface PlaceCard {
  id: string;
  title: string;
  kind: string | null;
  cuisine: string[];
  address: string | null;
  maps_url: string | null;
  lat: number | null;
  lng: number | null;
  distance?: { value: number; unit: DistanceUnit };
}

export interface ActionOutput {
  isError: boolean;
  /** What goes back to the model. */
  text: string;
  /** What goes to the app, in order. */
  events: Record<string, unknown>[];
}

export interface ActionContext {
  db: SupabaseClient;
  distanceUnit: DistanceUnit;
  /** The location shared with this message, if any (never stored or logged). */
  here?: SharedPoint;
}

const NOT_FOUND = "not found";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function card(p: VisiblePlace, from: Point | null, unit: DistanceUnit): PlaceCard {
  const m = p.metadata ?? {};
  const at = placePoint(m);
  return {
    id: p.id,
    title: p.title,
    kind: str(m.kind),
    cuisine: Array.isArray(m.cuisine) ? m.cuisine.filter((c): c is string => typeof c === "string") : [],
    address: str(m.address),
    maps_url: str(m.maps_url),
    lat: at?.lat ?? null,
    lng: at?.lng ?? null,
    ...(from && at ? { distance: { value: inUnit(distanceKm(from, at), unit), unit } } : {}),
  };
}

/**
 * The actions for one message: it remembers the cards already shown and whether the location was
 * already asked for, so neither repeats within the message.
 */
export class ChatActions {
  private shown = new Set<string>();
  private asked = false;

  constructor(private ctx: ActionContext) {}

  async run(name: string, input: Record<string, unknown>): Promise<ActionOutput> {
    try {
      if (name === "show_places") return await this.showPlaces(input);
      if (name === "ask_for_location") return this.askForLocation();
      return { isError: true, text: `${name} is not a chat action.`, events: [] };
    } catch {
      // A database failure: a code-free sentence, never an id or a point.
      return { isError: true, text: "The places could not be read just now.", events: [] };
    }
  }

  private async showPlaces(input: Record<string, unknown>): Promise<ActionOutput> {
    const raw = input.item_ids;
    if (!Array.isArray(raw) || !raw.length || raw.some((v) => typeof v !== "string")) {
      return { isError: true, text: "item_ids must be a list of place ids.", events: [] };
    }
    const near = input.near_place_id;
    if (near !== undefined && typeof near !== "string") {
      return { isError: true, text: "near_place_id must be a place id.", events: [] };
    }
    const ids = [...new Set(raw as string[])];
    const places = await visiblePlaces(this.ctx.db, near ? [...ids, near] : ids);

    let from: Point | null = null;
    let fromNote: string | null = null;
    if (near) {
      const anchor = places.get(near);
      if (!anchor) return { isError: true, text: `near_place_id: ${NOT_FOUND}.`, events: [] };
      from = placePoint(anchor.metadata);
      if (!from) fromNote = `"${anchor.title}" has no saved location, so the cards show no distance.`;
    } else if (this.ctx.here) {
      from = this.ctx.here;
    }

    const cards: PlaceCard[] = [];
    const notFound: string[] = [];
    let skipped = 0;
    for (const id of ids) {
      const p = places.get(id);
      if (!p) {
        notFound.push(id);
        continue;
      }
      if (this.shown.has(id)) continue;
      if (this.shown.size >= MAX_PLACE_CARDS) {
        skipped += 1;
        continue;
      }
      this.shown.add(id);
      cards.push(card(p, from, this.ctx.distanceUnit));
    }

    const result: Record<string, unknown> = {
      shown: cards.map((c) => c.title),
    };
    if (notFound.length) result.not_found = notFound;
    if (skipped) result.note = `At most ${MAX_PLACE_CARDS} cards per answer; ${skipped} not shown.`;
    if (fromNote) result.distance_note = fromNote;
    if (cards.length) {
      result.message = "The app shows these as cards under your reply. Still name each place in your reply: " +
        "older versions of the app show no cards.";
    }
    const isError = !cards.length && notFound.length > 0;
    return {
      isError,
      text: isError ? `Places ${NOT_FOUND}: ${notFound.join(", ")}.` : JSON.stringify(result),
      events: cards.length ? [{ type: "places", cards }] : [],
    };
  }

  private askForLocation(): ActionOutput {
    if (this.ctx.here) {
      return {
        isError: false,
        text: JSON.stringify({
          status: "already_shared",
          message: "The user already shared their location with this message: use it as find_places lat and lng.",
        }),
        events: [],
      };
    }
    const first = !this.asked;
    this.asked = true;
    return {
      isError: false,
      text: JSON.stringify({
        status: "waiting_for_user",
        message: "The app is showing a 📍 Share where I am card. In one short sentence, ask the user to share " +
          "where they are (in the app: the card, or ＋ → 📍 Send where I am) or to say which saved place they " +
          "are near. Do not guess a location.",
      }),
      events: first ? [{ type: "location_request" }] : [],
    };
  }
}
