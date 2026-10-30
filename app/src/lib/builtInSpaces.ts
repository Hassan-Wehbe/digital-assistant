// One kind per built-in space (docs/places-space-plan.md step 3; owner 2026-10-29: "if I am adding a
// note to Places, I should be adding a place note; same for the built-in spaces"). A built-in space
// and its sub-spaces (Recipes/Desserts) hold one kind: its ＋ adds that kind, and New note uses it
// without the Note / Place / Recipe choice. The server keeps a plain note saved there as that kind
// too (save_item, step 2b). Also Home's "Your spaces" row (Q2 B): Wilma's own spaces, one tap each.
import type { Space } from './wilma';

export type BuiltIn = 'tasks' | 'places' | 'recipes' | 'cocktails' | 'memories';
const BUILT_INS: readonly BuiltIn[] = ['tasks', 'places', 'recipes', 'cocktails', 'memories'];

/** The built-in space `space` is or is under ("Recipes/Desserts" → recipes); null for the user's own and shared spaces. */
export function builtInOf(space: Pick<Space, 'path' | 'built_in'> | undefined, spaces: readonly Pick<Space, 'path' | 'built_in'>[]): BuiltIn | null {
  if (!space) return null;
  if (space.built_in && (BUILT_INS as readonly string[]).includes(space.built_in)) return space.built_in as BuiltIn;
  const top = spaces.find((s) => s.built_in && (BUILT_INS as readonly string[]).includes(s.built_in) && space.path.startsWith(`${s.path}/`));
  return top ? (top.built_in as BuiltIn) : null;
}

/** What the ＋ on a built-in space adds: "＋ New place". Drinks follow the space's name (Mocktails under 21). */
export function addTitle(b: BuiltIn, path: string): string {
  if (b === 'tasks') return '＋ New task';
  if (b === 'places') return '＋ New place';
  if (b === 'recipes') return '＋ New recipe';
  if (b === 'cocktails') return /^mocktails\b/i.test(path) ? '＋ New mocktail' : '＋ New cocktail';
  return '＋ Remember something';
}

/** Home's "Your spaces": Tasks, Places, Recipes, Cocktails, and Memories only when memory is on. */
export function yourSpaces<T extends Pick<Space, 'built_in' | 'restricted' | 'path'>>(spaces: readonly T[], memoryOn: boolean): T[] {
  const top = (b: BuiltIn) => spaces.find((s) => s.built_in === b && !s.restricted && !s.path.includes('/'));
  return BUILT_INS.filter((b) => b !== 'memories' || memoryOn)
    .map(top)
    .filter((s): s is T => !!s);
}

/**
 * The spaces New note offers when opened from inside a built-in space (owner, 2026-10-30: "if I am
 * creating a note inside Places, why am I shown other spaces?"): that space and its own sub-spaces
 * only. Null when it was not opened from one (every space is offered, as before).
 */
export function spacesWithin<T extends Pick<Space, 'id' | 'path' | 'built_in'>>(fromId: string | undefined, spaces: readonly T[]): T[] | null {
  const from = spaces.find((s) => s.id === fromId);
  const b = builtInOf(from, spaces);
  return b ? spaces.filter((s) => builtInOf(s, spaces) === b) : null;
}
