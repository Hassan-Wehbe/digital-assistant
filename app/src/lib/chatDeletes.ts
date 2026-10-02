// What a delete card in the chat may run when Delete is tapped (docs/phase5-a5c-chat-screen-plan.md
// "Deletes (the confirm card)"). The server never deletes in chat: it sends a card naming a tool
// and its arguments, and the app runs it itself, with the signed-in user's own client.
//
// The stream is never trusted to choose what runs: only the five tools below, each mapped to a
// fixed client method and a fixed argument name. A card's `args` must be exactly that one
// argument, a UUID, equal to `target.id` (the thing the card names). Anything else is refused
// and nothing runs. Pure logic: the client methods are passed in, so the tests need no phone.

/** The card's text when it is refused. */
export const CANT_DO = "I can't do that from here.";

/** The existing client methods a delete card can reach (wilma.ts, and the vault's own remove). */
export interface DeleteRunners {
  deleteItem(id: string): Promise<unknown>;
  purgeItem(id: string): Promise<unknown>;
  deleteSpace(id: string): Promise<unknown>;
  deleteAttachment(id: string): Promise<unknown>;
  /** vault.remove: the same call as the secret screen's Delete (needs the vault unlocked). */
  removeSecret(id: string): Promise<unknown>;
}

const DELETE_TOOLS = {
  delete_item: { arg: 'item_id', run: (r: DeleteRunners, id: string) => r.deleteItem(id) },
  purge_item: { arg: 'item_id', run: (r: DeleteRunners, id: string) => r.purgeItem(id) },
  delete_space: { arg: 'space', run: (r: DeleteRunners, id: string) => r.deleteSpace(id) },
  delete_attachment: { arg: 'attachment_id', run: (r: DeleteRunners, id: string) => r.deleteAttachment(id) },
  delete_secret: { arg: 'secret_id', run: (r: DeleteRunners, id: string) => r.removeSecret(id) },
} as const;

type DeleteTool = keyof typeof DELETE_TOOLS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The parts of a confirm card that decide what runs. */
export interface DeleteCard {
  tool: string;
  args: Record<string, unknown>;
  target: { id: string };
}

/** The one delete a card asks for, or null when the app must refuse it. */
export function checkDelete(card: DeleteCard): { tool: DeleteTool; id: string } | null {
  // Own keys only, so names like "constructor" or "__proto__" never reach the table's prototype.
  if (!Object.hasOwn(DELETE_TOOLS, card.tool)) return null;
  const tool = card.tool as DeleteTool;
  const keys = Object.keys(card.args);
  if (keys.length !== 1 || keys[0] !== DELETE_TOOLS[tool].arg) return null;
  const id = card.args[keys[0]];
  if (typeof id !== 'string' || !UUID.test(id) || id !== card.target.id) return null;
  return { tool, id };
}

/** Deleting a vault entry needs the vault unlocked on the phone first. */
export function needsVault(card: DeleteCard): boolean {
  return checkDelete(card)?.tool === 'delete_secret';
}

/** Runs the card's one delete; a refused card throws and runs nothing. */
export async function runDelete(card: DeleteCard, runners: DeleteRunners): Promise<void> {
  const ok = checkDelete(card);
  if (!ok) throw new Error(CANT_DO);
  await DELETE_TOOLS[ok.tool].run(runners, ok.id);
}

/** The assistant's short follow-ups, added to the thread without asking the model. */
export const deletedMessage = (title: string) => `Deleted "${title}".`;
export const cancelledMessage = (title: string) => `Okay, I left "${title}" alone.`;
