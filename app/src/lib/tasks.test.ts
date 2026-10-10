// Wilma tasks in the app (step 5): the form's checks (as the server's), the list, and planned_at.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { chatReducer, initialChat } from './chatThread';
import { dayBody } from './dayAgenda';
import { EMPTY_MEMORY } from './dayChoices';
import { toDayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import { optionText, titles } from './dayView';
import {
  addDays, duePicks, EMPTY_TASK, groupTasks, localParts, plannedAt, plannedParts, shortDay, taskForm, taskLine, taskMetadata, timeText, toTaskRows, type TaskRow, withTime,
} from './tasks';

const TODAY = '2026-10-09'; // a Friday

describe('the task form', () => {
  it('saves what, how long, where, by when, repeats and priority', () => {
    const out = taskMetadata({ ...EMPTY_TASK, title: 'Return the library books', duration: '15', address: 'City Library', dueOn: '2026-10-10', important: true });
    expect(out).toEqual({ metadata: { status: 'open', priority: 'important', duration_min: 15, due_on: '2026-10-10', address: 'City Library' } });
    const place = taskMetadata({ ...EMPTY_TASK, title: 'Dry cleaning', place: { id: 'p1', title: 'Bright Cleaners' }, dueOn: TODAY, repeat: 'weekly' });
    expect(place).toEqual({ metadata: { status: 'open', priority: 'normal', place_id: 'p1', due_on: TODAY, repeat: 'weekly' } });
  });

  it('says in plain words what is wrong (the server’s limits)', () => {
    expect(taskMetadata(EMPTY_TASK)).toEqual({ error: 'Say what the task is.' });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', duration: '3' })).toMatchObject({ error: expect.stringMatching(/5 to 480/) });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', duration: '500' })).toMatchObject({ error: expect.stringMatching(/5 to 480/) });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', dueOn: '2026-02-30' })).toMatchObject({ error: expect.stringMatching(/date/) });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', place: { id: 'p', title: 'P' }, address: 'Elm St' })).toMatchObject({ error: expect.stringMatching(/not both/) });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', repeat: 'daily' })).toMatchObject({ error: expect.stringMatching(/first date/) });
  });

  it('an edit keeps what the form does not show (done, planned, last done), and a typed duration is no longer an estimate', () => {
    const base = { status: 'open' as const, priority: 'normal' as const, duration_min: 20, duration_estimated: true, planned_at: '2026-10-09T17:05:00-04:00', repeat: 'weekly' as const, due_on: TODAY, last_done_on: '2026-10-02' };
    const form = taskForm('Dry cleaning', base);
    expect(form).toMatchObject({ duration: '20', dueOn: TODAY, repeat: 'weekly' });
    expect(taskMetadata(form, base)).toEqual({ metadata: { ...base } });
    expect(taskMetadata({ ...form, duration: '25' }, base)).toEqual({ metadata: { status: 'open', priority: 'normal', duration_min: 25, due_on: TODAY, repeat: 'weekly', last_done_on: '2026-10-02', planned_at: base.planned_at } });
  });

  it('a set time (owner’s phone test, versionCode 15): saved as planned_at, kept as it was, moved, removed', () => {
    const set = taskMetadata({ ...EMPTY_TASK, title: 'Lunch at Craft & Commons', plannedDay: TODAY, plannedTime: '12:30' });
    expect(set).toEqual({ metadata: { status: 'open', priority: 'normal', planned_at: plannedAt(`${TODAY}T12:30`) } });
    const base = { status: 'open' as const, priority: 'normal' as const, planned_at: '2026-10-09T17:05:00-04:00' };
    const form = taskForm('Dry cleaning', base);
    expect(form).toMatchObject({ plannedDay: TODAY, plannedTime: '17:05' });
    expect(taskMetadata(form, base)).toEqual({ metadata: base }); // unchanged: the saved moment, offset and all
    expect(taskMetadata({ ...form, plannedTime: '18:15' }, base)).toEqual({ metadata: { ...base, planned_at: plannedAt(`${TODAY}T18:15`) } });
    expect(taskMetadata({ ...form, plannedDay: '', plannedTime: '' }, base)).toEqual({ metadata: { status: 'open', priority: 'normal' } });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', plannedTime: '12:30' })).toMatchObject({ error: expect.stringMatching(/both a day and a time/) });
    expect(taskMetadata({ ...EMPTY_TASK, title: 'x', plannedDay: TODAY, plannedTime: '25:00' })).toMatchObject({ error: expect.stringMatching(/both a day and a time/) });
  });

  it('reads a planned_at as written, and a picked Date on this phone’s clock', () => {
    expect(plannedParts('2026-10-09T17:05:00-04:00')).toEqual({ day: TODAY, time: '17:05' });
    expect(plannedParts('soon')).toBeNull();
    expect(plannedParts(undefined)).toBeNull();
    expect(localParts(new Date(2026, 9, 10, 9, 5))).toEqual({ day: '2026-10-10', time: '09:05' });
    expect(timeText('12:30')).toBe('12:30 pm');
    expect(timeText('00:15')).toBe('12:15 am');
  });

  it('offers today, tomorrow, Saturday and next Monday', () => {
    expect(duePicks(TODAY).map((p) => p.label)).toEqual(['Today', 'Tomorrow', 'Next Monday']); // Friday: tomorrow is Saturday
    expect(duePicks('2026-10-07').map((p) => p.day)).toEqual(['2026-10-07', '2026-10-08', '2026-10-10', '2026-10-12']);
    expect(duePicks('2026-10-10')[2].day).toBe('2026-10-17'); // on a Saturday: the next one
  });
});

