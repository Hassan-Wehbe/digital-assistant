// Editing a note's title, text and space (the server's update_item keeps the previous version in the
// note's history first, and refuses anything that looks like a credential: CLAUDE.md rules 7, 9).

import type { NoteChanges } from './wilma';

export const MAX_TITLE = 300;
export const MAX_BODY = 40_000;

/**
 * What to send: only what changed (the title trimmed), or why it cannot be saved. Nothing to
 * change is `{ changes: {} }`.
 */
export function noteChanges(
  current: { title: string; body: string | null; spaceId?: string },
  edited: { title: string; body: string; spaceId?: string },
): { changes: NoteChanges } | { error: string } {
  const title = edited.title.trim();
  if (!title) return { error: 'Give the note a title.' };
  if (title.length > MAX_TITLE) return { error: `The title can be at most ${MAX_TITLE} characters.` };
  if (edited.body.length > MAX_BODY) return { error: `The note can be at most ${MAX_BODY.toLocaleString('en-US')} characters.` };
  const changes: NoteChanges = {};
  if (title !== current.title) changes.title = title;
  if (edited.body !== (current.body ?? '')) changes.body = edited.body;
  if (edited.spaceId && edited.spaceId !== current.spaceId) changes.space = edited.spaceId;
  return { changes };
}

/** The server's rule 9 refusal is written for the model; the person gets a plain sentence. */
export const LOOKS_LIKE_SECRET =
  'This looks like it holds a password or another secret, so it was not saved. Notes are searchable: keep it in the Vault instead.';

export function editError(message: string): string {
  return /^Not saved: the \w+ looks like it contains/.test(message) ? LOOKS_LIKE_SECRET : message;
}
