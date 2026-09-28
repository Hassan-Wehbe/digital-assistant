// The owner's name for the assistant (app_user.assistant_name, default "Wilma").
// It is the word the user addresses ("Wilma, save this recipe"); the server puts
// it into its instructions and a few tool descriptions so a message addressed to
// it is routed to these tools. The MCP server itself stays "digital-assistant".
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_ASSISTANT_NAME = "Wilma";

// Same rule as the database check (20260929100000_assistant_name.sql): a plain
// name, because it is copied into text the model reads.
export const ASSISTANT_NAME_PATTERN = /^\p{L}[\p{L} '’.-]{0,29}$/u;

/** The caller's assistant name; the default if it cannot be read. */
export async function loadAssistantName(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db.from("app_user").select("assistant_name").eq("id", userId).maybeSingle();
  const name = data?.assistant_name;
  if (error || typeof name !== "string" || !ASSISTANT_NAME_PATTERN.test(name)) return DEFAULT_ASSISTANT_NAME;
  return name;
}

export function serverInstructions(name: string): string {
  return `The user calls this assistant "${name}". A message that addresses ${name} ("${name}, …",
"Hey ${name}, …", "ask ${name} …") is meant for this store: act on it with these tools, for example
"${name}, save this recipe" → save_item, "${name}, what did I note about X?" → search_items,
"${name}, what's my Wi-Fi password?" → find_secret / get_secret. A name that merely appears in the
content (a note about someone called ${name}) is not a request. Rename only when the user explicitly
asks to (set_assistant_name).

This is the user's personal knowledge store, organized into spaces.
Save what the user asks you to remember with save_item (pick or create a fitting space; ask if unsure).
Answer questions from it with search_items, then get_item for the full text.
When a new item replaces an older one, save it and link_items(new, old, "supersedes").
Passwords, API keys, Wi-Fi passwords, recovery codes and other credentials go in the encrypted vault,
never in items: save_secret, find_secret, get_secret, update_secret, delete_secret.
The vault tools return links to a vault page where the user types or reads the value; you never see it.
Never ask the user to type a secret into the chat and never repeat one. If they paste one anyway,
do not store it: tell them it is exposed and should be changed, and offer save_secret for the new value.

Pictures (.jpg, .jpeg, .png) and Visio diagrams (.vsdx, .vsd) can be attached to items ("${name}, attach
this diagram to my Teams routing design", "${name}, save this whiteboard photo to Work, it's the routing
design"). Every upload needs a place and a reason: an existing item, or a space plus what the file is.
If either is missing, ask before calling attach_file. It returns an upload link where the user picks the
file on their phone or PC (the chat cannot pass files on). If the picture is in the chat, pass a
description of what it shows; never copy a password, key or code visible in it. get_item lists an item's
attachments; get_attachment_link gives the user a download link (do not open it yourself);
delete_attachment only after the user confirms.`;
}

/** One sentence appended to a tool description: how the user asks for it by name. */
export function addressedAs(name: string, example: string): string {
  return ` Use this when the user addresses ${name}, e.g. "${name}, ${example}".`;
}
