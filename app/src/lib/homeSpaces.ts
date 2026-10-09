// Spaces on Home (owner, 2026-10-09): the five spaces opened most recently on this phone, then
// "See all spaces". The Tasks space is left out (the ✅ Tasks tile is the way to tasks, and opening
// it from See all goes to the Tasks screen). Restricted spaces are never among the recent ones, so
// Home never hints at them (CLAUDE.md rule 3); they are listed under See all, as before.
//
// What is kept: only the ids of spaces opened, newest first, per account, on this phone; never a
// name or a space's contents. Forgotten on sign-out, like the chat thread.
import type { Space } from './wilma';

/** Spaces shown on Home. */
export const HOME_SPACES = 5;
/** Ids remembered (more than shown, so a deleted space is replaced by the next). */
export const MAX_RECENT = 20;
const PREFIX = 'wilma.recentSpaces.';
export const recentKey = (userId: string) => `${PREFIX}${userId}`;

/** The Tasks space (a top-level, not restricted space named Tasks; mcp/lib/tasks.ts tasksSpace). */
export const isTasksSpace = (s: Pick<Space, 'path' | 'restricted'>) => !s.restricted && s.path.trim().toLowerCase() === 'tasks';

/** Opened now: first, once. */
export function rememberOpened(recent: string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
}

/**
 * What Home shows: the recently opened spaces, filled up alphabetically to HOME_SPACES; never the
 * Tasks space or a restricted one. `more`: spaces See all lists that Home does not show.
 */
export function homeSpaces(spaces: Space[], recent: string[]): { shown: Space[]; total: number; more: number } {
  const browsable = spaces.filter((s) => !s.restricted && !isTasksSpace(s));
  const byId = new Map(browsable.map((s) => [s.id, s]));
  const opened = recent.flatMap((id) => byId.get(id) ?? []);
  const rest = browsable.filter((s) => !opened.includes(s)).sort((a, b) => a.path.localeCompare(b.path));
  const shown = [...opened, ...rest].slice(0, HOME_SPACES);
  const total = spaces.filter((s) => !isTasksSpace(s)).length;
  return { shown, total, more: total - shown.length };
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