const task = (over: Partial<TaskRow>): TaskRow => ({ id: over.title ?? 'x', title: 'x', space: 'Tasks', status: 'open', priority: 'normal', ...over });

describe('the list', () => {
  it('groups today (overdue or planned today), this week, later, done', () => {
    const g = groupTasks([
      task({ title: 'overdue', due_on: '2026-10-07', overdue: true }),
      task({ title: 'today', due_on: TODAY }),
      task({ title: 'planned', due_on: '2026-10-11', planned_at: '2026-10-09T17:05:00-04:00' }),
      task({ title: 'week', due_on: '2026-10-14' }),
      task({ title: 'later', due_on: '2026-11-01' }),
      task({ title: 'undated' }),
      task({ title: 'done', status: 'done' }),
    ], TODAY);
    expect(g.today.map((t) => t.title)).toEqual(['overdue', 'today', 'planned']);
    expect(g.week.map((t) => t.title)).toEqual(['week']);
    expect(g.later.map((t) => t.title)).toEqual(['later', 'undated']);
    expect(g.done.map((t) => t.title)).toEqual(['done']);
  });

  it('one line per task, as in the mockup', () => {
    expect(taskLine(task({ duration_min: 20, place: { id: 'p', title: 'Bright Cleaners' }, due_on: TODAY }), TODAY)).toBe('20 min · Bright Cleaners · by today');
    expect(taskLine(task({ duration_min: 15, duration_estimated: true, due_on: '2026-10-13', repeat: 'weekly', priority: 'important' }), TODAY))
      .toBe('about 15 min · by Tue · ↻ weekly · important');
    expect(taskLine(task({ due_on: '2026-10-07', overdue: true }), TODAY)).toBe('overdue (Oct 7)');
    expect(taskLine(task({ duration_min: 60, planned_at: '2026-10-10T12:30:00-04:00', due_on: '2026-10-10' }), TODAY)).toBe('60 min · tomorrow at 12:30 pm · by tomorrow');
    expect(shortDay('2026-10-10', TODAY)).toBe('tomorrow');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('reads find_tasks field by field', () => {
    expect(toTaskRows({ tasks: [{ id: 't', title: 'T', status: 'done', priority: 'urgent', due_on: 'soon', place: { id: 'p', title: 'P' }, link: 'x' }, { title: 'no id' }] }))
      .toEqual([{ id: 't', title: 'T', space: null, status: 'done', priority: 'normal', place: { id: 'p', title: 'P' } }]);
    expect(toTaskRows(null)).toEqual([]);
  });
});

describe('putting a task in the day', () => {
  it('planned_at is the local time with this phone’s offset', () => {
    const at = plannedAt('2026-10-09T17:05')!;
    expect(at).toMatch(/^2026-10-09T17:05:00[+-]\d{2}:\d{2}$/);
    // The same moment again, read back.
    const d = new Date(at);
    expect([d.getHours(), d.getMinutes()]).toEqual([17, 5]);
    expect(plannedAt('soon')).toBeNull();
  });

  it('asks the planner where a task fits (options_for) and words its suggestions', () => {
    expect(dayBody(TODAY, 'UTC', undefined, [], EMPTY_MEMORY, '00000000-0000-4000-8000-000000000001')).toMatchObject({ options_for: '00000000-0000-4000-8000-000000000001' });
    const plan = toDayPlan({
      ...PLAN,
      options: {
        task_id: 't1',
        options: [
          { kind: 'on_the_way', start: '2026-10-09T16:05', end: '2026-10-09T16:25', extra_drive_min: 6, for_keys: ['swim'], leave_at: '2026-10-09T15:39', was_leave_at: '2026-10-09T16:10' },
          { kind: 'free_time', start: '2026-10-09T19:20', end: '2026-10-09T19:40', extra_drive_min: 0 },
          { kind: 'teleport', start: '2026-10-09T19:20', end: '2026-10-09T19:40', extra_drive_min: 0 },
        ],
      },
    })!;
    expect(plan.options?.options).toHaveLength(2);
    const t = titles(plan);
    expect(optionText(plan.options!.options[0], t)).toEqual({ title: 'On the way to Swim: Sara, 4:05 pm', detail: 'Leave at 3:39 pm instead of 4:10 pm. 6 min more driving.' });
    expect(optionText(plan.options!.options[1], t)).toEqual({ title: 'In free time, 7:20–7:40 pm', detail: 'No driving.' });
  });
});

describe('the screens', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

  it('Home has a Tasks tile; New note offers ✅ Task; Edit on a task opens the task form', () => {
    expect(read('app/index.tsx')).toContain(`<Tile icon="✅" title="Tasks" onPress={() => router.push('/tasks')} />`);
    expect(read('app/new-item.tsx')).toContain("{ value: 'task', label: '✅ Task' }");
    expect(read('app/item/[id].tsx')).toContain("router.push({ pathname: '/task', params: { id: item.id } })");
  });

  it('a task that looks like it holds a password is never sent (rule 9), in the form and in ＋ Add', () => {
    expect(read('app/task.tsx')).toMatch(/findCredential\(form\.title\) \|\| findCredential\(form\.address\) \|\| findCredential\(body\)\) return setError\(LOOKS_LIKE_SECRET\)/);
    expect(read('app/day.tsx')).toContain('if (findCredential(t.title)) return setSheetError(LOOKS_LIKE_SECRET);');
  });

  it('the task form picks dates and the time with the phone’s own calendar and clock (Android)', () => {
    const screen = read('app/task.tsx');
    expect(screen).toContain("import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';");
    expect(screen).toContain("{label('AT A SET TIME (OPTIONAL)')}");
    expect(screen).toContain('<Button title="🕒 Pick a time"');
  });

  it('ticking done sends the phone’s date (a repeating task’s next date, Q12)', () => {
    expect(read('app/tasks.tsx')).toContain("await wilma.taskDone(t.id, t.status !== 'done', today);");
  });

  it('picking a suggestion only sets the task’s planned_at (the user’s choice, not a Mapbox result), with its end-of-day choice', () => {
    expect(read('app/day.tsx')).toContain('await wilma.updateItem(sheetTask.id, { metadata: withTime(sheetTask.metadata, at, dayEnd) });');
    const m = { status: 'open' as const, priority: 'normal' as const, due_on: TODAY, duration_min: 20 };
    expect(withTime(m, '2026-10-09T12:30:00-04:00', null)).toEqual({ ...m, planned_at: '2026-10-09T12:30:00-04:00' });
  });

  it('reading tasks or the calendar is not a change (no "part of this may be done")', () => {
    let s = chatReducer(initialChat(), { type: 'send', text: 'what do I have to do today?' });
    s = chatReducer(s, { type: 'event', event: { type: 'status', tool: 'find_tasks', text: 'Checking your tasks…' } });
    s = chatReducer(s, { type: 'event', event: { type: 'error', code: 'connection', message: 'Trouble connecting.' } });
    expect(s.entries.at(-1)).not.toHaveProperty('note');
  });
});
