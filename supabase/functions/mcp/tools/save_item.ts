import { z } from "zod";
import { chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { rejectCredentials } from "../lib/credentials.ts";
import { isPlace, normalizePlace, PLACE_KINDS, withPlace } from "../lib/places.ts";
import { withLinkLocation } from "../lib/maps_link.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerSaveItem: RegisterTool = (server, { db, accessToken, assistantName }) => {
  server.registerTool(
    "save_item",
    {
      title: "Save an item",
      description:
        "Store a new piece of knowledge (a design, recipe, note, how-to, ...) in a space. " +
        "The text is indexed for search. Never use this for passwords, API keys or other " +
        "credentials: those belong in the vault (save_secret). " +
        `For a restaurant or a place to visit use item_type "place" with metadata: address, maps_url ` +
        `(Google Maps links only), kind (${PLACE_KINDS.join(", ")}), status ("want" or "been"), ` +
        "rating (1-5), visited_on (YYYY-MM-DD), cuisine [words], price_level (1-4), dishes_liked [..], " +
        "would_return, occasions (date_night, kids, business, quick_lunch, group, special), " +
        'visits [{on, with, note}]. The server checks these fields.' +
        addressedAs(assistantName, "save this recipe"),
      inputSchema: {
        space: z.string().describe("Space name, path (Work/Gartner) or id"),
        title: z.string().trim().min(1).max(300),
        body: z.string().max(40_000).describe("The content, in Markdown"),
        item_type: z.string().trim().min(1).max(50).describe("design, recipe, note, how-to, ..."),
        summary: z.string().max(1000).optional().describe("One or two sentences, optional"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("e.g. [\"weeknight\", \"salesforce\"]"),
        metadata: z.record(z.string(), z.unknown()).optional()
          .describe("Extra structured fields; for a place, its fields (see above)"),
      },
    },
    ({ space, title, body, item_type, summary, tags, metadata }) =>
      guarded(async () => {
        // Rule 9: enforced here, not left to the model.
        rejectCredentials({ title, body, summary, tags, metadata, item_type }, assistantName);
        // A place's fields are checked by the server and added to the searchable text.
        let place = isPlace(item_type) ? normalizePlace(metadata) : null;
        const target = resolveSpace(await loadSpaces(db), space);
        // A Maps link and no location: read the location from the link (Q15). Never fails the save.
        let locationFromLink = false;
        if (place) {
          const r = await withLinkLocation(place);
          ({ place, filled: locationFromLink } = r);
          // Codes and counts only (never the link or the point), to see how Google answers.
          if (r.log) console.log(r.log);
        }
        const chunks = await chunkAndEmbed({ title, summary, body: withPlace(body, place) });
        const { data, error } = await db.rpc("save_item", {
          p_space_id: target.id,
          p_item_type: item_type,
          p_title: title,
          p_body: body,
          p_summary: summary ?? null,
          p_metadata: place ?? metadata ?? {},
          p_tags: tags ?? [],
          p_chunks: chunks,
        });
        if (error) throw dbError("Could not save the item", error);
        const pending = hasPending(chunks);
        if (pending) scheduleEmbedPending(accessToken);
        return ok({
          id: data,
          space: target.path,
          restricted_space: target.is_restricted,
          chunks: chunks.length,
          search_index: pending ? "keyword search now; meaning search within a few seconds" : "ready",
          ...(locationFromLink ? { location: "read from the Google Maps link" } : {}),
        });
      }),
  );
};
