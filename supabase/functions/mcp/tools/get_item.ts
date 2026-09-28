import { z } from "zod";
import { loadSpaces } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerGetItem: RegisterTool = (server, { db }) => {
  server.registerTool(
    "get_item",
    {
      title: "Get an item",
      description:
        "Fetch one item by id with its full text, tags, attachments (ids, file names, descriptions, " +
        "Visio text) and linked items " +
        "(supersedes / related). Use after search_items to read a result in full.",
      inputSchema: { item_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    ({ item_id }) =>
      guarded(async () => {
        const { data, error } = await db.rpc("get_item", { p_item_id: item_id });
        if (error) throw dbError("Could not load the item", error);
        if (!data) throw new Error("Item not found");
        const path = (await loadSpaces(db)).find((s) => s.id === data.space.id)?.path;
        return ok({ ...data, space: { ...data.space, path } });
      }),
  );
};
