import { z } from "zod";
import { sharerName } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerDeleteItem: RegisterTool = (server, { db }) => {
  server.registerTool(
    "delete_item",
    {
      title: "Delete an item (to the recycle bin)",
      description:
        "Move an item to the recycle bin: it disappears from search and get_item, but can be brought " +
        "back with restore_item (list_deleted_items shows the bin). Its files stay until it is deleted " +
        "for good (purge_item). Only when the user clearly asked to delete that item: confirm its title first.",
      inputSchema: { item_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    ({ item_id }) =>
      guarded(async () => {
        // A note someone shared (D32): view only can't be deleted; with edit it goes to their bin.
        const { data: current } = await db.rpc("get_item", { p_item_id: item_id });
        const owner = current?.shared ? sharerName(current.shared.from) : null;
        if (current?.access === "view") throw new Error(`${owner} shared this note with the user to view only, so it can't be deleted.`);
        const { data, error } = await db.rpc("delete_item", { p_item_id: item_id });
        if (error) throw dbError("Could not delete the item", error);
        return ok({
          ...data,
          next_step: owner
            ? `Tell the user it is in ${owner}'s recycle bin: ${owner} can restore it, the user can't.`
            : "Tell the user it is in the recycle bin and can be restored.",
        });
      }),
  );
};
