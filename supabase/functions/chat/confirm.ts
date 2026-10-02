// Deleting asks first, in the app (docs/phase5-a5b-chat-function-plan.md, "How it works" 5).
// When the model calls a delete tool, chat never runs it: it looks up what would be deleted
// (read-only, as the user), sends the app a confirm card, and tells the model it is waiting for
// the user. If the user taps Delete, the app runs that one tool itself. A model can never
// delete on its own.
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentById } from "../mcp/lib/attachments.ts";
import { loadSpaces, resolveSpace } from "../mcp/lib/spaces.ts";
import { secretById } from "../mcp/lib/vault.ts";
import type { ToolSession } from "./tools.ts";

export const CONFIRM_TOOLS = new Set(["delete_item", "purge_item", "delete_space", "delete_secret", "delete_attachment"]);

export interface ConfirmCard {
  type: "confirm";
  /** The tool the app runs if the user taps Delete, with exactly these arguments. */
  tool: string;
  args: Record<string, string>;
  target: { id: string; title: string };
  message: string;
  confirm_label: "Delete";
  cancel_label: "Cancel";
}

export type ConfirmOutcome =
  | { card: ConfirmCard; toModel: string }
  | { card?: undefined; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`${key} must be an id (uuid).`);
  return v;
}

function card(tool: string, args: Record<string, string>, id: string, title: string, message: string): ConfirmOutcome {
  return {
    card: { type: "confirm", tool, args, target: { id, title }, message, confirm_label: "Delete", cancel_label: "Cancel" },
    toModel: JSON.stringify({
      status: "waiting_for_user",
      message: `Not done yet. The app is showing the user a Delete button for "${title}"; it happens only ` +
        "if they tap it. Tell them in one short sentence to tap Delete to confirm (or Cancel). Do not call " +
        "this tool again for it.",
    }),
  };
}

/** Look up what the delete would remove and build the card; an error goes back to the model. */
export async function confirmCard(
  tool: string,
  args: Record<string, unknown>,
  tools: ToolSession,
  db: SupabaseClient,
): Promise<ConfirmOutcome> {
  try {
    switch (tool) {
      case "delete_item": {
        const item_id = uuidArg(args, "item_id");
        const out = await tools.call("get_item", { item_id });
        if (out.isError) return { error: out.text };
        const title = String(JSON.parse(out.text).title);
        return card(tool, { item_id }, item_id, title, `Move "${title}" to the recycle bin?`);
      }
      case "purge_item": {
        const item_id = uuidArg(args, "item_id");
        const out = await tools.call("list_deleted_items", { limit: 200 });
        if (out.isError) return { error: out.text };
        const hit = (JSON.parse(out.text).items as { id: string; title: string }[]).find((i) => i.id === item_id);
        if (!hit) return { error: "That item is not in the recycle bin." };
        return card(tool, { item_id }, item_id, hit.title, `Delete "${hit.title}" for good? This cannot be undone.`);
      }
      case "delete_space": {
        if (typeof args.space !== "string" || !args.space.trim()) throw new Error("space is required.");
        const space = resolveSpace(await loadSpaces(db), args.space);
        return card(tool, { space: space.id }, space.id, space.path, `Delete the empty space "${space.path}"?`);
      }
      case "delete_secret": {
        const secret_id = uuidArg(args, "secret_id");
        const name = String((await secretById(db, secret_id)).name);
        return card(
          tool, { secret_id }, secret_id, name, `Delete the vault entry "${name}" for good? This cannot be undone.`,
        );
      }
      case "delete_attachment": {
        const attachment_id = uuidArg(args, "attachment_id");
        const a = await attachmentById(db, attachment_id);
        return card(
          tool, { attachment_id }, attachment_id, a.filename,
          `Delete the file "${a.filename}" from "${a.item.title}"? This cannot be undone.`,
        );
      }
      default:
        return { error: `${tool} is not a delete tool.` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
