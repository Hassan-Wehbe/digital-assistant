// Spaces on Home (owner, 2026-10-18, D38, docs/home-cleanup-plan.md): the owner's favourite spaces
// (up to 6, kept on the server, favourites.ts), in a small grid, then "All spaces". With no
// favourites yet (or when they cannot be read), the spaces opened most recently on this phone, as
// before (owner, 2026-10-09). The Tasks space is left out (the ✅ Tasks tile is the way to tasks,
// and opening it from All spaces goes to the Tasks screen). Restricted spaces, and spaces nested
// under one, are never shown on Home (CLAUDE.md rule 3); they are listed under All spaces, locked.
//
// What is kept on the phone: only the ids of spaces opened, newest first, per account; never a
// name or a space's contents. Forgotten on sign-out, like the chat thread.
import type { Space } from './wilma';

/** Spaces shown on Home (a 3-column grid of two rows; also the most favourites). */
export const HOME_SPACES = 6;
/** Ids remembered (more than shown, so a deleted space is replaced by the next). */
export const MAX_RECENT = 20;
const PREFIX = 'wilma.recentSpaces.';
export const recentKey = (userId: string) => `${PREFIX}${userId}`;

/** The Tasks space: the built-in one, or (an older server) a top-level, not restricted space named
 * Tasks (mcp/lib/tasks.ts tasksSpace). */
export const isTasksSpace = (s: Pick<Space, 'path' | 'restricted' | 'built_in'>) =>
  !s.restricted && (s.built_in === 'tasks' || (!s.built_in && s.path.trim().toLowerCase() === 'tasks'));

/** Opened now: first, once. */
export function rememberOpened(recent: string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
}

/** Restricted spaces and every space nested under one (paths are "Parent/Child"). */
export function hiddenSpaceIds(spaces: Pick<Space, 'id' | 'path' | 'restricted'>[]): Set<string> {
  const locked = spaces.filter((s) => s.restricted).map((s) => s.path.toLowerCase());
  return new Set(
    spaces
      .filter((s) => s.restricted || locked.some((p) => s.path.toLowerCase().startsWith(`${p}/`)))
      .map((s) => s.id),
  );
}

/** The favourites in order, as spaces; never a hidden one or Tasks, even if the server sent it. */
export function favouriteSpaces(spaces: Space[], ids: string[]): Space[] {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const hidden = hiddenSpaceIds(spaces);
  return ids.flatMap((id) => {
    const s = byId.get(id);
    return s && !hidden.has(id) && !isTasksSpace(s) ? [s] : [];
  });
}

/**
 * What Home shows: the favourites when there are any (`favourites: true`); otherwise the recently
 * opened spaces, filled up alphabetically to HOME_SPACES. Never the Tasks space, a restricted one or
 * one under a restricted space. `more`: spaces All spaces lists that Home does not show.
 */
export function homeSpaces(
  spaces: Space[],
  recent: string[],
  favourites: string[] | null = null,
): { shown: Space[]; total: number; more: number; favourites: boolean } {
  const total = spaces.filter((s) => !isTasksSpace(s)).length;
  const favs = favouriteSpaces(spaces, favourites ?? []).slice(0, HOME_SPACES);
  if (favs.length) return { shown: favs, total, more: total - favs.length, favourites: true };
  const hidden = hiddenSpaceIds(spaces);
  const browsable = spaces.filter((s) => !hidden.has(s.id) && !isTasksSpace(s));
  const byId = new Map(browsable.map((s) => [s.id, s]));
  const opened = recent.flatMap((id) => byId.get(id) ?? []);
  const rest = browsable.filter((s) => !opened.includes(s)).sort((a, b) => a.path.localeCompare(b.path));
  const shown = [...opened, ...rest].slice(0, HOME_SPACES);
  return { shown, total, more: total - shown.length, favourites: false };
}

/** The ids kept, checked (anything odd is dropped). */
export function parseRecent(text: string | null): string[] {
  try {
    const raw = text ? (JSON.parse(text) as unknown) : [];
    return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export interface RecentSpacesStore {
  load(userId: string): Promise<string[]>;
  save(userId: string, ids: string[]): Promise<void>;
  /** Forgets every account's list except the signed-in one (all of them when signed out). */
  forgetOthers(userId: string | null): Promise<void>;
}

export function recentSpacesStore(kv: {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  keys(): Promise<string[]>;
}): RecentSpacesStore {
  return {
    load: async (userId) => parseRecent(await kv.get(recentKey(userId)).catch(() => null)),
    save: (userId, ids) => kv.set(recentKey(userId), JSON.stringify(ids.slice(0, MAX_RECENT))),
    async forgetOthers(userId) {
      const keys = await kv.keys().catch(() => [] as string[]);
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && (!userId || k !== recentKey(userId))).map((k) => kv.remove(k).catch(() => {})));
    },
  };
}
