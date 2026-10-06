import { z } from "zod";
import { type Chunk, chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { rejectCredentials } from "../lib/credentials.ts";
import { addVisit, isPlace, normalizePlace, type PlaceMetadata, withPlace } from "../lib/places.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerUpdateItem: RegisterTool = (server, { db, accessToken, assistantName }) => {
  server.registerTool(
    "update_item",
    {
      title: "Update an item",
      description:
        "Edit an existing item. Only the fields you pass change. The previous version is kept " +
        "in the item's history before the edit is applied. Passing tags replaces the whole tag list. " +
        "For a place, add_visit records a visit (\"we went again last Friday with Sarah\") and keeps " +
        "the rest of its fields; metadata replaces them all.",
      inputSchema: {
        item_id: z.string().uuid(),
        title: z.string().trim().min(1).max(300).optional(),
        body: z.string().max(40_000).optional().describe("The full new content, in Markdown"),
        summary: z.string().max(1000).optional(),
        item_type: z.string().trim().min(1).max(50).optional(),
        space: z.string().optional().describe("Move to this space (name, path or id)"),
        tags: z.array(z.string().max(50)).max(20).optional(),
        metadata: z.record(z.string(), z.unknown()).optional().describe("Replaces all metadata"),
        add_visit: z.object({
          on: z.string().describe("Date of the visit, YYYY-MM-DD"),
          with: z.string().max(100).optional().describe("Who went"),
          note: z.string().max(300).optional().describe("One line about the visit"),
          rating: z.number().int().min(1).max(5).optional().describe("New rating for the place, 1-5"),
        }).optional().describe("Places only: add a visit, newest first; the place becomes \"been\""),
        change_note: z.string().max(500).optional().describe("Why it changed, kept with the old version"),
      },
    },
    (args) =>
      guarded(async () => {
        // Rule 9: enforced here, not left to the model.
        const { title, body, summary, tags, metadata, item_type, change_note, add_visit } = args;
        rejectCredentials({ title, body, summary, tags, metadata, item_type, change_note, add_visit }, assistantName);
        const targetSpace = args.space ? resolveSpace(await loadSpaces(db), args.space) : null;

        const textChanged = title !== undefined || body !== undefined || summary !== undefined;
        const fieldsChanged = metadata !== undefined || item_type !== undefined || add_visit !== undefined;
        let current: { title: string; summary: string | null; body_markdown: string; item_type: string; metadata: Record<string, unknown> } | null = null;
        if (textChanged || fieldsChanged) {
          const { data, error } = await db.rpc("get_item", { p_item_id: args.item_id });
          if (error) throw dbError("Could not load the item", error);
          if (!data) throw new Error("Item not found");
          current = data;
        }

        // A place's fields are checked by the server whenever they or the type change.
        const finalType = item_type ?? current?.item_type;
        let place: PlaceMetadata | null = null;
        if (add_visit && !isPlace(finalType)) throw new Error("add_visit is only for places (item_type \"place\")");
        if (current && isPlace(finalType)) {
          const base = metadata ?? current.metadata;
          if (fieldsChanged) place = add_visit ? addVisit(base, add_visit) : normalizePlace(base);
          else {
            // Only the text changed: a place saved before these checks still gets its fields
            // into search when they are valid, and its text edit never fails because of them.
            try {
              place = normalizePlace(base);
            } catch {
              place = null;
            }
          }
        }
        const newMetadata = place && fieldsChanged ? place : metadata ?? null;

        // Text or place fields changed: re-chunk the new current version (only it is searchable).
        let chunks: Chunk[] | null = null;
        if (current && (textChanged || fieldsChanged)) {
          chunks = await chunkAndEmbed({
            title: title ?? current.title,
            summary: summary ?? current.summary,
            body: withPlace(body ?? current.body_markdown, place),
          });
        }

        const { error } = await db.rpc("update_item", {
          p_item_id: args.item_id,
          p_title: title ?? null,
          p_body: body ?? null,
          p_summary: summary ?? null,
          p_metadata: newMetadata,
          p_item_type: item_type ?? null,
          p_space_id: targetSpace?.id ?? null,
          p_tags: tags ?? null,
          p_change_note: change_note ?? null,
          p_chunks: chunks,
        });
        if (error) throw dbError("Could not update the item", error);
        if (hasPending(chunks)) scheduleEmbedPending(accessToken);
        return ok({
          id: args.item_id,
          updated: true,
          reindexed: chunks !== null,
          ...(place && fieldsChanged ? { place: newMetadata } : {}),
        });
      }),
  );
};
