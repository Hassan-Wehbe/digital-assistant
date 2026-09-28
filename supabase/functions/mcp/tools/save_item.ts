import { z } from "zod";
import { chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerSaveItem: RegisterTool = (server, { db, accessToken }) => {
  server.registerTool(
    "save_item",
    {
      title: "Save an item",
      description:
        "Store a new piece of knowledge (a design, recipe, note, how-to, ...) in a space. " +
        "The text is indexed for search. Never use this for passwords, API keys or other " +
        "credentials: those belong in the vault (save_secret).",
      inputSchema: {
        space: z.string().describe("Space name, path (Work/Gartner) or id"),
        title: z.string().trim().min(1).max(300),
        body: z.string().max(40_000).describe("The content, in Markdown"),
        item_type: z.string().trim().min(1).max(50).describe("design, recipe, note, how-to, ..."),
        summary: z.string().max(1000).optional().describe("One or two sentences, optional"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("e.g. [\"weeknight\", \"salesforce\"]"),
        metadata: z.record(z.string(), z.unknown()).optional().describe("Extra structured fields"),
      },
    },
    ({ space, title, body, item_type, summary, tags, metadata }) =>
      guarded(async () => {
        const target = resolveSpace(await loadSpaces(db), space);
        const chunks = await chunkAndEmbed({ title, summary, body });
        const { data, error } = await db.rpc("save_item", {
          p_space_id: target.id,
          p_item_type: item_type,
          p_title: title,
          p_body: body,
          p_summary: summary ?? null,
          p_metadata: metadata ?? {},
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
        });
      }),
  );
};
