import { z } from "zod";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerDeleteSecret: RegisterTool = (server, { db }) => {
  server.registerTool(
    "delete_secret",
    {
      title: "Delete a secret",
      description:
        "Permanently delete a stored credential (it cannot be recovered; the access log keeps a " +
        "record that it existed). Only when the user clearly asked to delete that specific secret; " +
        "confirm the name with them first.",
      inputSchema: { secret_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    ({ secret_id }) =>
      guarded(async () => {
        const { data, error } = await db.rpc("delete_secret", { p_secret_id: secret_id });
        if (error) throw dbError("Could not delete the secret", error);
        return ok({ deleted: true, id: data.secret_id, name: data.name });
      }),
  );
};
