// Calendar entries from the chat (D31, docs/alarms-calendar-plan.md step 3): the 📅 card read from
// the stream and from a saved chat, nothing written without the tap, the chosen calendar used, a
// read-only (or unticked) calendar never offered or written to, every field checked again on the
// phone before writing, create only, "New events go to", and the overlap line (Q13).
import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  ADD_FAILED, addEvent, defaultTarget, NO_PERMISSION, NOT_WRITABLE, toPhoneEvent, TURN_ON_TO_ADD, writableCalendars,
  type AgendaEvent, type CalendarChoice, type CalendarDeps, type PhoneCalendar,
} from './calendar';
import { chooseTarget, parseChoice, saveChoice, toggleCalendar, type SettingsStore } from './calendarSettings';
import { CAN } from './chatClient';
import { toEntry } from './chatStore';
import { toChatEvent } from './chatStream';
import { chatReducer, initialChat, type Entry } from './chatThread';
import {
  CAN_CALENDAR_ADD, eventCardText, eventProblem, moveEnd, moveStart, moveToDay, overlapLine, toEventData, type EventCardData,
} from './phoneActions';

/** A saved chat read back, as chatStore does entry by entry. */
const restoreEntries = (raw: unknown[]) => raw.map(toEntry).filter((e): e is Entry => e !== null);

/** 2026-10-10, a Saturday, 9:00 am on this phone. */
const NOW = new Date(2026, 9, 10, 9, 0);

const CALENDARS: PhoneCalendar[] = [
  { id: 'home', title: 'Personal', account: 'me@gmail.com', writable: true, primary: true },
  { id: 'family', title: 'Family', account: 'me@gmail.com', writable: true },
  { id: 'holidays', title: 'Holidays in United States', account: 'me@gmail.com', writable: false },
  { id: 'work', title: 'Work', account: 'me@work.example', writable: true },
];
/** Ticked: all but Work. */
const CHOICE: CalendarChoice = { on: true, ticked: ['home', 'family', 'holidays'] };

const DENTIST: EventCardData = { title: 'Dentist', start: '2026-10-14T15:00', end: '2026-10-14T16:00', allDay: false };
const RECITAL: EventCardData = { title: 'Lexi’s recital', start: '2026-10-16', end: '2026-10-16', allDay: true };

function phone(over: Partial<CalendarDeps> = {}) {
  const deps = {
    permission: jest.fn<CalendarDeps['permission']>(async () => ({ granted: true, canAskAgain: true })),
    askPermission: jest.fn<CalendarDeps['askPermission']>(async () => ({ granted: true, canAskAgain: true })),
    calendars: jest.fn<CalendarDeps['calendars']>(async () => CALENDARS),
    events: jest.fn<CalendarDeps['events']>(async () => []),
    allDayInUtc: true,
    createEvent: jest.fn<CalendarDeps['createEvent']>(async () => 'ev-42'),
    ...over,
  };
  return deps;
}

