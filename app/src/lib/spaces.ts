// Checking the "New space" and "Edit space" forms before asking Wilma (create_space and
// update_space have the same limits).
import type { NewSpace, SpaceChanges } from './wilma';

export const SPACE_NAME_MAX = 100;
export const SPACE_DESCRIPTION_MAX = 500;

/** The form's values as create_space arguments; throws a message to show when one is not allowed. */
export function newSpace(form: { name: string; parent?: string | null; description?: string; restricted?: boolean }): NewSpace {
  const name = form.name.trim();
  if (!name) throw new Error('Give the space a name.');
  if (name.length > SPACE_NAME_MAX) throw new Error(`Use at most ${SPACE_NAME_MAX} characters for the name.`);
  if (name.includes('/')) throw new Error('A space name cannot contain "/". To put it inside another space, choose that space below.');
  const description = form.description?.trim() ?? '';
  if (description.length > SPACE_DESCRIPTION_MAX) throw new Error(`Use at most ${SPACE_DESCRIPTION_MAX} characters for the description.`);
  return {
    name,
    ...(form.parent ? { parent: form.parent } : {}),
    ...(description ? { description } : {}),
    ...(form.restricted ? { restricted: true } : {}),
  };
}

/** A space's own name: the last part of its path ("Work/Gartner" → "Gartner"). */
export const spaceName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Edit space: only what changed (name and description; never restricted or where it sits), or
 * why it cannot be saved. Nothing to change is `{ changes: {} }`.
 */
export function spaceChanges(
  current: { path: string; description: string | null },
  form: { name: string; description: string },
): { changes: SpaceChanges } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Give the space a name.' };
  if (name.length > SPACE_NAME_MAX) return { error: `Use at most ${SPACE_NAME_MAX} characters for the name.` };
  if (name.includes('/')) return { error: 'A space name cannot contain "/".' };
  const description = form.description.trim();
  if (description.length > SPACE_DESCRIPTION_MAX) return { error: `Use at most ${SPACE_DESCRIPTION_MAX} characters for the description.` };
  const changes: SpaceChanges = {};
  if (name !== spaceName(current.path)) changes.name = name;
  if (description !== (current.description ?? '').trim()) changes.description = description;
  return { changes };
}
