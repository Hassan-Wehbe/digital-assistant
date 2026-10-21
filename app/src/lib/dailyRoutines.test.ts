// Daily routines in the app ("Daily routines", docs/routines-plan.md step 2): the schedule read back
// (every day or weekdays, an optional time), its words and periods (as the server's), "Today: 2 of
// 3" with no Missed lines (Q-D4), the form's Daily choice and time (Q-D1, Q-D3), My day's one line
// for a daily routine (Q-D2: its tasks added at their own times, ✕ for all of them), and the chat's
// Save routine card with a time.
import { describe, expect, it } from '@jest/globals';

import { cardForm, routineCardLine, toRoutineCard } from './chatRoutine';
import { toDayPlan, type DayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import { checkRoutine, DAILY_CHOICES, EMPTY_ROUTINE, parseAt, repeatChip, routineForm, whenChoices, withRepeat, type RoutineForm } from './routineForm';
import { addable, notSuggested, routineCountLine, suggestionAction, suggestionDetail, suggestionTasks } from './routineSuggest';
import { periodOn, routineCard, routineWords, toRoutine, type RoutineMetadata } from './routines';
import type { TaskRow } from './tasks';

const daily = (extra: Partial<RoutineMetadata> = {}): RoutineMetadata => ({ repeat: 'daily', when: 'any_day', starts_on: '2026-10-01', suggest: true, ...extra });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe('a daily routine’s schedule', () => {
  it('reads every day and weekdays, with a time only in "HH:MM"', () => {
    expect(toRoutine({ repeat: 'daily', at: '07:30' })).toEqual({ repeat: 'daily', when: 'any_day', suggest: true, at: '07:30' });
    expect(toRoutine({ repeat: 'weekdays', at: '7:30' })).toEqual({ repeat: 'weekdays', when: 'any_day', suggest: true });
    expect(toRoutine({ repeat: 'weekly', at: '07:30' })).toEqual({ repeat: 'weekly', when: 'any_day', suggest: true });
    expect(toRoutine({ repeat: 'weekdays', when: 'by_day', day: 3 })).toBeNull();
  });

  it('says it with a 12-hour time', () => {
    expect(routineWords(daily())).toBe('Every day');
    expect(routineWords(daily({ repeat: 'weekdays', at: '19:05' }))).toBe('Every weekday at 7:05 pm');
    expect(routineWords(daily({ at: '00:30' }))).toBe('Every day at 12:30 am');
  });

  it('periods over a whole year, as the server’s: the day itself; weekdays, the Monday after a weekend', () => {
    for (let d = '2026-01-01'; d <= '2026-12-31'; d = addDays(d, 1)) {
      expect(periodOn(daily({ starts_on: '2026-01-01' }), d)).toEqual({ window_from: d, due_on: d });
      const p = periodOn(daily({ repeat: 'weekdays', starts_on: '2026-01-01' }), d);
      expect(p.due_on).toBe(dow(d) === 6 ? addDays(d, 2) : dow(d) === 0 ? addDays(d, 1) : d);
    }
  });
});

describe('the Routines tab', () => {
  const mine = (id: string, extra: Partial<TaskRow> = {}): TaskRow => ({
    id, title: id, space: 'Tasks', status: 'open', priority: 'normal', repeat: 'daily', routine: { id: 'r', title: 'Morning' }, ...extra,
  });
  const item = (r: RoutineMetadata) => ({ id: 'r', title: 'Morning', routine: r });

  it('says "Today: 1 of 2", then "Done for today"; never a Missed line (Q-D4)', () => {
    const card = routineCard(item(daily()), [
      mine('Make bed', { window_from: '2026-10-22', due_on: '2026-10-22', last_done_on: '2026-10-21' }),
      mine('Vitamins', { window_from: '2026-10-21', due_on: '2026-10-21', missed_on: '2026-10-20' }),
    ], '2026-10-21');
    expect(card.progress).toBe('Today: 1 of 2');
    expect(card.missed).toEqual([]);
    const done = routineCard(item(daily()), [mine('Make bed', { window_from: '2026-10-22', due_on: '2026-10-22' })], '2026-10-21');
    expect(done.progress).toBe('Done for today');
  });

  it('a weekdays routine at the weekend speaks of its Monday', () => {
    const card = routineCard(item(daily({ repeat: 'weekdays' })), [mine('Plan the day', { repeat: 'weekdays', window_from: '2026-10-26', due_on: '2026-10-26' })], '2026-10-24');
    expect(card.progress).toBe('0 of 1 done for Monday, Oct 26');
  });
});

describe('the form', () => {
  const form = (extra: Partial<RoutineForm> = {}): RoutineForm => ({ ...EMPTY_ROUTINE, title: 'Morning', tasks: [{ title: 'Check email', duration: '10' }], ...extra });

  it('reads a time as people type it', () => {
    for (const [typed, want] of [['7:30', '07:30'], ['7:30 am', '07:30'], ['7:30pm', '19:30'], ['7 PM', '19:00'], ['12 am', '00:00'], ['12:15 pm', '12:15'],
      ['19:00', '19:00'], ['0730', '07:30'], ['7.30 a.m.', '07:30'], ['25:00', null], ['13 pm', null], ['7:75', null], ['morning', null]] as const) {
      expect([typed, parseAt(typed)]).toEqual([typed, want]);
    }
  });

  it('Daily is every day or weekdays, with no When of its own; the time goes only with it', () => {
    expect(repeatChip('weekdays')).toBe('daily');
    expect(DAILY_CHOICES.map((d) => d.value)).toEqual(['daily', 'weekdays']);
    expect(whenChoices('daily')).toEqual([]);
    expect(withRepeat(form({ repeat: 'weekdays' }), 'daily').repeat).toBe('weekdays');
    expect(withRepeat(form({ repeat: 'weekly', when: 'same_day' }), 'daily')).toMatchObject({ repeat: 'daily', when: 'any_day' });
    expect(checkRoutine(form({ repeat: 'daily', at: '8 am' }))).toMatchObject({ metadata: { repeat: 'daily', when: 'any_day', at: '08:00' } });
    expect(checkRoutine(form({ repeat: 'weekdays', at: '' }))).toMatchObject({ metadata: { repeat: 'weekdays', when: 'any_day' } });
    expect(checkRoutine(form({ repeat: 'daily', at: 'soon' }))).toEqual({ error: 'At what time? Like 7:30 am or 19:00 (or leave it empty).' });
    const weekly = checkRoutine(form({ repeat: 'weekly', at: '8 am' }));
    expect('error' in weekly ? weekly : weekly.metadata).not.toHaveProperty('at');
  });

  it('a saved daily routine opens with its time in words, and saves it back the same', () => {
    const f = routineForm('Morning', daily({ at: '07:30' }), []);
    expect(f.at).toBe('7:30 am');
    expect(checkRoutine({ ...f, tasks: [{ title: 'Make bed', duration: '' }] })).toMatchObject({ metadata: { at: '07:30' } });
  });
});

describe('My day’s line for a daily routine', () => {
  const LINE = {
    task_id: 'm1', title: 'Morning', routine: 'Morning', duration_min: 20, due_on: '2026-10-09', start: '2026-10-09T07:30', end: '2026-10-09T07:50',
    tasks: [
      { task_id: 'm1', title: 'Make bed', duration_min: 5, start: '2026-10-09T07:30', end: '2026-10-09T07:35' },
      { task_id: 'm2', title: 'Vitamins', duration_min: 5, start: '2026-10-09T07:35', end: '2026-10-09T07:40' },
      { task_id: 'm3', title: 'Stretch', duration_min: 10, duration_assumed: true as const, start: '2026-10-09T07:40', end: '2026-10-09T07:50' },
    ],
  };
  const plan = (items: unknown[], extraTasks: unknown[] = []): DayPlan =>
    toDayPlan({ ...PLAN, tasks_not_placed: [...PLAN.tasks_not_placed, ...extraTasks], suggestions: { items, more: 0 } })!;

  it('is read whole, or not as a line at all', () => {
    expect(plan([LINE]).suggestions!.items[0]).toEqual(LINE);
    const broken = { ...LINE, tasks: [...LINE.tasks, { task_id: 'm4', title: 'No time', duration_min: 5 }] };
    expect(plan([broken]).suggestions!.items[0].tasks).toBeUndefined();
  });

  it('names its tasks, adds each at its own time, and is counted as its tasks', () => {
    const p = plan([LINE], [{ id: 'm2', title: 'Vitamins', priority: 'normal', routine: 'Morning' }, { id: 'x', title: 'Other', priority: 'normal' }]);
    const sg = p.suggestions!.items[0];
    expect(suggestionDetail(sg)).toBe('Make bed, Vitamins, Stretch · 20 min');
    expect(suggestionAction(sg)).toBe('Add 7:30 am');
    expect(suggestionTasks(sg).map((t) => [t.task_id, t.start])).toEqual([['m1', '2026-10-09T07:30'], ['m2', '2026-10-09T07:35'], ['m3', '2026-10-09T07:40']]);
    expect(addable(p)).toHaveLength(1);
    expect(notSuggested(p.tasks_not_placed, p).map((t) => t.id)).not.toContain('m2');
    expect(routineCountLine(p)).toBe('3 routine tasks fit today.');
  });

  it('a single task is itself', () => {
    const one = { task_id: 'e1', title: 'Check email', routine: 'Email', duration_min: 10, start: '2026-10-09T08:00', end: '2026-10-09T08:10' };
    expect(suggestionTasks(plan([one]).suggestions!.items[0])).toEqual([{ task_id: 'e1', title: 'Check email', start: '2026-10-09T08:00' }]);
    expect(suggestionDetail(plan([one]).suggestions!.items[0])).toBe('Email · 10 min');
  });
});

describe('the chat’s Save routine card', () => {
  it('keeps a daily routine’s time, and saves it', () => {
    const card = toRoutineCard({ type: 'routine_save', name: 'Morning', repeat: 'daily', when: 'any_day', at: '07:30', suggest: true, tasks: [{ title: 'Check email', minutes: 10 }] })!;
    expect(card.routine).toEqual({ repeat: 'daily', when: 'any_day', suggest: true, at: '07:30' });
    expect(routineCardLine(card)).toBe('Every day at 7:30 am · 1 task');
    expect(checkRoutine(cardForm(card))).toMatchObject({ metadata: { repeat: 'daily', at: '07:30' } });
    // A saved chat keeps it under `routine`.
    expect(toRoutineCard({ name: 'Morning', routine: card.routine, tasks: card.tasks })!.routine.at).toBe('07:30');
  });
});