const src = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('the 📅 card in the chat', () => {
  const RAW = { type: 'calendar_add', title: 'Dentist', start: '2026-10-14T15:00', end: '2026-10-14T16:00', all_day: false, location: null };

  it('is read from the stream (the server’s all_day and null location) and added to the thread', () => {
    const event = toChatEvent(RAW);
    expect(event).toEqual({ type: 'calendar_add', ...DENTIST });
    const state = chatReducer(chatReducer(initialChat(), { type: 'send', text: 'Put the dentist on my calendar Tuesday at 3' }), { type: 'event', event: event! });
    expect(state.entries.at(-1)).toMatchObject({ kind: 'event', ...DENTIST });
    expect(toChatEvent({ type: 'calendar_add', title: 'Lexi’s recital', start: '2026-10-16', end: '2026-10-16', all_day: true, location: 'School hall' })).toEqual({
      type: 'calendar_add', ...RECITAL, location: 'School hall',
    });
  });

  it('drops a malformed card: no title, a time that is not one, a day for a timed event', () => {
    for (const bad of [
      { ...RAW, title: '' },
      { ...RAW, title: 'x'.repeat(201) },
      { ...RAW, start: '2026-10-14 15:00' },
      { ...RAW, start: '2026-10-14' },
      { ...RAW, end: 'later' },
      { ...RAW, all_day: true },
      { type: 'calendar_add' },
    ]) {
      expect(toChatEvent(bad)).toBeNull();
    }
    // No end: one hour was the server's job; an all-day event without an end is that one day.
    expect(toEventData({ title: 'Recital', start: '2026-10-16', all_day: true })).toEqual({ title: 'Recital', start: '2026-10-16', end: '2026-10-16', allDay: true });
  });

  it('is read back from a saved chat, and once added it stays added with what was added, never offered again', () => {
    let state = chatReducer(initialChat(), { type: 'send', text: 'dentist Tuesday at 3' });
    state = chatReducer(state, { type: 'event', event: toChatEvent(RAW)! });
    const card = state.entries.at(-1)!;
    const edited = { ...DENTIST, title: 'Dentist (Dr. Cole)', location: ' Oviedo Dental ' };
    state = chatReducer(state, { type: 'event_added', id: card.id, added: { eventId: 'ev-42', calendar: 'Family' }, event: edited });
    const saved = JSON.parse(JSON.stringify(state.entries)) as unknown[];
    const back = restoreEntries(saved).at(-1);
    expect(back).toEqual({
      kind: 'event', id: card.id, title: 'Dentist (Dr. Cole)', start: DENTIST.start, end: DENTIST.end, allDay: false, location: 'Oviedo Dental',
      added: { eventId: 'ev-42', calendar: 'Family' },
    });
    // A second "added" for the same card changes nothing.
    const again = chatReducer(state, { type: 'event_added', id: card.id, added: { eventId: 'ev-43', calendar: 'Personal' }, event: DENTIST });
    expect(again).toBe(state);
    // A saved card not yet added comes back ready to add; a malformed "added" is dropped.
    expect(restoreEntries([{ kind: 'event', id: '7', ...DENTIST }])).toEqual([{ kind: 'event', id: '7', ...DENTIST }]);
    expect(restoreEntries([{ kind: 'event', id: '7', ...DENTIST, added: { eventId: 5 } }])).toEqual([{ kind: 'event', id: '7', ...DENTIST }]);
  });

  it('writes nothing until Add to calendar is tapped: the stream, the thread and the saved chat never touch the calendar', () => {
    const p = phone();
    let state = chatReducer(initialChat(), { type: 'send', text: 'dentist Tuesday at 3' });
    state = chatReducer(state, { type: 'event', event: toChatEvent(RAW)! });
    restoreEntries(JSON.parse(JSON.stringify(state.entries)) as unknown[]);
    expect(p.createEvent).not.toHaveBeenCalled();
    // The card calls addEvent only from the Add to calendar button.
    const cards = src('../components/PhoneCards.tsx');
    expect(cards.match(/addEvent\(/g)).toHaveLength(1);
    expect(cards).toMatch(/async function add\(\) \{[^}]*loadChoice\(deviceSettingsStore, userId\)[^}]*addEvent\(deviceCalendar, choice, target\.id, draft, new Date\(\)\)/);
    expect(cards.match(/void add\(\)/g)).toHaveLength(1);
    expect(cards).toMatch(/title=\{busy \? 'Adding…' : 'Add to calendar'\}\s*onPress=\{\(\) => void add\(\)\}/);
  });

  it('is offered to the server as calendar_add, the name the server uses', () => {
    expect(CAN_CALENDAR_ADD).toBe('calendar_add');
    expect(src('../../../supabase/functions/chat/phone_actions.ts')).toContain('CAN_CALENDAR_ADD = "calendar_add"');
    expect(src('chatClient.ts')).toMatch(/Platform\.OS === 'android' \? \[[^\]]*CAN_CALENDAR_ADD/);
    // These tests run as iPhone: no card there.
    expect(CAN).not.toContain('calendar_add');
  });
});

