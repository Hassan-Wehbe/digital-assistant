import { z } from "zod";
import { type Chunk, chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { rejectCredentials } from "../lib/credentials.ts";
import { addVisit, assertOnlyHome, HOME_KIND, isPlace, normalizePlace, type PlaceMetadata, placePoint, withPlace } from "../lib/places.ts";
import { withLinkLocation } from "../lib/maps_link.ts";
import { isTask, normalizeTask, setTaskDone, type TaskMetadata, withTask } from "../lib/tasks.ts";
import { taskPlaceTitle } from "./save_item.ts";
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
        "the rest of its fields; metadata replaces them all. For a task, task_done: true marks it done " +
        "(\"I picked up the dry cleaning\") and false opens it again, keeping its other fields; a repeating task " +
        "moves to its next date instead.",
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
        task_done: z.boolean().optional().describe("Tasks only: true marks it done, false opens it again"),
        change_note: z.string().max(500).optional().describe("Why it changed, kept with the old version"),
      },
    },
    (args) =>
      guarded(async () => {
        // Rule 9: enforced here, not left to the model.
        const { title, body, summary, tags, metadata, item_type, change_note, add_visit, task_done } = args;
        rejectCredentials({ title, body, summary, tags, metadata, item_type, change_note, add_visit }, assistantName);
        const targetSpace = args.space ? resolveSpace(await loadSpaces(db), args.space) : null;

        const textChanged = title !== undefined || body !== undefined || summary !== undefined;
        const fieldsChanged = metadata !== undefined || item_type !== undefined || add_visit !== undefined ||
          task_done !== undefined;
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
        if (task_done !== undefined && !isTask(finalType)) throw new Error("task_done is only for tasks (item_type \"task\")");
        // A task's fields likewise; its place must stay one of the user's own visible saved places.
        let task: TaskMetadata | null = null;
        if (current && isTask(finalType)) {
          const base = metadata ?? current.metadata;
          if (fieldsChanged) {
            task = task_done !== undefined ? setTaskDone(base, task_done) : normalizeTask(base);
            if (task.place_id && metadata !== undefined) await taskPlaceTitle(db, task.place_id);
          } else {
            try {
              task = normalizeTask(base);
            } catch {
              task = null;
            }
          }
        }
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
        // A Maps link with coordinates and no location: the location is read from the link (Q15).
        // Not when the place had a location and keeps the same link: the user removed it on purpose.
        let locationFromLink = false;
        if (place && fieldsChanged && current) {
          const removed = placePoint(current.metadata) !== null && current.metadata?.maps_url === place.maps_url;
          if (!removed) ({ place, filled: locationFromLink } = withLinkLocation(place));
        }
        if (place && fieldsChanged && place.kind === HOME_KIND) await assertOnlyHome(db, args.item_id);
        const newMetadata = place && fieldsChanged ? place : task && fieldsChanged ? task : metadata ?? null;

        // Text or place fields changed: re-chunk the new current version (only it is searchable).
        let chunks: Chunk[] | null = null;
        if (current && (textChanged || fieldsChanged)) {
          chunks = await chunkAndEmbed({
            title: title ?? current.title,
            summary: summary ?? current.summary,
            body: withTask(withPlace(body ?? current.body_markdown, place), task),
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
          ...(task && fieldsChanged ? { task: newMetadata } : {}),
          ...(locationFromLink ? { location: "read from the Google Maps link" } : {}),
        });
      }),
  );
};
