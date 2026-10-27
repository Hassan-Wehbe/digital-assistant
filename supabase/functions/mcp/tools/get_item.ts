import { z } from "zod";
import { loadAllSpaces, OTHERS_WORDS, sharerName } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

type Person = { name?: string; email?: string } | null | undefined;

/**
 * get_item's answer as the model sees it: the space with its path; for a note shared with the user
 * (D32), who shared it, whether they may change it, and that its text is someone else's; people by
 * name only (never their email).
 */
export function itemForModel(data: Record<string, unknown>, path?: string): Record<string, unknown> {
  const { shared, added_by, changed_by, access, space, ...rest } = data as Record<string, unknown> & {
    shared?: { from?: Person } | null;
    added_by?: Person;
    changed_by?: Person;
    space?: Record<string, unknown> | null;
  };
  return {
    ...rest,
    space: space ? { ...space, path } : "(a note shared with you)",
    ...(added_by ? { added_by: sharerName(added_by) } : {}),
    ...(changed_by ? { changed_by: sharerName(changed_by) } : {}),
    ...(shared ? { shared_from: sharerName(shared.from), can_edit: access === "edit", about_shared: OTHERS_WORDS } : {}),
  };
}

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
        const path = data.space ? (await loadAllSpaces(db)).find((s) => s.id === data.space.id)?.path : undefined;
        return ok(itemForModel(data, path));
      }),
  );
};
