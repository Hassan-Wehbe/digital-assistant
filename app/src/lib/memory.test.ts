import { describe, expect, it } from '@jest/globals';

import {
  BUILT_IN_LINE, isBuiltIn, loadMemoryOn, MAX_REMEMBERED, memoriesSpace, type MemoryDb, saveMemoryOn, showMemoryCard,
  spaceTitle, toRemembered, undoMemory,
} from './memory';
import type { Space } from './wilma';

/** app_user as the database sees it: one row; `fail` makes every call an error. */
function db(row: { memory_on: unknown } | null, fail = false): MemoryDb & { updates: unknown[] } {
  const updates: unknown[] = [];
  const result = () => Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: row, error: null });
  return {
    updates,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: result }) }),
      update: (values: { memory_on: boolean }) => {
        updates.push(values);
        if (row && !fail) row.memory_on = values.memory_on;
        return { eq: () => ({ select: () => ({ maybeSingle: result }) }) };
      },
    }),
  };
}

const sp = (path: string, extra: Partial<Space> = {}): Space => ({ id: path, path, description: null, restricted: false, ...extra });

describe('memory switch', () => {
  it('reads on, off (also never set), and null when it cannot be read', async () => {
    expect(await loadMemoryOn(db({ memory_on: true }), 'u1')).toBe(true);
    expect(await loadMemoryOn(db({ memory_on: false }), 'u1')).toBe(false);
    expect(await loadMemoryOn(db(null), 'u1')).toBe(false);
    expect(await loadMemoryOn(db({ memory_on: true }, true), 'u1')).toBeNull();
    expect(await loadMemoryOn(db({ memory_on: true }), '')).toBeNull();
  });

  it('saves only when the database confirms it', async () => {
    const d = db({ memory_on: false });
    expect(await saveMemoryOn(d, 'u1', true)).toBe(true);
    expect(d.updates).toEqual([{ memory_on: true }]);
    expect(await saveMemoryOn(db({ memory_on: false }, true), 'u1', true)).toBe(false);
    expect(await saveMemoryOn(db(null), 'u1', true)).toBe(false);
  });

  it('the Home card shows only while memory is off and the card was never closed', () => {
    expect(showMemoryCard(false, false)).toBe(true);
    expect(showMemoryCard(true, false)).toBe(false);
    expect(showMemoryCard(false, true)).toBe(false);
    expect(showMemoryCard(null, false)).toBe(false); // unreadable: never nag
  });
});

describe('remembered memories', () => {
  it('copies the server list field by field, at most three, dropping anything malformed', () => {
    expect(toRemembered([
      { id: 'a', fact: 'Lexi swims on Tuesdays', updated: false, extra: 'x' },
      { id: 'b', fact: 'Plumber is Mike', updated: true, was: 'Plumber is Joe' },
      { id: 'c', fact: '', updated: false },
      { fact: 'no id' },
      { id: 'd', fact: 'x'.repeat(201) },
      { id: 'e', fact: 'Prefers aisle seats', updated: false, was: 'ignored when not updated' },
    ])).toEqual([
      { id: 'a', fact: 'Lexi swims on Tuesdays', updated: false },
      { id: 'b', fact: 'Plumber is Mike', updated: true, was: 'Plumber is Joe' },
      { id: 'e', fact: 'Prefers aisle seats', updated: false },
    ]);
    expect(toRemembered(Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, fact: `Fact ${i}` }))).length).toBe(MAX_REMEMBERED);
    expect(toRemembered('nope')).toEqual([]);
  });

  it('Undo deletes a new memory, and gives a changed one its old text back', async () => {
    const calls: unknown[] = [];
    const api = {
      deleteItem: async (id: string) => void calls.push(['delete', id]),
      updateItem: async (id: string, ch: { title: string }) => void calls.push(['update', id, ch]),
    };
    await undoMemory(api, { id: 'a', fact: 'Lexi swims on Tuesdays', updated: false });
    await undoMemory(api, { id: 'b', fact: 'Plumber is Mike', updated: true, was: 'Plumber is Joe' });
    // A changed memory whose old text is not known: deleted rather than left wrong.
    await undoMemory(api, { id: 'c', fact: 'Something', updated: true });
    expect(calls).toEqual([['delete', 'a'], ['update', 'b', { title: 'Plumber is Joe' }], ['delete', 'c']]);
    await expect(undoMemory({ ...api, deleteItem: () => Promise.reject(new Error('offline')) }, { id: 'a', fact: 'x y', updated: false })).rejects.toThrow('offline');
  });
});

describe('built-in spaces', () => {
  it('are marked, titled with their icon, and Memories is found', () => {
    const spaces = [sp('Tasks', { built_in: 'tasks' }), sp('Memories', { built_in: 'memories' }), sp('Recipes')];
    expect(spaces.map(isBuiltIn)).toEqual([true, true, false]);
    expect(spaces.map(spaceTitle)).toEqual(['✅ Tasks', '🧠 Memories', 'Recipes']);
    expect(memoriesSpace(spaces)?.path).toBe('Memories');
    // A user's own space called Memories is not the built-in one.
    expect(memoriesSpace([sp('Memories')])).toBeUndefined();
    expect(BUILT_IN_LINE).toContain('can’t be deleted or renamed');
  });
});
