import { z } from "zod";
import { chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace, type Space } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { rejectCredentials } from "../lib/credentials.ts";
import { assertOnlyHome, HOME_KIND, isPlace, normalizePlace, PLACE_KINDS, visiblePlaces, withPlace } from "../lib/places.ts";
import { isTask, normalizeTask, type TaskMetadata, TASKS_SPACE, tasksSpace, withTask } from "../lib/tasks.ts";
import { withLinkLocation } from "../lib/maps_link.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerSaveItem: RegisterTool = (server, { db, accessToken, assistantName, timeZone }) => {
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
        'visits [{on, with, note}]. Kind "home" is the user\'s one Home, where day plans start. The server checks these fields. ' +
        `For something the user has to do use item_type "task" (space optional, default ${TASKS_SPACE}) with ` +
        'metadata: due_on (YYYY-MM-DD), duration_min (5-480), duration_estimated (true when you guessed it), ' +
        'priority ("normal" or "important"), place_id (a saved place\'s id) or address, status ("open" or "done"), ' +
        'repeat ("daily", "weekdays", "weekly", "biweekly", "monthly"; leave out for one time), ' +
        'planned_at (only when the user says a time to do it: the local time, "2026-10-09T12:30").' +
        addressedAs(assistantName, "save this recipe"),
      inputSchema: {
        space: z.string().optional().describe(`Space name, path (Work/Gartner) or id; for a task, default ${TASKS_SPACE}`),
        title: z.string().trim().min(1).max(300),
        body: z.string().max(40_000).describe("The content, in Markdown"),
        item_type: z.string().trim().min(1).max(50).describe("design, recipe, note, how-to, ..."),
        summary: z.string().max(1000).optional().describe("One or two sentences, optional"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("e.g. [\"weeknight\", \"salesforce\"]"),
        metadata: z.record(z.string(), z.unknown()).optional()
          .describe("Extra structured fields; for a place or a task, its fields (see above)"),
      },
    },
    ({ space, title, body, item_type, summary, tags, metadata }) =>
      guarded(async () => {
        // Rule 9: enforced here, not left to the model.
        rejectCredentials({ title, body, summary, tags, metadata, item_type }, assistantName);
        // A place's fields are checked by the server and added to the searchable text.
        let place = isPlace(item_type) ? normalizePlace(metadata) : null;
        if (place?.kind === HOME_KIND) await assertOnlyHome(db);
        // A task's fields too; its place must be one of the user's own visible saved places.
        const task: TaskMetadata | null = isTask(item_type) ? normalizeTask(metadata, new Date(), timeZone) : null;
        const placeTitle = task?.place_id ? await taskPlaceTitle(db, task.place_id) : undefined;
        const spaces = await loadSpaces(db);
        let target: Space | undefined;
        let createdTasksSpace = false;
        if (space?.trim()) {
          try {
            target = resolveSpace(spaces, space);
          } catch (e) {
            // "Tasks" before it exists: made on the first task.
            if (!task || space.trim().toLowerCase() !== TASKS_SPACE.toLowerCase()) throw e;
          }
        } else if (!task) throw new Error("Say which space to save it in (space).");
        if (!target) ({ space: target, created: createdTasksSpace } = await tasksSpace(db, spaces));
        // A Maps link with coordinates and no location: the location is read from the link (Q15).
        let locationFromLink = false;
        if (place) ({ place, filled: locationFromLink } = withLinkLocation(place));
        const chunks = await chunkAndEmbed({ title, summary, body: withTask(withPlace(body, place), task) });
        const { data, error } = await db.rpc("save_item", {
          p_space_id: target.id,
          p_item_type: item_type,
          p_title: title,
          p_body: body,
          p_summary: summary ?? null,
          p_metadata: place ?? task ?? metadata ?? {},
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
          ...(task ? { task: { ...task, ...(placeTitle ? { place: placeTitle } : {}) } } : {}),
          ...(createdTasksSpace ? { created_space: TASKS_SPACE } : {}),
        });
      }),
  );
};

/** The title of the saved place a task points at; an error when the user has no such visible place. */
export async function taskPlaceTitle(db: Parameters<typeof visiblePlaces>[0], placeId: string): Promise<string> {
  const hit = (await visiblePlaces(db, [placeId])).get(placeId);
  if (!hit) throw new Error("Task not saved: place_id is not one of your saved places (find it with search_items, item_type place)");
  return hit.title;
}
