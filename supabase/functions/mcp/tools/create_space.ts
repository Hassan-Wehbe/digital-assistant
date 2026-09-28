import { z } from "zod";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerCreateSpace: RegisterTool = (server, { db }) => {
  server.registerTool(
    "create_space",
    {
      title: "Create a space",
      description:
        "Create a space to organize items, optionally inside another space (parent) " +
        "and optionally restricted (hidden from all searches).",
      inputSchema: {
        name: z.string().trim().min(1).max(100).describe("Name of the new space, e.g. Recipes"),
        parent: z.string().optional().describe("Parent space name, path (Work/Gartner) or id"),
        description: z.string().max(500).optional(),
        restricted: z.boolean().optional().describe(
          "Restricted spaces never appear in search results. Default false.",
        ),
      },
    },
    ({ name, parent, description, restricted }) =>
      guarded(async () => {
        if (name.includes("/")) throw new Error("Space names cannot contain '/'. Use parent to nest.");
        const parentSpace = parent ? resolveSpace(await loadSpaces(db), parent) : null;
        const { data, error } = await db
          .from("space")
          .insert({
            name,
            description: description ?? null,
            parent_id: parentSpace?.id ?? null,
            is_restricted: restricted ?? false,
          })
          .select("id")
          .single();
        if (error) throw dbError(`Could not create space "${name}"`, error);
        const path = parentSpace ? `${parentSpace.path}/${name}` : name;
        return ok({ id: data.id, path, restricted: restricted ?? false });
      }),
  );
};
