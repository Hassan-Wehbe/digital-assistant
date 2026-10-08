import { describe, expect, it, jest } from '@jest/globals';

import {
  dayText, MAX_AGENDA_EVENTS, NO_PERMISSION, readAgenda, startOfDay, timeText, trimEvent, turnOn, listCalendars,
  type CalendarChoice, type CalendarDeps, type PhoneEvent,
} from './calendar';

const allowed = { granted: true, canAskAgain: true };
const notYet = { granted: false, canAskAgain: true };
const refused = { granted: false, canAskAgain: false };

/** Local times, as the phone gives them (the test runs in whatever zone the machine has). */
const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m);
};

const EVENTS: PhoneEvent[] = [
  { calendarId: 'work', title: 'Gartner kickoff call', startDate: at('2026-10-08', 15), endDate: at('2026-10-08', 16), location: '' },
  { calendarId: 'home', title: 'Dentist', startDate: at('2026-10-08', 9), endDate: at('2026-10-08', 9, 45), location: 'Oviedo Dental' },
  { calendarId: 'home', title: 'Therapy session', startDate: at('2026-10-08', 18), endDate: at('2026-10-08', 19), location: "Dr. Lane's office", accessLevel: 'private' },
  { calendarId: 'home', title: 'Moved lunch', startDate: at('2026-10-08', 12), endDate: at('2026-10-08', 13), status: 'canceled' },
  { calendarId: 'secret', title: 'Unticked calendar event', startDate: at('2026-10-08', 10), endDate: at('2026-10-08', 11) },
];

function phone(over: Partial<CalendarDeps> = {}) {
  return {
    permission: jest.fn<CalendarDeps['permission']>(async () => allowed),
    askPermission: jest.fn<CalendarDeps['askPermission']>(async () => allowed),
    calendars: jest.fn<CalendarDeps['calendars']>(async () => [
      { id: 'home', title: 'Personal', account: 'me@gmail.com', timeZone: 'America/New_York' },
      { id: 'work', title: 'Work', account: 'me@work.example', timeZone: 'America/New_York' },
      { id: 'secret', title: 'Private stuff', account: null },
    ]),
    events: jest.fn<CalendarDeps['events']>(async (ids) => EVENTS.filter((e) => ids.includes(e.calendarId))),
    allDayInUtc: true,
    ...over,
  };
}

const TICKED: CalendarChoice = { on: true, ticked: ['home', 'work'] };

describe('days and times (the phone’s own time)', () => {
  it('writes local days and times', () => {
    expect(dayText(at('2026-10-08', 9, 5))).toBe('2026-10-08');
    expect(timeText(at('2026-10-08', 9, 5))).toBe('2026-10-08T09:05');
    expect(dayText(new Date(Date.UTC(2026, 9, 8)), true)).toBe('2026-10-08');
  });

  it('reads a day as local midnight, and refuses one that does not exist', () => {
    expect(startOfDay('2026-10-08')?.getHours()).toBe(0);
    expect(startOfDay('2026-02-30')).toBeNull();
    expect(startOfDay('tomorrow')).toBeNull();
  });
});

describe('trimEvent (only what an answer needs)', () => {
  it('keeps the title, times, place and calendar name, and nothing else', () => {
    const e = { ...EVENTS[1], notes: 'Bring the X-rays', attendees: ['sam@example.com'], url: 'https://meet.example/x' } as PhoneEvent;
    expect(trimEvent(e, 'Personal', true)).toEqual({
      title: 'Dentist', start: '2026-10-08T09:00', end: '2026-10-08T09:45', all_day: false, location: 'Oviedo Dental', calendar: 'Personal',
    });
  });

  it('a private event is Busy with its times, without its title or place', () => {
    expect(trimEvent(EVENTS[2], 'Personal', true)).toEqual({
      title: 'Busy', start: '2026-10-08T18:00', end: '2026-10-08T19:00', all_day: false, calendar: 'Personal', busy_only: true,
    });
    expect(trimEvent({ ...EVENTS[2], accessLevel: 'confidential' }, 'Personal', true)?.title).toBe('Busy');
  });

  it('leaves out canceled and unreadable events', () => {
    expect(trimEvent(EVENTS[3], 'Personal', true)).toBeNull();
    expect(trimEvent({ ...EVENTS[1], startDate: 'not a date' }, 'Personal', true)).toBeNull();
  });

  it('an all-day event is its days (stored at midnight UTC on Android), ending on its last day', () => {
    const e: PhoneEvent = { calendarId: 'home', title: "Mum's birthday", allDay: true, startDate: new Date(Date.UTC(2026, 9, 10)), endDate: new Date(Date.UTC(2026, 9, 11)) };
    expect(trimEvent(e, 'Family', true)).toMatchObject({ start: '2026-10-10', end: '2026-10-10', all_day: true });
    const trip: PhoneEvent = { ...e, endDate: new Date(Date.UTC(2026, 9, 13)) };
    expect(trimEvent(trip, 'Family', true)).toMatchObject({ start: '2026-10-10', end: '2026-10-12' });
    const iphone: PhoneEvent = { ...e, startDate: at('2026-10-10', 0), endDate: at('2026-10-11', 0) };
    expect(trimEvent(iphone, 'Family', false)).toMatchObject({ start: '2026-10-10', end: '2026-10-10' });
  });

  it('keeps texts short and never empty', () => {
    const long = trimEvent({ ...EVENTS[1], title: 'x'.repeat(500), location: 'y'.repeat(500) }, 'z'.repeat(200), true)!;
    expect([long.title.length, long.location!.length, long.calendar.length]).toEqual([300, 300, 100]);
    expect(trimEvent({ ...EVENTS[1], title: '  ' }, '', true)).toMatchObject({ title: '(no title)', calendar: 'Calendar' });
  });
});

