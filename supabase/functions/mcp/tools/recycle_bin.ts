// The recycle bin: deleted items can be listed, restored, or deleted for good.
import { z } from "zod";
import { BUCKET } from "../lib/attachments.ts";
import { loadSpaces } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerListDeletedItems: RegisterTool = (server, { db }) => {
  server.registerTool(
    "list_deleted_items",
    {
      title: "List the recycle bin",
      description:
        "List items in the recycle bin (deleted with delete_item), most recently deleted first, " +
        "with their space and how many files they hold. Items from restricted spaces are not listed.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("Default 50") },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) =>
      guarded(async () => {
        const { data, error } = await db.rpc("list_deleted_items", { p_limit: limit ?? 50 });
        if (error) throw dbError("Could not read the recycle bin", error);
        const pathOf = new Map((await loadSpaces(db)).map((s) => [s.id, s.path]));
        return ok({
          items: (data as Array<Record<string, unknown>>).map(({ space_id, ...rest }) => ({
            ...rest,
            space: pathOf.get(space_id as string),
          })),
        });
      }),
  );
};

export const registerRestoreItem: RegisterTool = (server, { db }) => {
  server.registerTool(
    "restore_item",
    {
      title: "Restore an item from the recycle bin",
      description: "Bring an item back from the recycle bin, with its files, tags and history.",
      inputSchema: { item_id: z.string().uuid() },
    },
    ({ item_id }) =>
      guarded(async () => {
        const { data, error } = await db.rpc("restore_item", { p_item_id: item_id });
        if (error) throw dbError("Could not restore the item", error);
        return ok(data);
      }),
  );
};

export const registerPurgeItem: RegisterTool = (server, { db }) => {
  server.registerTool(
    "purge_item",
    {
      title: "Delete an item for good",
      description:
        "Permanently delete an item that is already in the recycle bin, with its files, history and " +
        "search text. It cannot be recovered. Only when the user clearly asked to delete that item " +
        "for good (or to empty the bin): confirm its title first.",
      inputSchema: { item_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    ({ item_id }) =>
      guarded(async () => {
        const { data: keys, error: keyErr } = await db.rpc("deleted_item_files", { p_item_id: item_id });
        if (keyErr) throw dbError("Could not delete the item", keyErr);
        // The files first: if Storage refuses, the item stays in the bin and nothing is half-deleted.
        const paths = (keys as string[] | null) ?? [];
        if (paths.length) {
          const { error: rmErr } = await db.storage.from(BUCKET).remove(paths);
          if (rmErr) throw new Error(`Could not delete the item's files: ${rmErr.message}`);
        }
        const { data, error } = await db.rpc("purge_item", { p_item_id: item_id });
        if (error) throw dbError("Could not delete the item", error);
        return ok({ ...data, files_deleted: paths.length });
      }),
  );
};
