import { z } from "zod";
import { builtInRefusal, loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerDeleteSpace: RegisterTool = (server, { db }) => {
  server.registerTool(
    "delete_space",
    {
      title: "Delete an empty space",
      description:
        "Delete a space. Only an empty space can be deleted: no items (not even in the recycle bin), " +
        "no sub-spaces and no vault secrets; otherwise the answer says what is still inside, for the " +
        "user to move or delete first. Only when the user clearly asked: confirm the space first.",
      inputSchema: { space: z.string().describe("Space name, path (Work/Gartner) or id") },
      annotations: { destructiveHint: true },
    },
    ({ space }) =>
      guarded(async () => {
        const target = resolveSpace(await loadSpaces(db), space);
        if (target.built_in) throw new Error(builtInRefusal(target, "deleted"));
        const { data, error } = await db.rpc("delete_space", { p_space_id: target.id });
        if (error) throw dbError("Could not delete the space", error);
        return ok({ ...data, path: target.path });
      }),
  );
};
