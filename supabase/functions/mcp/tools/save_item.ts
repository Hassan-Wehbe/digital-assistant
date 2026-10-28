import { z } from "zod";
import { chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSharedSpaces, loadSpaces, resolveSpace, type Space } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { rejectCredentials } from "../lib/credentials.ts";
import { assertOnlyHome, HOME_KIND, isPlace, normalizePlace, PLACE_KINDS, visiblePlaces, withPlace } from "../lib/places.ts";
import { isTask, normalizeTask, type TaskMetadata, TASKS_SPACE, tasksSpace, withTask } from "../lib/tasks.ts";
import { withLinkLocation } from "../lib/maps_link.ts";
import { isRoutine, normalizeRoutine, type RoutineMetadata, routineWords, withRoutine } from "../lib/routines.ts";
import { loadRoutine, userToday } from "../lib/routine_tasks.ts";
import { drinkHasAlcohol, isAdult21, normalizeRecipe, recipeType, STRENGTHS, UNDER_21, withRecipe } from "../lib/recipes.ts";
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
        'planned_at (only when the user says a time to do it: the local time, "2026-10-09T12:30"). ' +
        'For a recipe or a drink use item_type "recipe" or "cocktail" (default spaces Recipes and Cocktails), ' +
        "with the recipe as written in body, and optional metadata: ingredients [one per line], steps [in order], " +
        `minutes (total time), serves, source_url (the link it came from), source_site ("TikTok"), strength (cocktails: ${STRENGTHS.join(", ")}; none = no alcohol), ` +
        "made [{on, rating 1-5}]. The server checks these fields." +
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
        let task: TaskMetadata | null = isTask(item_type) ? normalizeTask(metadata, new Date(), timeZone) : null;
        // A routine (D39) is kept in the Tasks space; a routine's task gets the routine's schedule
        // (the routine must be the user's own).
        const today = userToday(undefined, timeZone);
        const routine: RoutineMetadata | null = isRoutine(item_type) ? normalizeRoutine(metadata, today) : null;
        // A recipe's or cocktail's fields (D43) are checked too, and added to the searchable text.
        const rtype = recipeType(item_type);
        const recipe = rtype ? normalizeRecipe(metadata, rtype, today) : null;
        // A drink with alcohol only from 21 (D44): checked here, whatever the app or the model sent.
        if (rtype === "cocktail" && drinkHasAlcohol(title, recipe) && !(await isAdult21(db))) throw new Error(UNDER_21);
        if (task?.routine_id) {
          const loaded = await loadRoutine(db, task.routine_id, today);
          task = withRoutine(task, loaded.id, loaded.routine, today);
        }
        const placeTitle = task?.place_id ? await taskPlaceTitle(db, task.place_id) : undefined;
        const spaces = await loadSpaces(db);
        let target: Space | undefined;
        let createdTasksSpace = false;
        if (space?.trim()) {
          try {
            // A space someone shared with the user counts only when none of their own matches (D32).
            const shared: Space[] = await loadSharedSpaces(db).catch(() => []);
            target = resolveSpace([...spaces, ...shared], space);
          } catch (e) {
            // "Tasks" before it exists: made on the first task.
            if (!task || space.trim().toLowerCase() !== TASKS_SPACE.toLowerCase()) throw e;
          }
        } else if (!task && !routine) throw new Error("Say which space to save it in (space).");
        if (routine && target && !isTasksSpace(target, spaces)) {
          throw new Error(`A routine is kept in the ${TASKS_SPACE} space; save it without a space.`);
        }
        if (!target) ({ space: target, created: createdTasksSpace } = await tasksSpace(db, spaces));
        if (target.shared?.permission === "view") {
          throw new Error(`${target.shared.from} shared "${target.path}" with the user to view only, so nothing can be added to it.`);
        }
        if (target.shared && routine) throw new Error("A routine can't be added to a shared space.");
        // A Maps link with coordinates and no location: the location is read from the link (Q15).
        let locationFromLink = false;
        if (place) ({ place, filled: locationFromLink } = withLinkLocation(place));
        const searchable = routine
          ? `${body.trim() ? `${body}\n\n` : ""}Routine: ${routineWords(routine)}`
          : withRecipe(withTask(withPlace(body, place), task), recipe);
        const chunks = await chunkAndEmbed({ title, summary, body: searchable });
        const { data, error } = await db.rpc("save_item", {
          p_space_id: target.id,
          p_item_type: item_type,
          p_title: title,
          p_body: body,
          p_summary: summary ?? null,
          p_metadata: place ?? task ?? routine ?? recipe ?? metadata ?? {},
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
          ...(routine ? { routine: { ...routine, schedule: routineWords(routine) } } : {}),
          ...(createdTasksSpace ? { created_space: TASKS_SPACE } : {}),
          // In a space someone shared (D32): it belongs to them; their tags are theirs.
          ...(target.shared
            ? { shared_space: `It belongs to ${target.shared.from}, who shared this space.`, ...(tags?.length ? { tags: "not kept: tags in a shared space are its owner's" } : {}) }
            : {}),
        });
      }),
  );
};

/** The account's Tasks space: the built-in one, or (an older account) the top-level one named Tasks. */
export function isTasksSpace(s: Space, spaces: Space[]): boolean {
  const builtIn = spaces.find((x) => x.built_in === "tasks");
  return builtIn ? s.id === builtIn.id : !s.parent_id && s.name.trim().toLowerCase() === TASKS_SPACE.toLowerCase();
}

/** The title of the saved place a task points at; an error when the user has no such visible place. */
export async function taskPlaceTitle(db: Parameters<typeof visiblePlaces>[0], placeId: string): Promise<string> {
  const hit = (await visiblePlaces(db, [placeId])).get(placeId);
  if (!hit) throw new Error("Task not saved: place_id is not one of your saved places (find it with search_items, item_type place)");
  return hit.title;
}
