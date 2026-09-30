// Checking the "New space" form before asking Wilma (create_space has the same limits).
import type { NewSpace } from './wilma';

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
