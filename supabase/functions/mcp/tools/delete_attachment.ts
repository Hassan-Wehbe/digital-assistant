import { z } from "zod";
import { attachmentById, BUCKET } from "../lib/attachments.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerDeleteAttachment: RegisterTool = (server, { db }) => {
  server.registerTool(
    "delete_attachment",
    {
      title: "Delete an attachment",
      description:
        "Permanently delete an attached file and its search text (it cannot be recovered; the item " +
        "itself stays). Only when the user clearly asked to delete that specific file: confirm the " +
        "file name and item with them first. Attachment ids come from get_item.",
      inputSchema: { attachment_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    ({ attachment_id }) =>
      guarded(async () => {
        const a = await attachmentById(db, attachment_id);
        // The file first: if Storage refuses, the row stays and nothing is half-deleted.
        const { error: rmErr } = await db.storage.from(BUCKET).remove([a.storage_key]);
        if (rmErr) throw new Error(`Could not delete the file: ${rmErr.message}`);
        const { data, error } = await db.rpc("delete_attachment", { p_attachment_id: attachment_id });
        if (error) throw dbError("Could not delete the attachment", error);
        return ok({ deleted: true, id: data.attachment_id, filename: data.filename, item: a.item });
      }),
  );
};
