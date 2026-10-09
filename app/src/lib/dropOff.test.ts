// 🚸 Drop off & pick up, and events shown as Free (day planner, owner's versionCode 15 phone test:
// Lexi's 8:00-4:00 event kept the whole day busy, so lunch never fitted).
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { trimEvent, type PhoneEvent } from './calendar';
import { placeEvents, withKeys } from './dayAgenda';
import { EMPTY_MEMORY, isDropOff, parseMemory, toggleDropOff } from './dayChoices';
import { toDayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import { driveText, eventDetail, eventLine, titles } from './dayView';

const SCHOOL: PhoneEvent = {
  calendarId: '1', title: 'Lexigazer', startDate: '2026-10-09T08:00:00', endDate: '2026-10-09T16:00:00', allDay: false, location: '12 School Rd',
};

describe('🚸 drop off & pick up', () => {
  it('is remembered by title (any spacing or case), turned off again, and survives an old memory without it', () => {
    const on = toggleDropOff(EMPTY_MEMORY, 'Lexigazer');
    expect(isDropOff(on, '  lexigazer ')).toBe(true);
    expect(isDropOff(toggleDropOff(on, 'LEXIGAZER'), 'Lexigazer')).toBe(false);
    expect(parseMemory({ choices: [], places: {}, found: {} }, '2026-10-09').drop_off).toEqual([]);
    expect(parseMemory({ ...on, drop_off: ['lexigazer', 7, ''] }, '2026-10-09').drop_off).toEqual(['lexigazer']);
  });

  it('is sent with the event, with its place, for the planner', async () => {
    const event = trimEvent(SCHOOL, 'Family', false)!;
    const memory = toggleDropOff({ ...EMPTY_MEMORY, found: { '12 school rd': { lat: 28.6, lng: -81.2 } } }, 'Lexigazer');
    const { events } = await placeEvents(withKeys([event]), memory);
    expect(events[0]).toMatchObject({ title: 'Lexigazer', drop_off: true, point: { lat: 28.6, lng: -81.2 } });
    const off = await placeEvents(withKeys([event]), { ...memory, drop_off: [] });
    expect(off.events[0].drop_off).toBeUndefined();
  });

  it('shows the pick-up drive and the leave-by time to go back', () => {
    const plan = toDayPlan({
      ...PLAN,
      rows: [
        { kind: 'drive', from: 'Home', to: '12 School Rd', for_keys: ['lexi'], leave_at: '2026-10-09T07:40', arrive_by: '2026-10-09T08:00', minutes: 15, buffer_min: 5 },
        { kind: 'event', key: 'lexi', title: 'Lexigazer', start: '2026-10-09T08:00', end: '2026-10-09T16:00', place: '12 School Rd', drop_off: true },
        { kind: 'drive', from: 'Home', to: '12 School Rd', for_keys: ['lexi'], leave_at: '2026-10-09T15:40', arrive_by: '2026-10-09T16:00', minutes: 15, buffer_min: 5, pick_up: true },
      ],
    })!;
    const t = titles(plan);
    const [drop, event, pick] = plan.rows;
    expect(driveText(drop as never, t).title).toBe('🚗 Leave for Lexigazer');
    expect(driveText(pick as never, t).title).toBe('🚗 Leave to pick up from Lexigazer');
    expect(eventLine(event as never, t)).toContain('🚸 drop off & pick up');
    expect(eventDetail(plan, 'lexi', false)).toMatchObject({ drive: { leaveAt: '2026-10-09T07:40' }, pickUpLeaveAt: '2026-10-09T15:40' });
  });

  it('the event detail offers the choice (and the way back)', () => {
    const screen = readFileSync(resolve(__dirname, '..', 'components/DayEventDetail.tsx'), 'utf8');
    expect(screen).toContain("dropOff ? '🚸 I stay there' : '🚸 Drop off & pick up'");
    expect(readFileSync(resolve(__dirname, '..', 'app/day.tsx'), 'utf8')).toContain('onToggleDropOff={() => ev && change(toggleDropOff(memory, ev.title))}');
  });
});

describe('shown as Free in the calendar', () => {
  it('is sent as free (timed events only) and shown so', () => {
    expect(trimEvent({ ...SCHOOL, availability: 'free' }, 'Family', false)?.free).toBe(true);
    expect(trimEvent({ ...SCHOOL, availability: 'busy' }, 'Family', false)?.free).toBeUndefined();
    expect(trimEvent({ ...SCHOOL, availability: 'free', allDay: true }, 'Family', false)?.free).toBeUndefined();
    const plan = toDayPlan({ ...PLAN, rows: [{ kind: 'event', key: 'h', title: 'Office hours', start: '2026-10-09T09:00', end: '2026-10-09T17:00', free: true }] })!;
    expect(eventLine(plan.rows[0] as never, titles(plan))).toContain('shown as free');
  });
});
