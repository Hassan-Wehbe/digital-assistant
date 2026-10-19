// Tasks → Routines (routines step 3b): a routine's schedule read back, its words, its periods (the
// same as the server's), how it is going, and the tab's loader.
import { describe, expect, it } from '@jest/globals';

import { loadRoutines, periodOn, repeatingAlone, routineCard, routineWords, toRoutine, type RoutineMetadata, type RoutinesReader } from './routines';
import { toTaskRows, type TaskRow } from './tasks';

const weekly = (extra: Partial<RoutineMetadata> = {}): RoutineMetadata => ({ repeat: 'weekly', when: 'any_day', starts_on: '2026-10-01', suggest: true, ...extra });
const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow => ({ id, title: id, space: 'Tasks', status: 'open', priority: 'normal', ...extra });

describe('a routine’s schedule', () => {
  it('reads each kind', () => {
    expect(toRoutine({ repeat: 'weekly', when: 'same_day', day: 6, starts_on: '2026-10-01', suggest: false })).toEqual({
      repeat: 'weekly', when: 'same_day', day: 6, starts_on: '2026-10-01', suggest: false,
    });
    expect(toRoutine({ repeat: 'monthly', when: 'by_day', day: 28 })).toEqual({ repeat: 'monthly', when: 'by_day', day: 28, suggest: true });
    expect(toRoutine({ repeat: 'biweekly' })).toEqual({ repeat: 'biweekly', when: 'any_day', suggest: true });
  });

  it('is null for anything else', () => {
    for (const bad of [null, 'weekly', [], { repeat: 'daily' }, { repeat: 'monthly', when: 'same_day', day: 3 }, { repeat: 'weekly', when: 'by_day', day: 3 },
      { repeat: 'weekly', when: 'same_day', day: 7 }, { repeat: 'monthly', when: 'by_day', day: 0 }, { repeat: 'weekly', when: 'same_day' }]) {
      expect(toRoutine(bad)).toBeNull();
    }
  });

  it('says it in the server’s words', () => {
    expect(routineWords(weekly({ when: 'same_day', day: 6 }))).toBe('Every Saturday');
    expect(routineWords(weekly({ repeat: 'biweekly', when: 'same_day', day: 1 }))).toBe('Every other Monday');
    expect(routineWords(weekly())).toBe('Any day each week');
    expect(routineWords(weekly({ repeat: 'biweekly' }))).toBe('Any day each two weeks');
    expect(routineWords(weekly({ repeat: 'monthly' }))).toBe('Any day each month');
    expect(routineWords(weekly({ repeat: 'monthly', when: 'by_day', day: 22 }))).toBe('By the 22nd each month');
  });
});

describe('periods (as the server works them out)', () => {
  it('a week runs Sunday to Saturday', () => {
    expect(periodOn(weekly(), '2026-10-19')).toEqual({ window_from: '2026-10-18', due_on: '2026-10-24' });
  });
  it('the same day each time: that day, or next week’s once it has passed', () => {
    expect(periodOn(weekly({ when: 'same_day', day: 6 }), '2026-10-19')).toEqual({ window_from: '2026-10-24', due_on: '2026-10-24' });
    expect(periodOn(weekly({ when: 'same_day', day: 1 }), '2026-10-20')).toEqual({ window_from: '2026-10-26', due_on: '2026-10-26' });
  });
  it('every two weeks keeps the weeks of its start', () => {
    const r = weekly({ repeat: 'biweekly', starts_on: '2026-10-04' });
    expect(periodOn(r, '2026-10-19')).toEqual({ window_from: '2026-10-18', due_on: '2026-10-31' });
    expect(periodOn(r, '2026-10-14')).toEqual({ window_from: '2026-10-04', due_on: '2026-10-17' });
  });
  it('a month, and "by the 31st" in a shorter one', () => {
    expect(periodOn(weekly({ repeat: 'monthly' }), '2026-10-19')).toEqual({ window_from: '2026-10-01', due_on: '2026-10-31' });
    expect(periodOn(weekly({ repeat: 'monthly', when: 'by_day', day: 31 }), '2026-11-05')).toEqual({ window_from: '2026-11-01', due_on: '2026-11-30' });
    expect(periodOn(weekly({ repeat: 'monthly', when: 'by_day', day: 15 }), '2026-10-19')).toEqual({ window_from: '2026-11-01', due_on: '2026-11-15' });
  });
  it('nothing before it starts', () => {
    expect(periodOn(weekly({ starts_on: '2026-11-02' }), '2026-10-19')).toEqual({ window_from: '2026-11-01', due_on: '2026-11-07' });
  });
});

