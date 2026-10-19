// My day → From your routines (routines step 3): the plan's suggestions checked field by field,
// the box's words, ✕ Not today kept on the server, and Your morning's count line.
import { describe, expect, it } from '@jest/globals';

import { summaryOf } from './dayAlerts';
import { toDayPlan, type DayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import {
  addable, dismissForDay, moreText, notSuggested, routineCountLine, suggestionAction, suggestionDetail, type NotTodayDb,
} from './routineSuggest';

const VACUUM = { task_id: 'r1', title: 'Vacuum', routine: 'Weekend reset', duration_min: 30, duration_assumed: true as const, due_on: '2026-10-10', start: '2026-10-09T19:30', end: '2026-10-09T20:00' };
const LAUNDRY = { task_id: 'r2', title: 'Laundry', routine: 'Weekend reset', duration_min: 45, start: '2026-10-09T20:00', end: '2026-10-09T20:45' };
const GROCERIES = { task_id: 'r3', title: 'Groceries', routine: 'Weekend reset', duration_min: 60 };

function withSuggestions(suggestions: unknown, extraTasks: unknown[] = []): DayPlan {
  return toDayPlan({ ...PLAN, tasks_not_placed: [...PLAN.tasks_not_placed, ...extraTasks], suggestions })!;
}

describe('the plan’s suggestions', () => {
  it('keeps each known field', () => {
    const p = withSuggestions({ items: [VACUUM, LAUNDRY, GROCERIES], more: 2 });
    expect(p.suggestions).toEqual({ items: [VACUUM, LAUNDRY, GROCERIES], more: 2 });
  });

  it('is absent when the server sends none, or none that can be read', () => {
    expect(toDayPlan(PLAN)!.suggestions).toBeUndefined();
    expect(withSuggestions({ items: [], more: 0 }).suggestions).toBeUndefined();
    expect(withSuggestions({ items: [{ task_id: 'x' }], more: 1 }).suggestions).toBeUndefined();
    expect(withSuggestions('lots').suggestions).toBeUndefined();
  });

  it('shows at most three, drops odd ones and odd fields', () => {
    const p = withSuggestions({
      items: [
        { ...VACUUM, colour: 'red' },
        { ...LAUNDRY, title: '' },
        { ...GROCERIES, duration_min: 0 },
        { ...GROCERIES, task_id: 'r4', duration_min: 20, due_on: 'soon' },
        { ...GROCERIES, task_id: 'r5' },
        { ...GROCERIES, task_id: 'r6' },
      ],
      more: -3,
    });
    expect(p.suggestions!.items.map((s) => s.task_id)).toEqual(['r1', 'r4', 'r5']);
    expect(p.suggestions!.items[0]).not.toHaveProperty('colour');
    expect(p.suggestions!.items[1]).not.toHaveProperty('due_on');
    expect(p.suggestions!.more).toBe(0);
  });

  it('keeps a time only as a whole start and end', () => {
    const p = withSuggestions({ items: [{ ...LAUNDRY, end: undefined }, { ...VACUUM, start: '2026-10-09' }] , more: 0 });
    expect(p.suggestions!.items[0]).not.toHaveProperty('start');
    expect(p.suggestions!.items[1]).not.toHaveProperty('start');
    expect(p.suggestions!.items[1]).not.toHaveProperty('end');
  });

  it('keeps a not-placed task’s routine', () => {
    const p = withSuggestions(undefined, [{ id: 'r9', title: 'Wash car', priority: 'normal', routine: 'Monthly checks' }]);
    expect(p.tasks_not_placed[1]).toEqual({ id: 'r9', title: 'Wash car', priority: 'normal', routine: 'Monthly checks' });
  });
});

describe('the box’s words', () => {
  it('says the routine and how long, "about" when no duration was given', () => {
    expect(suggestionDetail(VACUUM)).toBe('Weekend reset · about 30 min');
    expect(suggestionDetail(LAUNDRY)).toBe('Weekend reset · 45 min');
  });

  it('offers Add at its time, or Find a time for a task with a place', () => {
    expect(suggestionAction(VACUUM)).toBe('Add 7:30 pm');
    expect(suggestionAction(GROCERIES)).toBe('Find a time');
  });

  it('adds all only the ones with a time', () => {
    expect(addable(withSuggestions({ items: [VACUUM, GROCERIES, LAUNDRY], more: 0 })).map((s) => s.task_id)).toEqual(['r1', 'r2']);
  });

  it('says how many are waiting their turn', () => {
    expect(moreText(0)).toBeNull();
    expect(moreText(1)).toBe('1 more waiting: it comes in when you add or dismiss one.');
    expect(moreText(4)).toBe('4 more waiting: one comes in when you add or dismiss one.');
  });

  it('lists each task once: an offered one is not also under Not placed yet', () => {
    const p = withSuggestions({ items: [VACUUM], more: 0 }, [
      { id: 'r1', title: 'Vacuum', priority: 'normal', routine: 'Weekend reset' },
      { id: 'r7', title: 'Mop', priority: 'normal', routine: 'Weekend reset' },
    ]);
    expect(notSuggested(p.tasks_not_placed, p).map((t) => t.id)).toEqual(['t1', 'r7']);
  });
});

describe('✕ Not today', () => {
  const db = (answer: { error: { code?: string; message: string } | null } | Error) => {
    const sent: unknown[] = [];
    const d: NotTodayDb = {
      from: (table) => {
        sent.push(table);
        return {
          insert: async (row) => {
            sent.push(row);
            if (answer instanceof Error) throw answer;
            return answer;
          },
        };
      },
    };
    return { d, sent };
  };

  it('sends only the task’s id and the day', async () => {
    const { d, sent } = db({ error: null });
    await expect(dismissForDay(d, 'r1', '2026-10-09')).resolves.toEqual({ ok: true });
    expect(sent).toEqual(['task_not_today', { task_id: 'r1', day: '2026-10-09' }]);
  });

  it('is fine when it was already dismissed', async () => {
    const { d } = db({ error: { code: '23505', message: 'duplicate key' } });
    await expect(dismissForDay(d, 'r1', '2026-10-09')).resolves.toEqual({ ok: true });
  });

  it('says so, plainly, when it cannot be saved', async () => {
    for (const answer of [{ error: { code: '42501', message: 'new row violates row-level security policy' } }, new Error('offline')]) {
      const out = await dismissForDay(db(answer).d, 'r1', '2026-10-09');
      expect(out).toEqual({ error: 'Could not save Not today just now. Check your connection and try again.' });
    }
  });
});

describe('Your morning', () => {
  it('counts the routine tasks that fit today, never naming them', () => {
    const p = withSuggestions({ items: [VACUUM, LAUNDRY, GROCERIES], more: 3 });
    expect(routineCountLine(p)).toBe('2 routine tasks fit today.');
    expect(summaryOf(p)).toMatch(/ 2 routine tasks fit today\.$/);
    expect(summaryOf(p)).not.toMatch(/Vacuum|Laundry|Weekend/);
    expect(routineCountLine(withSuggestions({ items: [VACUUM], more: 0 }))).toBe('1 routine task fits today.');
  });

  it('says nothing about routines when none fits', () => {
    expect(routineCountLine(toDayPlan(PLAN)!)).toBeNull();
    expect(routineCountLine(withSuggestions({ items: [GROCERIES], more: 0 }))).toBeNull();
    expect(summaryOf(toDayPlan(PLAN)!)).not.toMatch(/routine/);
  });
});
