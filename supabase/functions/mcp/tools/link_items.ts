import { z } from "zod";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerLinkItems: RegisterTool = (server, { db }) => {
  server.registerTool(
    "link_items",
    {
      title: "Link two items",
      description:
        "Record a relation between two items. 'supersedes': from_item replaces the older " +
        "to_item (e.g. a new design). 'related': the two are about the same topic.",
      inputSchema: {
        from_item_id: z.string().uuid(),
        to_item_id: z.string().uuid(),
        relation: z.enum(["supersedes", "related"]),
      },
    },
    ({ from_item_id, to_item_id, relation }) =>
      guarded(async () => {
        if (from_item_id === to_item_id) throw new Error("An item cannot be linked to itself");
        const { error } = await db
          .from("item_link")
          .upsert({ from_item_id, to_item_id, relation }, { ignoreDuplicates: true });
        if (error) {
          // RLS hides other users' items, so a foreign or missing id looks the same.
          if (error.code === "42501" || error.code === "23503") throw new Error("Item not found");
          throw dbError("Could not link the items", error);
        }
        return ok({ linked: true, from_item_id, relation, to_item_id });
      }),
  );
};
