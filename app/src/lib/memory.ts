// Automatic memory in the app (docs/memory-plan.md step 3): the on/off switch (app_user.memory_on,
// off by default, Q3), the one-time card on Home, the "🧠 Remembered · Undo" line under a reply,
// and the built-in Tasks and Memories spaces (Q8: marked BUILT-IN, never deleted or renamed; the
// server refuses that anyway). Pure logic: the screens call these.

import type { Space } from './wilma';

// ---- The switch ------------------------------------------------------------------------------

/** The part of the Supabase client used here (so the tests need no network). */
export interface MemoryDb {
  from(table: 'app_user'): {
    select(columns: 'memory_on'): {
      eq(column: 'id', value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
    };
    update(values: { memory_on: boolean }): {
      eq(column: 'id', value: string): {
        select(columns: 'memory_on'): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
  };
}

const onOf = (data: unknown): boolean | null => {
  const v = (data as { memory_on?: unknown } | null)?.memory_on;
  return typeof v === 'boolean' ? v : null;
};

/** Memory on for this account; false when it was never turned on; null when it cannot be read. */
export async function loadMemoryOn(db: MemoryDb, userId: string): Promise<boolean | null> {
  if (!userId) return null;
  try {
    const { data, error } = await db.from('app_user').select('memory_on').eq('id', userId).maybeSingle();
    if (error) return null;
    return onOf(data) ?? false;
  } catch {
    return null;
  }
}

/** Turns memory on or off; true only when the database confirms it. */
export async function saveMemoryOn(db: MemoryDb, userId: string, on: boolean): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await db.from('app_user').update({ memory_on: on }).eq('id', userId).select('memory_on').maybeSingle();
    return !error && onOf(data) === on;
  } catch {
    return false;
  }
}

// ---- The one-time card on Home ---------------------------------------------------------------

/** Closed (Turn on or Not now) for this account on this phone. */
export const memoryCardKey = (userId: string) => `wilma.memoryCard.v1.${userId}`;

/** The card shows while memory is off and the card was never closed on this phone. */
export const showMemoryCard = (on: boolean | null, closed: boolean) => on === false && !closed;

// ---- "🧠 Remembered · Undo" ------------------------------------------------------------------

export interface RememberedMemory {
  id: string;
  fact: string;
  /** It changed an older memory, whose text was `was` (Undo puts it back). */
  updated: boolean;
  was?: string;
}

/** The server sends at most 3 per answer, each one short fact. */
export const MAX_REMEMBERED = 3;
export const MAX_FACT = 200;

const fact = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_FACT;

/** The server's list, copied field by field; anything malformed is left out. */
export function toRemembered(raw: unknown): RememberedMemory[] {
  if (!Array.isArray(raw)) return [];
  const out: RememberedMemory[] = [];
  for (const m of raw) {
    if (typeof m !== 'object' || m === null) continue;
    const r = m as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || r.id.length > 100 || !fact(r.fact)) continue;
    const updated = r.updated === true;
    out.push({ id: r.id, fact: r.fact, updated, ...(updated && fact(r.was) ? { was: r.was } : {}) });
  }
  return out.slice(0, MAX_REMEMBERED);
}

/** What Undo needs from the app's connection to Wilma. */
export interface UndoApi {
  deleteItem(id: string): Promise<unknown>;
  updateItem(id: string, changes: { title: string }): Promise<unknown>;
}

/**
 * Undo: a new memory goes to the Recycle bin; a changed one gets its old text back (the server
 * keeps the newer text as a revision, rule 7). Throws when it did not work.
 */
export async function undoMemory(api: UndoApi, m: RememberedMemory): Promise<void> {
  if (m.updated && m.was) await api.updateItem(m.id, { title: m.was });
  else await api.deleteItem(m.id);
}

// ---- Built-in spaces -------------------------------------------------------------------------

export const isBuiltIn = (s: Pick<Space, 'built_in'>) => s.built_in === 'tasks' || s.built_in === 'memories';

/** The account's Memories space, from list_spaces. */
export const memoriesSpace = (spaces: Space[]): Space | undefined => spaces.find((s) => s.built_in === 'memories' && !s.restricted);

/** A space's row title: ✅ Tasks, 🧠 Memories, others as they are. */
export function spaceTitle(s: Pick<Space, 'path' | 'built_in'>): string {
  if (s.built_in === 'tasks') return `✅ ${s.path}`;
  if (s.built_in === 'memories') return `🧠 ${s.path}`;
  return s.path;
}

/** The line Edit space and the space's screen show for a built-in space. */
export const BUILT_IN_LINE = 'Built-in space: it can’t be deleted or renamed.';
