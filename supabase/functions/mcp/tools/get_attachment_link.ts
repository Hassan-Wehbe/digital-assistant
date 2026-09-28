import { z } from "zod";
import { attachmentById, BUCKET, describeAttachment, DOWNLOAD_LINK_SECONDS } from "../lib/attachments.ts";
import { guarded, ok, type RegisterTool } from "./_shared.ts";

export const registerGetAttachmentLink: RegisterTool = (server, { db }) => {
  server.registerTool(
    "get_attachment_link",
    {
      title: "Get a download link for an attachment",
      description:
        "When the user wants to open or download an attached file: returns a download link valid " +
        "for 10 minutes. Give the link to the user; do not open or fetch it yourself. Attachment ids " +
        "come from get_item.",
      inputSchema: { attachment_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    ({ attachment_id }) =>
      guarded(async () => {
        const a = await attachmentById(db, attachment_id);
        // Signed as the user: Storage checks the object is in their own folder.
        const { data, error } = await db.storage
          .from(BUCKET)
          .createSignedUrl(a.storage_key, DOWNLOAD_LINK_SECONDS, { download: a.filename });
        if (error || !data?.signedUrl) {
          throw new Error(`Could not create the download link: ${error?.message ?? "no link returned"}`);
        }
        return ok({
          attachment: describeAttachment(a),
          download_link: data.signedUrl,
          expires_at: new Date(Date.now() + DOWNLOAD_LINK_SECONDS * 1000).toISOString(),
          next_step: "Give the user the download link (valid 10 minutes). Do not open it yourself.",
        });
      }),
  );
};
