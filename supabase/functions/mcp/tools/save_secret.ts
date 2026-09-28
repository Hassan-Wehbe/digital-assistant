import { z } from "zod";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { describeSecret, entryLink, NEVER_VALUES, requireVault, SECRET_TYPES } from "../lib/vault.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerSaveSecret: RegisterTool = (server, { db }) => {
  server.registerTool(
    "save_secret",
    {
      title: "Save a secret (password, API key, ...)",
      description:
        "Start storing a credential in the encrypted vault: a login, API key, Wi-Fi password, " +
        "recovery codes or a secure note. Takes only metadata and returns a one-time entry link " +
        "(valid 15 minutes). Give the user the link; they type the value on that page, where it " +
        "is encrypted in their browser. You never see it. " + NEVER_VALUES + " If the user already " +
        "pasted a secret into the chat, do not store it anywhere: tell them it has been exposed " +
        "and should be changed (rotated), then offer this link for the new value.",
      inputSchema: {
        space: z.string().describe("Space name, path (Work/Gartner) or id"),
        name: z.string().trim().min(1).max(200).describe("What it is, e.g. \"Gartner sandbox login\""),
        secret_type: z.enum(SECRET_TYPES).describe("login, api_key, wifi, recovery_codes or note"),
        url: z.string().trim().max(2000).optional().describe("Website or service address, if any"),
      },
    },
    ({ space, name, secret_type, url }) =>
      guarded(async () => {
        await requireVault(db);
        const spaces = await loadSpaces(db);
        const target = resolveSpace(spaces, space);
        const { data, error } = await db.rpc("create_secret_entry", {
          p_space_id: target.id,
          p_secret_type: secret_type,
          p_name: name,
          p_url: url ?? null,
        });
        if (error) throw dbError("Could not create the entry link", error);

        // A secret with the same name in the same space is probably an update.
        const { data: same } = await db.rpc("find_secrets", {
          p_query: name, p_secret_type: null, p_space_id: target.id, p_limit: 5,
        });
        const existing = (same as Array<Record<string, unknown>> | null ?? [])
          .filter((r) => String(r.name).toLowerCase() === name.toLowerCase())
          .map((r) => describeSecret(r, spaces));

        return ok({
          status: "waiting_for_value",
          entry_link: entryLink(data.token),
          expires_at: data.expires_at,
          secret: { id: data.secret_id, name, secret_type, url: url ?? null, space: target.path },
          next_step:
            "Give the user the entry link. The secret is saved once they submit the form there. " +
            "Do not ask them for the value here.",
          ...(existing.length
            ? {
              note: "A secret with this name already exists in this space. If the user meant to change " +
                "it, use update_secret with new_value instead; otherwise this creates a second one.",
              existing,
            }
            : {}),
        });
      }),
  );
};
