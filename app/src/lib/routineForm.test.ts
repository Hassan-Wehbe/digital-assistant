// New routine / edit (routines step 3b): the form checked before anything is sent, and what saving
// adds, changes and takes out.
import { describe, expect, it } from '@jest/globals';

import { LOOKS_LIKE_SECRET } from './noteEdit';
import {
  checkRoutine, EMPTY_ROUTINE, MAX_ROUTINE_TASKS, routineForm, routineSavePlan, routineTaskMetadata, whenChoices, withMinutes, withRepeat, type RoutineForm,
} from './routineForm';

const form = (extra: Partial<RoutineForm> = {}): RoutineForm => ({
  ...EMPTY_ROUTINE,
  title: 'Weekend reset',
  tasks: [{ title: 'Vacuum', duration: '' }, { title: 'Laundry', duration: '45' }],
  ...extra,
});

describe('checking the form', () => {
  it('gives the schedule and the tasks, empty rows left out', () => {
    expect(checkRoutine(form({ tasks: [{ title: ' Vacuum ', duration: '' }, { title: '', duration: '' }, { title: 'Laundry', duration: '45' }] }))).toEqual({
      title: 'Weekend reset',
      metadata: { repeat: 'weekly', when: 'any_day', suggest: true },
      tasks: [{ title: 'Vacuum' }, { title: 'Laundry', duration_min: 45 }],
    });
  });

  it('the day goes with same day and by a day of the month', () => {
    expect(checkRoutine(form({ when: 'same_day', weekday: 6 }))).toMatchObject({ metadata: { repeat: 'weekly', when: 'same_day', day: 6 } });
    expect(checkRoutine(form({ repeat: 'monthly', when: 'by_day', monthDay: '28', suggest: false }))).toMatchObject({
      metadata: { repeat: 'monthly', when: 'by_day', day: 28, suggest: false },
    });
    expect(checkRoutine(form({ repeat: 'monthly', when: 'any_day', monthDay: '28' }))).toMatchObject({ metadata: { repeat: 'monthly', when: 'any_day' } });
  });

  it('says what is missing or wrong', () => {
    expect(checkRoutine(form({ title: '  ' }))).toEqual({ error: 'Give the routine a name, like “Weekend house reset”.' });
    expect(checkRoutine(form({ tasks: [{ title: '', duration: '' }] }))).toEqual({ error: 'Add at least one task, like “Vacuum”.' });
    expect(checkRoutine(form({ tasks: [{ title: '', duration: '20' }] }))).toEqual({ error: 'A task with a time needs a name too.' });
    expect(checkRoutine(form({ tasks: [{ title: 'Vacuum', duration: '0' }] }))).toEqual({ error: 'How long “Vacuum” takes: minutes, from 1 to 1440.' });
    expect(checkRoutine(form({ tasks: [{ title: 'Vacuum', duration: '2000' }] }))).toHaveProperty('error');
    expect(checkRoutine(form({ repeat: 'monthly', when: 'by_day', monthDay: '32' }))).toEqual({ error: 'By which day of the month? A number from 1 to 31.' });
    expect(checkRoutine(form({ repeat: 'monthly', when: 'by_day', monthDay: '' }))).toHaveProperty('error');
    expect(checkRoutine(form({ repeat: 'monthly', when: 'same_day' }))).toEqual({ error: 'Pick the day of the week.' });
    const many = Array.from({ length: MAX_ROUTINE_TASKS + 1 }, (_, i) => ({ title: `Task ${i}`, duration: '' }));
    expect(checkRoutine(form({ tasks: many }))).toEqual({ error: `A routine holds up to ${MAX_ROUTINE_TASKS} tasks.` });
  });

  it('holds a password on the phone, in the name or a task (rule 9)', () => {
    expect(checkRoutine(form({ title: 'my password is hunter2' }))).toEqual({ error: LOOKS_LIKE_SECRET });
    expect(checkRoutine(form({ tasks: [{ title: 'Wi-Fi password is hunter2', duration: '' }] }))).toEqual({ error: LOOKS_LIKE_SECRET });
    expect(checkRoutine(form({ tasks: [{ title: 'Change the Wi-Fi password', duration: '' }] }))).not.toHaveProperty('error');
  });
});

