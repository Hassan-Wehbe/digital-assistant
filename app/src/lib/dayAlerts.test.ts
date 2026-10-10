import { describe, expect, it } from '@jest/globals';

import { BRIEFING_OFF, type BriefingSettings } from './briefingSettings';
import { leaveAlerts, localTime, MORNING_BODY, morningSummary, mornings, MORNINGS_AHEAD, summaryOf } from './dayAlerts';
import type { DayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';

const plan = (change: Partial<DayPlan> = {}): DayPlan => ({ ...(structuredClone(PLAN) as unknown as DayPlan), ...change });
const ALERTS: BriefingSettings = { ...BRIEFING_OFF, leaveAlerts: true };
const MORNING = new Date(2026, 9, 9, 7, 0); // Oct 9, 7:00 on this phone

describe('leave-by alerts from a day plan', () => {
  it('one per drive to an event, the lead time before leave-by; none for the drive home', () => {
    const out = leaveAlerts(plan(), ALERTS, MORNING);
    expect(out).toEqual([
      {
        id: 'wilma.2026-10-09.leave.0',
        at: new Date(2026, 9, 9, 16, 0),
        title: 'Leave by 4:10 pm for Swim: Sara',
        body: '15 min drive with traffic (usually 10).',
        url: '/day?date=2026-10-09',
      },
    ]);
    expect(leaveAlerts(plan(), { ...ALERTS, lead: 20 }, MORNING)[0].at).toEqual(new Date(2026, 9, 9, 15, 50));
  });

  it('none when the setting is off, and none already past', () => {
    expect(leaveAlerts(plan(), BRIEFING_OFF, MORNING)).toEqual([]);
    expect(leaveAlerts(plan(), ALERTS, new Date(2026, 9, 9, 16, 0))).toEqual([]);
    expect(leaveAlerts(plan(), ALERTS, new Date(2026, 9, 9, 15, 59))).toHaveLength(1);
  });

  it('says a pick-up, a private event as Busy, slow traffic and a tight drive', () => {
    const p = plan();
    p.rows = [
      { kind: 'event', key: 'doc', title: 'Dr. Patel', start: '2026-10-09T09:00', end: '2026-10-09T10:00', private: true },
      { kind: 'drive', from: 'Home', to: 'Clinic', for_keys: ['doc'], leave_at: '2026-10-09T08:30', minutes: 25, typical_minutes: 18, tight: true },
      { kind: 'event', key: 'lexi', title: 'Lexigazer', start: '2026-10-09T08:00', end: '2026-10-09T16:00', drop_off: true },
      { kind: 'drive', from: 'Home', to: 'School', for_keys: ['lexi'], leave_at: '2026-10-09T15:50', minutes: 10, pick_up: true },
    ];
    const [doc, lexi] = leaveAlerts(p, ALERTS, MORNING);
    expect(doc.title).toBe('Leave by 8:30 am for Busy');
    expect(doc.title).not.toContain('Patel');
    expect(doc.body).toBe('25 min drive with traffic (usually 18). Tight: you leave before the event before it ends.');
    expect(lexi.title).toBe('Leave by 3:50 pm to pick up from Lexigazer');
  });

  it('skips drives without a time (no Home, no drive times)', () => {
    const p = plan();
    p.rows = [
      { kind: 'drive', from: 'Home', to: 'Gym', for_keys: ['gym'], unavailable: 'no_home' },
      { kind: 'drive', from: 'Home', to: 'Gym', for_keys: ['gym'], leave_at: '2026-10-09T10:00', unavailable: 'no_drive_times' },
    ];
    expect(leaveAlerts(p, ALERTS, MORNING)).toEqual([]);
  });
});

describe('the day in a sentence', () => {
  it('counts the things, names the first drive and the rain', () => {
    expect(summaryOf(plan())).toBe(
      '3 things today. First: leave by 4:10 pm for Swim: Sara (15 min). Rain likely at 4:00 pm at Aquatic Center.',
    );
  });

  it('a weather alert, an empty day, and events shown as Free not counted', () => {
    const p = plan({ all_day: [] });
    p.rows = [
      { kind: 'event', key: 'x', title: 'Gym (Free)', start: '2026-10-09T09:00', end: '2026-10-09T10:00', free: true },
      { kind: 'alert', event: 'Flood Watch', severity: 'Moderate', start: '2026-10-09T12:00', places: ['Home'], for_keys: [] },
    ];
    expect(summaryOf(p)).toBe('Nothing planned today. ⚠ Flood Watch.');
  });
});

describe('the morning greetings', () => {
  const NOTIFY: BriefingSettings = { ...BRIEFING_OFF, briefing: 'notify', time: '07:30' };

  it('the next mornings at the briefing time, from today when it is still ahead', () => {
    const out = mornings(NOTIFY, MORNING);
    expect(out).toHaveLength(MORNINGS_AHEAD);
    expect(out[0]).toEqual({ id: 'wilma.2026-10-09.morning', at: new Date(2026, 9, 9, 7, 30), title: 'Good morning', body: MORNING_BODY, url: '/day?date=2026-10-09' });
    expect(out[6].id).toBe('wilma.2026-10-15.morning');
    // Past today's time: tomorrow first.
    expect(mornings(NOTIFY, new Date(2026, 9, 9, 7, 30))[0].id).toBe('wilma.2026-10-10.morning');
    // Across the month's end.
    expect(mornings(NOTIFY, new Date(2026, 9, 30, 8, 0)).map((m) => m.id).slice(0, 3)).toEqual([
      'wilma.2026-10-31.morning', 'wilma.2026-11-01.morning', 'wilma.2026-11-02.morning',
    ]);
  });

  it('none when the briefing is off or in Wilma only', () => {
    expect(mornings(BRIEFING_OFF, MORNING)).toEqual([]);
    expect(mornings({ ...NOTIFY, briefing: 'app' }, MORNING)).toEqual([]);
  });

  it('reads the plan’s local times', () => {
    expect(localTime('2026-10-09T16:10')).toEqual(new Date(2026, 9, 9, 16, 10));
    expect(localTime('2026-10-09')).toBeNull();
    expect(localTime('soon')).toBeNull();
  });
});

describe('the morning’s summary from a plan made before it', () => {
  const NOTIFY: BriefingSettings = { ...BRIEFING_OFF, briefing: 'notify', time: '07:30' };
  const EVENING = new Date(2026, 9, 8, 21, 15); // the evening before Oct 9

  it('planned the evening before: replaces that morning’s greeting', () => {
    expect(morningSummary(plan(), NOTIFY, EVENING)).toEqual({
      id: 'wilma.2026-10-09.morning',
      at: new Date(2026, 9, 9, 7, 30),
      title: 'Your day',
      body: 'From yesterday’s plan: 3 things today. First: leave by 4:10 pm for Swim: Sara (15 min). Rain likely at 4:00 pm at Aquatic Center.',
      url: '/day?date=2026-10-09',
    });
  });

  it('planned the same morning before the briefing time says when', () => {
    expect(morningSummary(plan(), NOTIFY, new Date(2026, 9, 9, 6, 5))?.body).toMatch(/^From your plan at 6:05 am: 3 things today\./);
  });

  it('none after the briefing time, for a day further ahead, or unless sent as a notification', () => {
    expect(morningSummary(plan(), NOTIFY, MORNING)).toEqual(expect.objectContaining({ id: 'wilma.2026-10-09.morning' }));
    expect(morningSummary(plan(), NOTIFY, new Date(2026, 9, 9, 7, 30))).toBeNull();
    expect(morningSummary(plan(), NOTIFY, new Date(2026, 9, 7, 21, 0))).toBeNull();
    expect(morningSummary(plan(), { ...NOTIFY, briefing: 'app' }, EVENING)).toBeNull();
    expect(morningSummary(plan(), BRIEFING_OFF, EVENING)).toBeNull();
  });
});