describe('how a routine is going', () => {
  const item = { id: 'r', title: 'Weekend reset', routine: weekly() };
  const mine = (id: string, extra: Partial<TaskRow> = {}) => task(id, { routine: { id: 'r', title: 'Weekend reset' }, repeat: 'weekly', ...extra });

  it('counts the tasks the server moved past this week as done', () => {
    const card = routineCard(item, [
      mine('Vacuum', { window_from: '2026-10-25', due_on: '2026-10-31', last_done_on: '2026-10-19' }),
      mine('Laundry', { window_from: '2026-10-18', due_on: '2026-10-24', last_done_on: '2026-10-12' }),
      mine('Groceries', { window_from: '2026-10-18', due_on: '2026-10-24' }),
      task('Other', { routine: { id: 'x', title: 'Other' } }),
    ], '2026-10-19');
    expect(card.tasks.map((t) => [t.title, t.doneThisTime])).toEqual([['Groceries', false], ['Laundry', false], ['Vacuum', true]]);
    expect(card.progress).toBe('1 of 3 done this week');
    expect(card.words).toBe('Any day each week');
  });

  it('says when it’s all done, and names the month for a monthly one', () => {
    const done = { window_from: '2026-11-01', due_on: '2026-11-30' };
    expect(routineCard({ ...item, routine: weekly({ repeat: 'monthly' }) }, [mine('A', done), mine('B', done)], '2026-10-19').progress).toBe('Done for October');
    expect(routineCard({ ...item, routine: weekly({ repeat: 'monthly' }) }, [mine('A', done), mine('B')], '2026-10-19').progress).toBe('1 of 2 done in October');
    expect(routineCard({ ...item, routine: weekly({ when: 'same_day', day: 6 }) }, [mine('A', { window_from: '2026-10-24' })], '2026-10-19').progress).toBe(
      '0 of 1 done for Saturday, Oct 24',
    );
    expect(routineCard(item, [], '2026-10-19').progress).toBe('No tasks yet');
  });

  it('notes a task missed last time (Q6)', () => {
    const card = routineCard({ ...item, routine: weekly({ repeat: 'monthly' }) }, [mine('Wash car', { window_from: '2026-10-01', missed_on: '2026-09-30' })], '2026-10-19');
    expect(card.missed).toEqual(['Missed in September: Wash car']);
    expect(routineCard(item, [mine('Vacuum', { window_from: '2026-10-18', missed_on: '2026-10-17' })], '2026-10-19').missed).toEqual(['Missed by Oct 17: Vacuum']);
  });

  it('lists repeating tasks of no routine on their own', () => {
    expect(repeatingAlone([task('b', { repeat: 'daily' }), mine('in a routine'), task('one time'), task('a', { repeat: 'weekly' }), task('c', { repeat: 'weekly', status: 'done' })]).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('the tab', () => {
  it('reads each routine’s schedule and its tasks, by name; anything odd is left out', async () => {
    const asked: string[] = [];
    const reader: RoutinesReader = {
      search: async (opts) => {
        asked.push(`search ${opts.item_type}`);
        return [
          { id: 'r2', title: 'Weekend reset', item_type: 'routine' },
          { id: 'r1', title: 'Monthly checks', item_type: 'routine' },
          { id: 'n', title: 'A note', item_type: 'note' },
          { id: 'r3', title: 'Broken', item_type: 'routine' },
        ];
      },
      getItem: async (id) => {
        asked.push(`get ${id}`);
        const meta: Record<string, Record<string, unknown>> = { r1: { repeat: 'monthly' }, r2: { repeat: 'weekly', starts_on: '2026-10-01' }, r3: { repeat: 'hourly' } };
        return { id, title: id === 'r1' ? 'Monthly checks' : id === 'r2' ? 'Weekend reset' : 'Broken', item_type: 'routine', metadata: meta[id] };
      },
      findTasks: async () => [task('Vacuum', { routine: { id: 'r2', title: 'Weekend reset' }, window_from: '2026-10-18' }), task('Water plants', { repeat: 'weekly' })],
    };
    const out = await loadRoutines(reader, '2026-10-19');
    expect(out.routines.map((r) => [r.title, r.tasks.length])).toEqual([['Monthly checks', 0], ['Weekend reset', 1]]);
    expect(out.alone.map((t) => t.id)).toEqual(['Water plants']);
    expect(asked).not.toContain('get n');
  });

  it('keeps a task’s routine and window as find_tasks sends them', () => {
    const [t] = toTaskRows({
      tasks: [{ id: 't', title: 'Vacuum', status: 'open', priority: 'normal', routine: { id: 'r', title: 'Weekend reset' }, window_from: '2026-10-18', missed_on: '2026-10-17', last_done_on: '2026-10-10' }],
    });
    expect(t).toMatchObject({ routine: { id: 'r', title: 'Weekend reset' }, window_from: '2026-10-18', missed_on: '2026-10-17', last_done_on: '2026-10-10' });
    const [odd] = toTaskRows({ tasks: [{ id: 't', title: 'Vacuum', routine: 'r', window_from: 'soon' }] });
    expect(odd).not.toHaveProperty('routine');
    expect(odd).not.toHaveProperty('window_from');
  });
});
