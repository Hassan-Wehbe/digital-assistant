// Attachment helpers for the MCP tools (docs/phase2-attachments-plan.md).
// Files never pass through the chat or this server: attach_file returns a
// one-time upload link, and the owner's browser sends the file straight to the
// private `attachments` Storage bucket (docs/files/upload.html).
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "attachments";
/** Download links stay valid this long (seconds). */
export const DOWNLOAD_LINK_SECONDS = 600;

/** Where the upload page is served (GitHub Pages); override with FILES_PAGE_URL. */
export function filesPageUrl(): string {
  const url = Deno.env.get("FILES_PAGE_URL") ?? "https://hassan-wehbe.github.io/digital-assistant/files";
  return url.replace(/\/$/, "");
}

// The token goes in the fragment (#t=...), which browsers never send to a server.
export const uploadLink = (token: string) => `${filesPageUrl()}/upload#t=${token}`;

export const NO_CREDENTIALS_IN_DESCRIPTIONS =
  "Never copy a password, API key, recovery code or other credential that is visible in a " +
  "picture into a description; say only that one is shown, and suggest the vault (save_secret).";

export interface AttachmentRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  caption: string | null;
  description: string | null;
  storage_key: string;
  created_at: string;
  item: { id: string; title: string };
}

/** One attachment the caller owns (RLS), with its item; throws a readable error otherwise. */
export async function attachmentById(db: SupabaseClient, id: string): Promise<AttachmentRow> {
  const { data, error } = await db.rpc("get_attachment", { p_attachment_id: id });
  if (error) throw new Error(`Could not load the attachment: ${error.message}`);
  if (!data) throw new Error("Attachment not found. Use get_item to list an item's attachments.");
  return data as AttachmentRow;
}

/** The attachment as shown to the model: no storage path. */
export function describeAttachment(a: AttachmentRow) {
  const { storage_key: _key, ...rest } = a;
  return rest;
}
