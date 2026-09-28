import { z } from "zod";
import { scheduleEmbedPending } from "../lib/embed.ts";
import { NO_CREDENTIALS_IN_DESCRIPTIONS } from "../lib/attachments.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerDescribeAttachment: RegisterTool = (server, { db, accessToken }) => {
  server.registerTool(
    "describe_attachment",
    {
      title: "Describe an attachment",
      description:
        "Set or replace the description of an attached picture or diagram, so it can be found by " +
        "search: what it shows, labels, text in the image. Use it when the picture is in this chat but was " +
        "attached without a description (or the user corrects one). Replaces the previous " +
        "description. " + NO_CREDENTIALS_IN_DESCRIPTIONS,
      inputSchema: {
        attachment_id: z.string().uuid(),
        description: z.string().trim().min(1).max(4000),
      },
    },
    ({ attachment_id, description }) =>
      guarded(async () => {
        const { data, error } = await db.rpc("set_attachment_description", {
          p_attachment_id: attachment_id,
          p_description: description,
        });
        if (error) throw dbError("Could not set the description", error);
        scheduleEmbedPending(accessToken);
        return ok({
          id: data.attachment_id,
          filename: data.filename,
          described: true,
          search_index: "keyword search now; meaning search within a few seconds",
        });
      }),
  );
};