describe('the one write: create only', () => {
  it('adds the event to the calendar chosen on the card, and gives its id and the calendar’s name', async () => {
    const p = phone();
    expect(await addEvent(p, CHOICE, 'family', DENTIST, NOW)).toEqual({ added: { eventId: 'ev-42', calendar: 'Family' } });
    expect(p.createEvent).toHaveBeenCalledTimes(1);
    expect(p.createEvent).toHaveBeenCalledWith('family', {
      title: 'Dentist', allDay: false, startDate: new Date(2026, 9, 14, 15, 0), endDate: new Date(2026, 9, 14, 16, 0),
    });
  });

  it('never writes to a read-only, unticked or vanished calendar', async () => {
    for (const id of ['holidays', 'work', 'gone']) {
      const p = phone();
      expect(await addEvent(p, CHOICE, id, DENTIST, NOW)).toEqual({ problem: NOT_WRITABLE });
      expect(p.createEvent).not.toHaveBeenCalled();
    }
  });

  it('checks every field again before writing', async () => {
    const bad: EventCardData[] = [
      { ...DENTIST, title: '   ' },
      { ...DENTIST, title: 'x'.repeat(201) },
      { ...DENTIST, location: 'x'.repeat(301) },
      { ...DENTIST, title: 'Garage code 4471' },
      { ...DENTIST, title: 'Wi-Fi', location: 'password: hunter22!' },
      { ...DENTIST, end: '2026-10-14T14:00' },
      { ...DENTIST, end: DENTIST.start },
      { ...DENTIST, start: '2026-10-09T15:00', end: '2026-10-09T16:00' },
      { ...DENTIST, start: '2026-02-30T15:00' },
      { ...DENTIST, end: '2026-10-29T16:00' },
      { ...DENTIST, start: '2027-10-14T15:00', end: '2027-10-14T16:00' },
      { ...RECITAL, end: '2026-10-15' },
      { ...RECITAL, end: '2026-10-30' },
      { ...RECITAL, start: '2026-10-16T10:00' },
    ];
    for (const e of bad) {
      const p = phone();
      const out = await addEvent(p, CHOICE, 'home', e, NOW);
      expect('problem' in out).toBe(true);
      expect(p.createEvent).not.toHaveBeenCalled();
      expect(eventProblem(e, NOW)).not.toBeNull();
    }
    expect(eventProblem({ ...DENTIST, title: 'Garage code 4471' }, NOW)).toMatch(/Vault/);
    // Today, later today, and two weeks of all-day are fine.
    expect(eventProblem({ ...DENTIST, start: '2026-10-10T08:00', end: '2026-10-10T08:30' }, NOW)).toBeNull();
    expect(eventProblem({ ...RECITAL, end: '2026-10-29' }, NOW)).toBeNull();
  });

  it('asks for the calendar permission on the tap when it can; refused, nothing is written', async () => {
    const notYet = phone({ permission: jest.fn<CalendarDeps['permission']>(async () => ({ granted: false, canAskAgain: true })) });
    expect('added' in (await addEvent(notYet, CHOICE, 'home', DENTIST, NOW))).toBe(true);
    expect(notYet.askPermission).toHaveBeenCalledTimes(1);

    const refused = phone({
      permission: jest.fn<CalendarDeps['permission']>(async () => ({ granted: false, canAskAgain: true })),
      askPermission: jest.fn<CalendarDeps['askPermission']>(async () => ({ granted: false, canAskAgain: false })),
    });
    expect(await addEvent(refused, CHOICE, 'home', DENTIST, NOW)).toEqual({ problem: NO_PERMISSION });
    expect(refused.createEvent).not.toHaveBeenCalled();
  });

  it('needs Use my calendar on, and says so; a failing phone is a plain message', async () => {
    const p = phone();
    expect(await addEvent(p, { on: false, ticked: [] }, 'home', DENTIST, NOW)).toEqual({ problem: TURN_ON_TO_ADD });
    expect(p.createEvent).not.toHaveBeenCalled();
    const broken = phone({ createEvent: jest.fn<CalendarDeps['createEvent']>(async () => { throw new Error('provider died'); }) });
    expect(await addEvent(broken, CHOICE, 'home', DENTIST, NOW)).toEqual({ problem: ADD_FAILED });
  });

  it('stores an all-day event at midnight UTC on Android, through the midnight after its last day', () => {
    expect(toPhoneEvent({ ...RECITAL, end: '2026-10-17', location: ' School hall ' }, true)).toEqual({
      title: 'Lexi’s recital', allDay: true, location: 'School hall', timeZone: 'UTC',
      startDate: new Date(Date.UTC(2026, 9, 16)), endDate: new Date(Date.UTC(2026, 9, 18)),
    });
    expect(toPhoneEvent(RECITAL, false)).toEqual({
      title: 'Lexi’s recital', allDay: true, startDate: new Date(2026, 9, 16), endDate: new Date(2026, 9, 17),
    });
  });

  it('has no way to change or delete an event: calendar.ts creates only', () => {
    const lib = src('calendar.ts');
    expect(lib.match(/\.createEvent\(/g)).toHaveLength(2); // addEvent → deps.createEvent → the package's calendar.createEvent
    expect(lib).toMatch(/const eventId = await deps\.createEvent\(target\.id, details\)/);
    for (const call of [/\.update\(/, /\.delete\(/, /updateEvent/, /deleteEvent/, /editInCalendar/, /removeEvent/]) expect(lib).not.toMatch(call);
    expect(lib).toMatch(/create only/i);
  });
});

describe('which calendars are offered', () => {
  it('only ticked calendars the phone lets apps write to; never a read-only one', () => {
    expect(writableCalendars(CALENDARS, CHOICE).map((c) => c.id)).toEqual(['home', 'family']);
    expect(writableCalendars(CALENDARS, { on: false, ticked: ['home'] })).toEqual([]);
    // A calendar that does not say it is writable is not.
    expect(writableCalendars([{ id: 'x', title: 'X', account: null }], { on: true, ticked: ['x'] })).toEqual([]);
  });

  it('new events go to the saved choice, else the primary calendar, else the first; never a read-only one', () => {
    expect(defaultTarget(CALENDARS, CHOICE)?.id).toBe('home');
    expect(defaultTarget(CALENDARS, { ...CHOICE, addTo: 'family' })?.id).toBe('family');
    expect(defaultTarget(CALENDARS, { ...CHOICE, addTo: 'holidays' })?.id).toBe('home');
    expect(defaultTarget(CALENDARS, { ...CHOICE, addTo: 'work' })?.id).toBe('home');
    expect(defaultTarget(CALENDARS, { on: true, ticked: ['family', 'holidays'] })?.id).toBe('family');
    expect(defaultTarget(CALENDARS, { on: true, ticked: ['holidays'] })).toBeNull();
  });

  it('"New events go to" is kept with the choice on this phone, and survives ticking', async () => {
    const data = new Map<string, string>();
    const store: SettingsStore = { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
    const chosen = chooseTarget(CHOICE, 'family');
    expect(await saveChoice(store, 'alice', chosen)).toBe(true);
    expect(parseChoice([...data.values()][0])).toEqual({ ...CHOICE, addTo: 'family' });
    expect(toggleCalendar(chosen, 'holidays')).toEqual({ on: true, ticked: ['home', 'family'], addTo: 'family' });
    expect(parseChoice('{"on":true,"ticked":["a"],"addTo":7}')).toEqual({ on: true, ticked: ['a'] });
    // Turning off keeps nothing.
    await saveChoice(store, 'alice', { on: false, ticked: [], addTo: 'family' });
    expect([...data.values()][0]).toBe('{"on":false,"ticked":[]}');
  });
});

describe('what the card says', () => {
  it('the title and the time, today and tomorrow by name', () => {
    expect(eventCardText(DENTIST, NOW)).toEqual({ title: 'Dentist', when: expect.stringMatching(/^Wed,? Oct 14 · 3:00 pm – 4:00 pm$/) });
    expect(eventCardText({ ...DENTIST, start: '2026-10-11T23:00', end: '2026-10-12T01:00' }, NOW).when).toMatch(/^Tomorrow · 11:00 pm – Mon,? Oct 12 1:00 am$/);
    expect(eventCardText(RECITAL, NOW).when).toMatch(/^Fri,? Oct 16 · all day$/);
    expect(eventCardText({ ...RECITAL, start: '2026-10-10', end: '2026-10-11' }, NOW).when).toBe('Today – Tomorrow · all day');
  });

  it('a changed day keeps the times; a changed start keeps the length; an end before the start is the next day', () => {
    expect(moveToDay(DENTIST, '2026-10-20')).toEqual({ ...DENTIST, start: '2026-10-20T15:00', end: '2026-10-20T16:00' });
    expect(moveToDay({ ...RECITAL, end: '2026-10-17' }, '2026-10-31')).toEqual({ ...RECITAL, start: '2026-10-31', end: '2026-11-01' });
    expect(moveStart(DENTIST, '15:30')).toEqual({ ...DENTIST, start: '2026-10-14T15:30', end: '2026-10-14T16:30' });
    expect(moveStart(DENTIST, '23:30')).toEqual({ ...DENTIST, start: '2026-10-14T23:30', end: '2026-10-15T00:30' });
    expect(moveEnd(DENTIST, '17:15')).toEqual({ ...DENTIST, end: '2026-10-14T17:15' });
    expect(moveEnd(DENTIST, '01:00')).toEqual({ ...DENTIST, end: '2026-10-15T01:00' });
    expect(moveStart(RECITAL, '10:00')).toBe(RECITAL);
  });
});

describe('the overlap line (Q13)', () => {
  const at = (start: string, end: string, more: Partial<AgendaEvent> = {}): AgendaEvent => ({ title: 'Swim', start, end, all_day: false, calendar: 'Family', ...more });

  it('names the first event already there at that time', () => {
    expect(overlapLine(DENTIST, [at('2026-10-14T15:30', '2026-10-14T16:30')])).toBe('You have Swim at 3:30 pm then.');
    expect(overlapLine(DENTIST, [at('2026-10-14T14:00', '2026-10-14T15:30'), at('2026-10-14T15:45', '2026-10-14T17:00', { title: 'Call' })])).toBe(
      'You have Swim at 2:00 pm then and 1 more.',
    );
    expect(overlapLine(DENTIST, [at('2026-10-14T15:00', '2026-10-14T15:30', { title: 'Busy', busy_only: true })])).toBe('You’re busy at 3:00 pm then.');
  });

  it('says nothing for events that only touch, free ones, all-day ones, or a new all-day event', () => {
    expect(overlapLine(DENTIST, [at('2026-10-14T14:00', '2026-10-14T15:00'), at('2026-10-14T16:00', '2026-10-14T17:00')])).toBeNull();
    expect(overlapLine(DENTIST, [at('2026-10-14T15:00', '2026-10-14T16:00', { free: true })])).toBeNull();
    expect(overlapLine(DENTIST, [at('2026-10-14', '2026-10-14', { all_day: true })])).toBeNull();
    expect(overlapLine(RECITAL, [at('2026-10-16T10:00', '2026-10-16T11:00')])).toBeNull();
  });
});

