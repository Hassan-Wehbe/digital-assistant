import { z } from "zod";
import { embed } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

/**
 * Cosine distance above which a meaning match counts as unrelated when
 * close_matches_only is set (similarity below 0.8, the usual cutoff for gte-small).
 */
export const CLOSE_MATCH_MAX_DISTANCE = 0.2;

export const registerSearchItems: RegisterTool = (server, { db, assistantName }) => {
  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description:
        "Find items by meaning and keywords, optionally filtered by tags, space and type. " +
        "Also matches attached files (file names, captions, picture descriptions, Visio text); " +
        "results are the items that hold them. " +
        "With no query, lists the most recently updated items matching the filters. " +
        "Returns snippets; call get_item for the full text. Restricted spaces are never searched." +
        addressedAs(assistantName, "what did I note about the Gartner sandbox?"),
      inputSchema: {
        query: z.string().max(500).optional().describe("What to look for, in plain words"),
        tags: z.array(z.string()).max(10).optional().describe("Items must have all of these tags"),
        space: z.string().optional().describe("Only this space and its sub-spaces (name, path or id)"),
        item_type: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
        close_matches_only: z.boolean().optional()
          .describe("Leave out results that are only loosely related (keyword matches always stay)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, tags, space, item_type, limit, close_matches_only }) =>
      guarded(async () => {
        const spaces = await loadSpaces(db);
        const scope = space ? resolveSpace(spaces, space) : null;
        const q = query?.trim() || null;
        const { data, error } = await db.rpc("search_items", {
          p_query: q,
          p_query_embedding: q ? await embed(q) : null,
          p_tags: tags?.length ? tags : null,
          p_space_id: scope?.id ?? null,
          p_item_type: item_type ?? null,
          p_limit: limit ?? 10,
          p_max_distance: close_matches_only ? CLOSE_MATCH_MAX_DISTANCE : null,
        });
        if (error) throw dbError("Search failed", error);
        const pathOf = new Map(spaces.map((s) => [s.id, s.path]));
        return ok({
          results: (data as Array<Record<string, unknown>>).map((r) => ({
            id: r.item_id,
            title: r.title,
            item_type: r.item_type,
            space: pathOf.get(r.space_id as string),
            tags: r.tags,
            snippet: r.snippet,
            updated_at: r.updated_at,
          })),
        });
      }),
  );
};
