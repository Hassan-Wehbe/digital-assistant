// Favourite spaces (docs/home-cleanup-plan.md step 2, design D38): up to 6, in the order Home shows
// them, kept on the server (space_favourite; set_favourite_spaces replaces the whole list,
// my_favourite_spaces reads it back, both through RLS). A restricted space, one nested under a
// restricted space and the Tasks space can never be one (CLAUDE.md rule 3: Home never hints at
// them); the server refuses them too, and stops returning one restricted later.
import { hiddenSpaceIds, isTasksSpace } from './homeSpaces';
import type { Space } from './wilma';

export const MAX_FAVOURITES = 6;

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Whether a space may be offered the ☆. */
export function canBeFavourite(s: Space, spaces: Space[]): boolean {
  return !isTasksSpace(s) && !hiddenSpaceIds(spaces).has(s.id);
}

/** Ids kept from what the server returned (anything odd dropped, at most 6). */
export function parseFavourites(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return [...new Set(data.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, MAX_FAVOURITES);
}

/** Added at the end, or taken out. Adding a seventh is refused here, before the server is asked. */
export function toggleFavourite(list: string[], id: string): { list: string[]; error?: string } {
  if (list.includes(id)) return { list: list.filter((x) => x !== id) };
  if (list.length >= MAX_FAVOURITES) {
    return { list, error: `You can have at most ${MAX_FAVOURITES} favourites. Remove one in All spaces first.` };
  }
  return { list: [...list, id] };
}

/** One place up (-1) or down (+1); unchanged at either end. */
export function moveFavourite(list: string[], id: string, by: -1 | 1): string[] {
  const i = list.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** The saved list; null when it cannot be read (Home then shows the recent spaces). */
export async function loadFavourites(rpc: Rpc): Promise<string[] | null> {
  try {
    const { data, error } = await rpc('my_favourite_spaces');
    return error ? null : parseFavourites(data);
  } catch {
    return null;
  }
}

/** Saves the whole list; returns what the server kept, or throws its message ("That space cannot be a favourite."). */
export async function saveFavourites(rpc: Rpc, ids: string[]): Promise<string[]> {
  const { data, error } = await rpc('set_favourite_spaces', { p_ids: ids.slice(0, MAX_FAVOURITES) });
  if (error) throw new Error(error.message);
  return parseFavourites(data);
}