describe('readAgenda (for one of Wilma’s questions)', () => {
  it('reads only the ticked calendars, for those days, sorted, and never asks for the permission', async () => {
    const p = phone();
    const out = await readAgenda(p, TICKED, '2026-10-08', '2026-10-08', 'America/New_York');
    expect(out).toEqual({
      agenda: {
        from: '2026-10-08', to: '2026-10-08', time_zone: 'America/New_York', calendars: 2,
        events: [
          expect.objectContaining({ title: 'Dentist', start: '2026-10-08T09:00' }),
          expect.objectContaining({ title: 'Gartner kickoff call', start: '2026-10-08T15:00', calendar: 'Work' }),
          expect.objectContaining({ title: 'Busy', start: '2026-10-08T18:00' }),
        ],
      },
    });
    expect(p.events).toHaveBeenCalledWith(['home', 'work'], at('2026-10-08', 0), at('2026-10-09', 0));
    expect(JSON.stringify(out)).not.toMatch(/Unticked|Therapy|Moved lunch/);
    expect(p.askPermission).not.toHaveBeenCalled();
  });

  it('even if the phone returns an event from another calendar, it stays out', async () => {
    const p = phone({ events: jest.fn<CalendarDeps['events']>(async () => EVENTS) });
    const out = await readAgenda(p, TICKED, '2026-10-08', '2026-10-08', 'UTC');
    expect(JSON.stringify(out)).not.toContain('Unticked');
  });

  it('reads at most 14 days, and only real days in order', async () => {
    const p = phone();
    expect(await readAgenda(p, TICKED, '2026-10-08', '2026-10-21', 'UTC')).toHaveProperty('agenda');
    expect(await readAgenda(p, TICKED, '2026-10-08', '2026-10-22', 'UTC')).toEqual({ problem: 'bad_days' });
    expect(await readAgenda(p, TICKED, '2026-10-09', '2026-10-08', 'UTC')).toEqual({ problem: 'bad_days' });
    expect(await readAgenda(p, TICKED, 'today', '2026-10-08', 'UTC')).toEqual({ problem: 'bad_days' });
  });

  it('is "off" when switched off, when nothing is ticked, or when the ticked calendars are gone', async () => {
    const p = phone();
    expect(await readAgenda(p, { on: false, ticked: ['home'] }, '2026-10-08', '2026-10-08', 'UTC')).toEqual({ problem: 'off' });
    expect(await readAgenda(p, { on: true, ticked: [] }, '2026-10-08', '2026-10-08', 'UTC')).toEqual({ problem: 'off' });
    expect(await readAgenda(p, { on: true, ticked: ['deleted'] }, '2026-10-08', '2026-10-08', 'UTC')).toEqual({ problem: 'off' });
    expect(p.events).not.toHaveBeenCalled();
  });

  it('says when the permission was taken away, or the phone failed', async () => {
    expect(await readAgenda(phone({ permission: jest.fn<CalendarDeps['permission']>(async () => refused) }), TICKED, '2026-10-08', '2026-10-08', 'UTC')).toEqual({ problem: 'permission' });
    const broken = phone({ events: jest.fn<CalendarDeps['events']>(async () => { throw new Error('provider died'); }) });
    expect(await readAgenda(broken, TICKED, '2026-10-08', '2026-10-08', 'UTC')).toEqual({ problem: 'failed' });
  });

  it('without the phone’s time zone, uses a ticked calendar’s; with neither, it does not guess', async () => {
    const out = await readAgenda(phone(), TICKED, '2026-10-08', '2026-10-08', null);
    expect('agenda' in out && out.agenda.time_zone).toBe('America/New_York');
    expect(await readAgenda(phone(), { on: true, ticked: ['secret'] }, '2026-10-08', '2026-10-08', null)).toEqual({ problem: 'failed' });
  });

  it('sends at most 300 events', async () => {
    const many = Array.from({ length: 400 }, (_, i): PhoneEvent => ({ calendarId: 'home', title: `e${i}`, startDate: at('2026-10-08', 8), endDate: at('2026-10-08', 9) }));
    const out = await readAgenda(phone({ events: jest.fn<CalendarDeps['events']>(async () => many) }), TICKED, '2026-10-08', '2026-10-08', 'UTC');
    expect('agenda' in out && out.agenda.events.length).toBe(MAX_AGENDA_EVENTS);
  });
});

describe('turnOn and listCalendars (Settings → Calendars)', () => {
  it('asks for the permission only when needed, then ticks every calendar (Q2)', async () => {
    const p = phone({ permission: jest.fn<CalendarDeps['permission']>(async () => notYet) });
    const out = await turnOn(p);
    expect(p.askPermission).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ choice: { on: true, ticked: ['home', 'work', 'secret'] } });
    const already = phone();
    await turnOn(already);
    expect(already.askPermission).not.toHaveBeenCalled();
  });

  it('says how to allow it when refused, and never reads a calendar then', async () => {
    const p = phone({ permission: jest.fn<CalendarDeps['permission']>(async () => refused) });
    expect(await turnOn(p)).toEqual({ error: NO_PERMISSION });
    expect(await listCalendars(p)).toEqual({ error: NO_PERMISSION });
    expect(p.calendars).not.toHaveBeenCalled();
    expect(p.askPermission).not.toHaveBeenCalled();
  });
});
