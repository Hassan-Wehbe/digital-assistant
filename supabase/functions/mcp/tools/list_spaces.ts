import { loadSpaces } from "../lib/spaces.ts";
import { guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerListSpaces: RegisterTool = (server, { db }) => {
  server.registerTool(
    "list_spaces",
    {
      title: "List spaces",
      description:
        "List the user's spaces (folders such as Work, Recipes, Work/Gartner). " +
        "Restricted spaces are listed and marked, but their contents are never shown here or in search.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(async () => {
        const spaces = await loadSpaces(db);
        return ok({
          spaces: spaces.map(({ id, path, description, is_restricted, built_in }) => ({
            id,
            path,
            description,
            restricted: is_restricted,
            // Tasks and Memories: the app marks them BUILT-IN and offers no Delete or rename.
            ...(built_in ? { built_in } : {}),
          })),
        });
      }),
  );
};
