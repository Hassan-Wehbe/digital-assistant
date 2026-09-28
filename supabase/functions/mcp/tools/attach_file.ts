import { z } from "zod";
import { chunkAndEmbed, hasPending, scheduleEmbedPending } from "../lib/embed.ts";
import { loadSpaces, resolveSpace } from "../lib/spaces.ts";
import { addressedAs } from "../lib/assistant.ts";
import { NO_CREDENTIALS_IN_DESCRIPTIONS, uploadLink } from "../lib/attachments.ts";
import { dbError, guarded, ok, type RegisterTool } from "./_shared.ts";

const ASK_FIRST =
  "Ask the user where the file belongs before calling attach_file: an existing item (find it with " +
  "search_items), or a space plus what the file is (a title, and a short note if they have one).";

export const registerAttachFile: RegisterTool = (server, { db, accessToken, assistantName }) => {
  server.registerTool(
    "attach_file",
    {
      title: "Attach a file (upload link)",
      description:
        "Start attaching pictures (.jpg, .jpeg, .png) or Visio diagrams (.vsdx, .vsd) to an item. " +
        "Returns a one-time upload link (valid 15 minutes) where the user picks the file(s) on their " +
        "phone or PC; you cannot pass the file itself. Every upload needs a place and a reason: give " +
        "EITHER item_id (an existing item) OR space plus title (and a note if the user gave one), " +
        "which creates a new item first. If the user did not say where the file belongs or what it " +
        "is, ask them first; do not guess. When the picture is in this chat, pass a description " +
        "of what it shows (content, labels, text in the image) so it can be found by search later. " +
        NO_CREDENTIALS_IN_DESCRIPTIONS + addressedAs(assistantName, "attach this diagram to my Teams routing design"),
      inputSchema: {
        item_id: z.string().uuid().optional().describe("Attach to this existing item"),
        space: z.string().optional().describe("New item: space name, path (Work/Gartner) or id"),
        title: z.string().trim().min(1).max(300).optional().describe("New item: what the file is"),
        note: z.string().max(40_000).optional().describe("New item: the user's words about it, in Markdown"),
        item_type: z.string().trim().min(1).max(50).optional().describe("New item: design, photo, note, ... (default note)"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("New item: tags"),
        description: z.string().trim().max(4000).optional()
          .describe("What the picture shown in the chat contains, written by you; never a credential"),
      },
    },
    ({ item_id, space, title, note, item_type, tags, description }) =>
      guarded(async () => {
        if (item_id && (space || title || note || item_type || tags)) {
          throw new Error("Give either item_id (existing item) or space + title (new item), not both.");
        }
        if (!item_id && !(space && title)) {
          throw new Error(`No place or context for this file. ${ASK_FIRST}`);
        }

        let item: { id: string; title: string; space?: string; created: boolean };
        if (item_id) {
          const { data, error } = await db.rpc("get_item", { p_item_id: item_id });
          if (error) throw dbError("Could not load the item", error);
          if (!data) throw new Error("Item not found. Use search_items to find it.");
          const path = (await loadSpaces(db)).find((s) => s.id === data.space.id)?.path;
          item = { id: data.id, title: data.title, space: path, created: false };
        } else {
          const target = resolveSpace(await loadSpaces(db), space!);
          const body = note ?? "";
          const chunks = await chunkAndEmbed({ title: title!, body });
          const { data, error } = await db.rpc("save_item", {
            p_space_id: target.id,
            p_item_type: item_type ?? "note",
            p_title: title,
            p_body: body,
            p_summary: null,
            p_metadata: {},
            p_tags: tags ?? [],
            p_chunks: chunks,
          });
          if (error) throw dbError("Could not create the item", error);
          if (hasPending(chunks)) scheduleEmbedPending(accessToken);
          item = { id: data, title: title!, space: target.path, created: true };
        }

        const { data, error } = await db.rpc("create_attachment_upload", {
          p_item_id: item.id,
          p_description: description || null,
        });
        if (error) throw dbError("Could not create the upload link", error);
        return ok({
          status: "waiting_for_upload",
          upload_link: uploadLink(data.token),
          expires_at: data.expires_at,
          item,
          accepted: ".jpg, .jpeg, .png, .vsdx, .vsd; up to 10 files, 20 MB each",
          next_step:
            "Give the user the upload link. They pick the file(s) there (again, if the picture is " +
            "already in this chat: the chat cannot pass files on). Files are attached once they " +
            "press Upload; get_item then lists them." +
            (item.created ? " A new item was created for them." : ""),
        });
      }),
  );
};
