import { z } from "zod";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { describeSecret, SECRET_TYPES } from "../lib/vault.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerFindSecret: RegisterTool = (server, { db }) => {
  server.registerTool(
    "find_secret",
    {
      title: "Find secrets",
      description:
        "Look up stored credentials by name or website words, type and space. Returns metadata only " +
        "(name, url, type, space, dates), never values. Restricted spaces are never searched. " +
        "To show a value, use get_secret, which gives the user a reveal link.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Words from the name or url, e.g. \"gartner sandbox\""),
        secret_type: z.enum(SECRET_TYPES).optional(),
        space: z.string().optional().describe("Only this space and its sub-spaces (name, path or id)"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, secret_type, space, limit }) =>
      guarded(async () => {
        const spaces = await loadSpaces(db);
        const scope = space ? resolveSpace(spaces, space) : null;
        const { data, error } = await db.rpc("find_secrets", {
          p_query: query?.trim() || null,
          p_secret_type: secret_type ?? null,
          p_space_id: scope?.id ?? null,
          p_limit: limit ?? 20,
        });
        if (error) throw dbError("Search failed", error);
        return ok({
          results: (data as Array<Record<string, unknown>>).map((r) => {
            const { space_restricted: _hidden, ...meta } = describeSecret(r, spaces);
            return meta;
          }),
        });
      }),
  );
};