describe('the choices', () => {
  it('offers the When that fits the kind of repeat (Q1, Q2)', () => {
    expect(whenChoices('weekly').map((w) => w.value)).toEqual(['any_day', 'same_day']);
    expect(whenChoices('monthly').map((w) => w.value)).toEqual(['any_day', 'by_day']);
  });

  it('goes back to any day when the kind changes and the choice no longer fits', () => {
    expect(withRepeat(form({ when: 'same_day' }), 'monthly').when).toBe('any_day');
    expect(withRepeat(form({ when: 'same_day' }), 'biweekly').when).toBe('same_day');
  });

  it('opens a saved routine with its tasks and minutes', () => {
    const f = routineForm('Monthly checks', { repeat: 'monthly', when: 'by_day', day: 28, suggest: false }, [{ id: 't1', title: 'HVAC filter', duration_min: 15 }, { id: 't2', title: 'Smoke alarms' }]);
    expect(f).toMatchObject({ title: 'Monthly checks', repeat: 'monthly', when: 'by_day', monthDay: '28', suggest: false });
    expect(f.tasks).toEqual([{ id: 't1', title: 'HVAC filter', duration: '15' }, { id: 't2', title: 'Smoke alarms', duration: '' }]);
    expect(routineForm('Empty', { repeat: 'weekly', when: 'same_day', day: 2, suggest: true }, []).tasks).toEqual([{ title: '', duration: '' }]);
  });
});

describe('saving', () => {
  const saved = [
    { id: 't1', title: 'Vacuum', duration_min: 30 },
    { id: 't2', title: 'Laundry' },
    { id: 't3', title: 'Groceries', duration_min: 60 },
  ];

  it('adds new tasks, changes renamed or retimed ones, takes out the missing', () => {
    const checked = checkRoutine(form({
      tasks: [
        { id: 't1', title: 'Vacuum', duration: '30' },
        { id: 't2', title: 'Laundry and folding', duration: '45' },
        { title: 'Mop', duration: '' },
      ],
    }));
    if ('error' in checked) throw new Error(checked.error);
    expect(routineSavePlan(checked, saved)).toEqual({
      add: [{ title: 'Mop' }],
      change: [{ id: 't2', title: 'Laundry and folding', duration_min: 45 }],
      remove: ['t3'],
    });
  });

  it('a cleared time is sent as none', () => {
    const checked = checkRoutine(form({ tasks: [{ id: 't1', title: 'Vacuum', duration: '' }] }));
    if ('error' in checked) throw new Error(checked.error);
    expect(routineSavePlan(checked, [saved[0]]).change).toEqual([{ id: 't1', duration_min: null }]);
  });

  it('a new task names its routine; the server gives it its dates', () => {
    expect(routineTaskMetadata('r', 20)).toEqual({ status: 'open', priority: 'normal', routine_id: 'r', duration_min: 20 });
    expect(routineTaskMetadata('r')).toEqual({ status: 'open', priority: 'normal', routine_id: 'r' });
  });

  it('a changed task keeps everything else it had', () => {
    const before = { status: 'open', priority: 'important', routine_id: 'r', repeat: 'weekly', window_from: '2026-10-18', due_on: '2026-10-24', duration_min: 30, duration_estimated: true, planned_at: '2026-10-19T09:00:00-04:00' } as const;
    expect(withMinutes(before, 45)).toEqual({ ...before, duration_estimated: undefined, duration_min: 45 } as unknown as object);
    expect(withMinutes(before, null)).not.toHaveProperty('duration_min');
    expect(withMinutes(before, null)).toMatchObject({ routine_id: 'r', planned_at: '2026-10-19T09:00:00-04:00', priority: 'important' });
  });
});
