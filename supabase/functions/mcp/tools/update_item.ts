import { z } from "zod";
import { type Chunk, chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { rejectCredentials } from "../lib/credentials.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerUpdateItem: RegisterTool = (server, { db, accessToken, assistantName }) => {
  server.registerTool(
    "update_item",
    {
      title: "Update an item",
      description:
        "Edit an existing item. Only the fields you pass change. The previous version is kept " +
        "in the item's history before the edit is applied. Passing tags replaces the whole tag list.",
      inputSchema: {
        item_id: z.string().uuid(),
        title: z.string().trim().min(1).max(300).optional(),
        body: z.string().max(40_000).optional().describe("The full new content, in Markdown"),
        summary: z.string().max(1000).optional(),
        item_type: z.string().trim().min(1).max(50).optional(),
        space: z.string().optional().describe("Move to this space (name, path or id)"),
        tags: z.array(z.string().max(50)).max(20).optional(),
        metadata: z.record(z.string(), z.unknown()).optional().describe("Replaces all metadata"),
        change_note: z.string().max(500).optional().describe("Why it changed, kept with the old version"),
      },
    },
    (args) =>
      guarded(async () => {
        // Rule 9: enforced here, not left to the model.
        const { title, body, summary, tags, metadata, item_type, change_note } = args;
        rejectCredentials({ title, body, summary, tags, metadata, item_type, change_note }, assistantName);
        const targetSpace = args.space ? resolveSpace(await loadSpaces(db), args.space) : null;

        // Text changed: re-chunk the new current version (only it is searchable).
        let chunks: Chunk[] | null = null;
        if (args.title !== undefined || args.body !== undefined || args.summary !== undefined) {
          const { data: current, error } = await db.rpc("get_item", { p_item_id: args.item_id });
          if (error) throw dbError("Could not load the item", error);
          if (!current) throw new Error("Item not found");
          chunks = await chunkAndEmbed({
            title: args.title ?? current.title,
            summary: args.summary ?? current.summary,
            body: args.body ?? current.body_markdown,
          });
        }

        const { error } = await db.rpc("update_item", {
          p_item_id: args.item_id,
          p_title: args.title ?? null,
          p_body: args.body ?? null,
          p_summary: args.summary ?? null,
          p_metadata: args.metadata ?? null,
          p_item_type: args.item_type ?? null,
          p_space_id: targetSpace?.id ?? null,
          p_tags: args.tags ?? null,
          p_change_note: args.change_note ?? null,
          p_chunks: chunks,
        });
        if (error) throw dbError("Could not update the item", error);
        if (hasPending(chunks)) scheduleEmbedPending(accessToken);
        return ok({ id: args.item_id, updated: true, reindexed: chunks !== null });
      }),
  );
};
