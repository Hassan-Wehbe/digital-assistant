// What the app shows: the decided messages for limits and errors (docs/phase5-chat-plan.md
// "What users see when a limit is hit"), the short status lines while a tool runs, and the
// confirm-card wording for deletes. No conversation text is ever built into a log line here.

export const ALLOWANCE_LOW = "You've used most of this month's requests.";

/** `month` is the allowance month from my_ai_allowance(), e.g. "2026-10-01". */
export function allowanceUsed(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const next = Number.isFinite(y) && Number.isFinite(m) ? new Date(Date.UTC(y, m, 1)) : null;
  const when = next
    ? `on ${next.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} 1`
    : "on the 1st of next month";
  return `You've used this month's AI requests. They reset ${when}. Search, notes and your vault still work.`;
}

export const SERVICE_PAUSED =
  "I can't think right now: my AI service is paused. Your notes, search and passwords still work.";

export const CONNECTION_TROUBLE = "I'm having trouble connecting. Try again in a moment.";

/** The reply when the new message looks like a password (no model call; plan step 7). Names the
 * kind, never the value. Plain text, so every app version shows it as Wilma's answer. */
export function heldText(kind: string): string {
  const what = `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
  return (
    `That message looks like it holds ${what}, so I didn't send it to the AI and didn't save it. ` +
    "Passwords, PINs and keys go in your vault: open the Vault and tap Save a new secret. " +
    "If it's a real password, it's worth changing it, since it was typed into the chat."
  );
}

/** Stands in for an earlier message that looked like it held a password. */
export const REMOVED_TEXT = "(Removed: this message looked like it held a password, so it was not sent.)";

export const TOO_MANY_STEPS = "I couldn't finish that in one go. Try asking in smaller steps.";

/** Error codes the app switches on: allowance_used (usage bar), service_paused (Search and
 * Vault buttons, owner notice), connection (Try again button). */
export type ChatErrorCode = "allowance_used" | "service_paused" | "connection";

export const ERROR_TEXT: Record<Exclude<ChatErrorCode, "allowance_used">, string> = {
  service_paused: SERVICE_PAUSED,
  connection: CONNECTION_TROUBLE,
};

/** Shown in the thread while a tool runs. Delete tools have none: they become confirm cards. */
export const STATUS: Record<string, string> = {
  list_spaces: "Checking your spaces…",
  create_space: "Creating the space…",
  update_space: "Updating the space…",
  save_item: "Saving…",
  update_item: "Updating your note…",
  get_item: "Reading your note…",
  search_items: "Searching your notes…",
  find_places: "Looking for places nearby…",
  find_tasks: "Checking your tasks…",
  get_day_agenda: "Reading your calendar…",
  link_items: "Linking your notes…",
  save_secret: "Preparing your vault…",
  find_secret: "Looking in your vault…",
  get_secret: "Getting a vault link…",
  update_secret: "Updating your vault…",
  set_assistant_name: "Changing my name…",
  attach_file: "Preparing the upload…",
  get_attachment_link: "Getting the file…",
  describe_attachment: "Saving the description…",
  list_deleted_items: "Checking the recycle bin…",
  restore_item: "Restoring…",
};

export const STATUS_DEFAULT = "Working…";
