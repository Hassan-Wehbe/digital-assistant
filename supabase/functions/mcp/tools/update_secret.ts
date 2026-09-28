import { z } from "zod";
import { loadSpaces } from "../lib/spaces.ts";
import { describeSecret, entryLink, NEVER_VALUES, secretById } from "../lib/vault.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerUpdateSecret: RegisterTool = (server, { db }) => {
  server.registerTool(
    "update_secret",
    {
      title: "Update a secret",
      description:
        "Rename a stored credential or change its website, and/or get a one-time link where the " +
        "user types a new value (new_value: true, e.g. after a password change or rotation). " +
        NEVER_VALUES,
      inputSchema: {
        secret_id: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        url: z.string().trim().max(2000).optional().describe("New website; an empty string removes it"),
        new_value: z.boolean().optional().describe("true = return an entry link for a new value"),
      },
    },
    ({ secret_id, name, url, new_value }) =>
      guarded(async () => {
        if (name === undefined && url === undefined && !new_value) {
          throw new Error("Nothing to change: give name, url or new_value: true.");
        }
        await secretById(db, secret_id);
        if (name !== undefined || url !== undefined) {
          const { error } = await db.rpc("update_secret_meta", {
            p_secret_id: secret_id, p_name: name ?? null, p_url: url ?? null,
          });
          if (error) throw dbError("Could not update the secret", error);
        }
        let entry: { entry_link: string; expires_at: string } | null = null;
        if (new_value) {
          const { data, error } = await db.rpc("create_secret_reentry", { p_secret_id: secret_id });
          if (error) throw dbError("Could not create the entry link", error);
          entry = { entry_link: entryLink(data.token), expires_at: data.expires_at };
        }
        const secret = describeSecret(await secretById(db, secret_id), await loadSpaces(db));
        return ok({
          secret,
          ...(entry
            ? {
              ...entry,
              next_step: "Give the user the entry link; the new value replaces the old one when they submit it.",
            }
            : {}),
        });
      }),
  );
};
