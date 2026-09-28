import { z } from "zod";
import { loadSpaces } from "../lib/spaces.ts";
import { describeSecret, NEVER_VALUES, revealLink, secretById } from "../lib/vault.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerGetSecret: RegisterTool = (server, { db }) => {
  server.registerTool(
    "get_secret",
    {
      title: "Get a secret (reveal link)",
      description:
        "When the user wants to see a stored credential: returns its metadata and a one-time " +
        "reveal link (valid 10 minutes, single use). Give the user the link; they unlock it with " +
        "their vault passphrase and the value is shown only on that page. The value is never " +
        "returned to you. " + NEVER_VALUES + " Pass secret_id (from find_secret) or an exact-ish name.",
      inputSchema: {
        secret_id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(200).optional().describe("Used when secret_id is not given"),
      },
    },
    ({ secret_id, name }) =>
      guarded(async () => {
        if (!secret_id && !name) throw new Error("Give secret_id or name.");
        const spaces = await loadSpaces(db);
        let row: Record<string, unknown>;
        if (secret_id) {
          row = await secretById(db, secret_id);
        } else {
          const { data, error } = await db.rpc("find_secrets", {
            p_query: name, p_secret_type: null, p_space_id: null, p_limit: 10,
          });
          if (error) throw dbError("Search failed", error);
          const hits = data as Array<Record<string, unknown>>;
          const exact = hits.filter((r) => String(r.name).toLowerCase() === name!.toLowerCase());
          const pick = exact.length === 1 ? exact : hits;
          if (pick.length === 0) throw new Error(`No secret matches "${name}". Try find_secret with fewer words.`);
          if (pick.length > 1) {
            return ok({
              ambiguous: true,
              message: "Several secrets match. Ask the user which one, then call get_secret with its secret_id.",
              candidates: pick.map((r) => {
                const { space_restricted: _h, ...meta } = describeSecret(r, spaces);
                return meta;
              }),
            });
          }
          row = pick[0];
        }
        const meta = describeSecret(row, spaces);
        const { data, error } = await db.rpc("create_reveal_token", { p_secret_id: meta.id });
        if (error) throw dbError("Could not create the reveal link", error);
        return ok({
          secret: meta,
          reveal_link: revealLink(data.token),
          expires_at: data.expires_at,
          next_step:
            "Give the user the reveal link. They unlock it with their vault passphrase (not their " +
            "account password). It works once; ask again for a new link.",
        });
      }),
  );
};
