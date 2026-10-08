// What My day shows: times, drive and weather words, chips, and an event's sum (every number from the plan).
import { describe, expect, it } from '@jest/globals';

import { toDayPlan, type DayDriveRow } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import {
  alertText, clock, dayChips, dayNotes, dayTitle, directionsLink, driveText, eventDetail, eventLine, freeText, minutesText, overlapText,
  range, rainText, titles, todayAndTomorrow,
} from './dayView';

const plan = toDayPlan(PLAN)!;
const t = titles(plan);

describe('times', () => {
  it('reads like a clock', () => {
    expect(clock('2026-10-09T16:05')).toBe('4:05 pm');
    expect(clock('2026-10-09T00:30')).toBe('12:30 am');
    expect(clock('2026-10-09T12:00')).toBe('12:00 pm');
    expect(range('2026-10-09T16:30', '2026-10-09T18:30')).toBe('4:30–6:30 pm');
    expect(range('2026-10-09T11:30', '2026-10-09T13:30')).toBe('11:30 am–1:30 pm');
    expect(minutesText(25)).toBe('25 min');
    expect(minutesText(145)).toBe('2 h 25 min');
    expect(minutesText(120)).toBe('2 h');
    expect(dayTitle('2026-10-09')).toBe('Friday, Oct 9');
    expect(todayAndTomorrow(new Date(2026, 9, 31, 23, 0))).toEqual({ today: '2026-10-31', tomorrow: '2026-11-01' });
  });
});

describe('rows', () => {
  it('a drive says when to leave, with traffic, the usual time and the parking', () => {
    const d = driveText(plan.rows[0] as DayDriveRow, t);
    expect(d).toEqual({ title: '🚗 Leave for Swim: Sara', detail: '15 min with traffic (usually 10) + 5 to park' });
    expect(driveText(plan.rows[6] as DayDriveRow, t)).toEqual({ title: '🚗 Home from Aquatic Center', detail: '20 min, home by 7:20 pm' });
  });

  it('a drive without a time says why, and a tight one warns', () => {
    const base: DayDriveRow = { kind: 'drive', from: 'Home', to: 'Pool', for_keys: ['swim'] };
    expect(driveText({ ...base, unavailable: 'no_home' }, t).detail).toBe('Set your Home place to time this drive.');
    expect(driveText({ ...base, unavailable: 'no_drive_times' }, t).detail).toBe('Drive time unavailable right now.');
    expect(driveText({ ...base, minutes: 10, tight: true }, t).warn).toMatch(/Tight/);
  });

  it('rain, overlaps, alerts and free time in words', () => {
    expect(rainText(plan.rows[1] as Extract<(typeof plan.rows)[number], { kind: 'rain' }>)).toBe('🌧 90% chance of rain at 4:00 pm at Aquatic Center.');
    const o = overlapText(plan.rows[3] as Extract<(typeof plan.rows)[number], { kind: 'overlap' }>, t);
    expect(o).toEqual({ title: '⚠ Overlap 5:00–6:30 pm', detail: 'Swim: Sara and Swim: Adam are at the same place. One trip can do both.', takeBoth: true });
    expect(alertText({ kind: 'alert', event: 'Flood Watch', severity: 'Moderate', start: '2026-10-09T00:00', end: '2026-10-09T20:00', places: ['Aquatic Center'], for_keys: [] }))
      .toBe('⚠ Flood Watch at Aquatic Center, until 8:00 pm.');
    expect(freeText(plan.rows[5] as Extract<(typeof plan.rows)[number], { kind: 'free' }>)).toBe('Free 7:20–10:00 pm · 2 h 40 min');
  });

  it('an event line shows its place, unless it was found by name only (asked separately)', () => {
    expect(eventLine({ kind: 'event', key: 'a', title: 'A', start: '2026-10-09T16:30', end: '2026-10-09T18:30', place: 'Pool' }, t)).toBe('4:30–6:30 pm · 📍 Pool');
    expect(eventLine({ kind: 'event', key: 'a', title: 'A', start: '2026-10-09T16:30', end: '2026-10-09T18:30', place: 'Pool', by_name_only: true }, t)).toBe('4:30–6:30 pm');
    expect(eventLine({ kind: 'event', key: 'swim', title: 'A', start: '2026-10-09T16:30', end: '2026-10-09T18:30', together_with: ['swim2'] }, t))
      .toBe('4:30–6:30 pm · one trip with Swim: Adam');
  });

  it('chips: drives, the wettest hour, what to sort', () => {
    expect(dayChips(plan).map((c) => c.text)).toEqual(['🚗 1 drive', '🌧 Rain 4:00 pm, 90%', '⚠ 1 to sort']);
    const calm = { ...plan, rows: plan.rows.filter((r) => r.kind !== 'overlap' && r.kind !== 'rain') };
    expect(dayChips(calm).at(-1)).toEqual({ text: '✓ Nothing to sort', tone: 'good' });
  });

  it('says once when drive times or weather are missing', () => {
    expect(dayNotes(plan)).toEqual([]);
    expect(dayNotes({ ...plan, drive_times: 'unavailable' })).toEqual(['Drive times are unavailable right now.']);
    expect(dayNotes({ ...plan, weather: 'outside_us' })).toEqual(['Weather is only available in the US.']);
  });
});

describe('one event', () => {
  it('shows the sum behind the leave-by time and the hourly rain there', () => {
    const d = eventDetail(plan, 'swim', false)!;
    expect(d.drive).toEqual({ from: 'Home', minutes: 15, typical: 10, buffer: 5, leaveAt: '2026-10-09T16:10' });
    expect(d.rain).toEqual([{ hour: '3 pm', pct: 30, high: false }, { hour: '4 pm', pct: 90, high: true }]);
    expect(eventDetail(plan, 'nope', false)).toBeNull();
  });

  it('opens directions in the maps app, to a point or to the place’s words', () => {
    expect(directionsLink({ lat: 28.6, lng: -81.2 })).toBe('https://www.google.com/maps/dir/?api=1&destination=28.6,-81.2&travelmode=driving');
    expect(directionsLink('Aquatic Center, Oviedo')).toBe('https://www.google.com/maps/dir/?api=1&destination=Aquatic%20Center%2C%20Oviedo&travelmode=driving');
  });
});
