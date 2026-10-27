import { loadSharedSpaces, loadSpaces, type Space } from "../lib/spaces.ts";
import { guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerListSpaces: RegisterTool = (server, { db }) => {
  server.registerTool(
    "list_spaces",
    {
      title: "List spaces",
      description:
        "List the user's spaces (folders such as Work, Recipes, Work/Gartner). " +
        "Restricted spaces are listed and marked, but their contents are never shown here or in search. " +
        "shared_with_me lists spaces other people shared with the user (whose, and whether the user can edit).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(async () => {
        // The built-in drinks space is Mocktails under 21 and Cocktails from 21 (D44): set right here,
        // as the app lists spaces on every open, so a 21st birthday shows by itself. Best effort: a
        // failure only leaves the name as it was.
        await Promise.resolve(db.rpc("sync_drinks_space")).catch(() => {});
        const spaces = await loadSpaces(db);
        const shared: Space[] = await loadSharedSpaces(db).catch(() => []);
        return ok({
          spaces: spaces.map(({ id, path, description, is_restricted, built_in }) => ({
            id,
            path,
            description,
            restricted: is_restricted,
            // Tasks, Memories, Recipes and Cocktails (Mocktails under 21): the app marks them BUILT-IN and offers no Delete or rename.
            ...(built_in ? { built_in } : {}),
          })),
          ...(shared.length
            ? {
              shared_with_me: shared.map(({ id, path, description, shared: s }) => ({
                id, path, description, from: s!.from, can_edit: s!.permission === "edit",
              })),
            }
            : {}),
        });
      }),
  );
};
