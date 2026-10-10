// Tasks left open at the end of their day (D35, docs/task-day-end-plan.md), in the app: the choice
// kept on the form and saved only with a time, the two button helpers, the plan's new fields read
// and checked, and the "Left open" wording.
import { describe, expect, it } from '@jest/globals';

import { toDayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import { leftOpenHeading, leftOpenWhen, splitNotPlaced } from './dayView';
import { addToDay, EMPTY_TASK, plannedAt, taskForm, taskMetadata, withTime, type TaskMetadata } from './tasks';

const AT = '2026-10-09T15:00:00-04:00';

describe('the end-of-day choice on the task form', () => {
  it('is read from the task and saved with a set time', () => {
    const form = taskForm('Call the bank', { status: 'open', priority: 'normal', planned_at: AT, day_end: 'next_day' });
    expect(form.dayEnd).toBe('next_day');
    const out = taskMetadata(form, { status: 'open', priority: 'normal', planned_at: AT, day_end: 'next_day' });
    expect('metadata' in out && out.metadata).toMatchObject({ planned_at: AT, day_end: 'next_day' });
  });

  it('is not saved without a time, on a repeating task, or when left as Ask me', () => {
    const noTime = taskMetadata({ ...EMPTY_TASK, title: 'Call the bank', dayEnd: 'done' });
    expect('metadata' in noTime && noTime.metadata.day_end).toBeUndefined();
    const repeating = taskMetadata({ ...EMPTY_TASK, title: 'Walk', dueOn: '2026-10-09', repeat: 'daily', plannedDay: '2026-10-09', plannedTime: '07:00', dayEnd: 'done' });
    expect('metadata' in repeating && repeating.metadata.day_end).toBeUndefined();
    const ask = taskMetadata({ ...EMPTY_TASK, title: 'Call the bank', plannedDay: '2026-10-09', plannedTime: '15:00' });
    expect('metadata' in ask && ask.metadata.day_end).toBeUndefined();
    expect(taskForm('x', null).dayEnd).toBeNull();
    expect(taskForm('x', { day_end: 'never' as never }).dayEnd).toBeNull();
  });
});

describe('the button helpers', () => {
  const task: TaskMetadata = { status: 'open', priority: 'important', planned_at: AT, day_end: 'done', duration_min: 20, address: 'Main St' };

  it('Add to today: due that day, its old time and choice gone, everything else kept', () => {
    expect(addToDay(task, '2026-10-10')).toEqual({ status: 'open', priority: 'important', due_on: '2026-10-10', duration_min: 20, address: 'Main St' });
    expect(addToDay(null, '2026-10-10')).toEqual({ status: 'open', priority: 'normal', due_on: '2026-10-10' });
  });

  it('a suggestion picked: the time set with the choice, or the choice removed for Ask me', () => {
    const at = plannedAt('2026-10-10T12:30')!;
    expect(withTime(task, at, 'next_day')).toMatchObject({ planned_at: at, day_end: 'next_day' });
    expect(withTime(task, at, null).day_end).toBeUndefined();
    expect(withTime({ ...task, repeat: 'daily', due_on: '2026-10-10' }, at, 'done').day_end).toBeUndefined();
  });
});

describe('Left open in My day', () => {
  const raw = {
    ...PLAN,
    date: '2026-10-10',
    tasks_not_placed: [
      { id: 'a', title: 'Call the bank', priority: 'normal', left_from: '2026-10-09', planned_time: '15:00' },
      { id: 'b', title: 'Pick up dry cleaning', priority: 'normal', due_on: '2026-10-10' },
      { id: 'c', title: 'Bad fields', priority: 'normal', left_from: 'yesterday', planned_time: '25:00' },
    ],
  };
  const plan = toDayPlan(raw)!;

  it('reads left_from and planned_time, and drops them when malformed', () => {
    expect(plan.tasks_not_placed[0]).toMatchObject({ left_from: '2026-10-09', planned_time: '15:00' });
    expect(plan.tasks_not_placed[2].left_from).toBeUndefined();
    expect(plan.tasks_not_placed[2].planned_time).toBeUndefined();
  });

  it('asks about the left-open ones apart from the rest', () => {
    const { leftOpen, notPlaced } = splitNotPlaced(plan);
    expect(leftOpen.map((t) => t.id)).toEqual(['a']);
    expect(notPlaced.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('says when it was planned', () => {
    const [bank] = splitNotPlaced(plan).leftOpen;
    expect(leftOpenHeading([bank], '2026-10-10')).toBe('Left open yesterday');
    expect(leftOpenWhen(bank, '2026-10-10')).toBe('planned yesterday at 3:00 pm');
    expect(leftOpenHeading([bank], '2026-10-11')).toBe('Left open');
    expect(leftOpenWhen(bank, '2026-10-11')).toBe('planned Oct 9 at 3:00 pm');
  });
});
