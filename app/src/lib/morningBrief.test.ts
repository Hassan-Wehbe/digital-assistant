import { describe, expect, it, jest } from '@jest/globals';

import { BRIEFING_OFF, type BriefingSettings } from './briefingSettings';
import type { AgendaResult, CalendarChoice } from './calendar';
import type { SettingsStore } from './calendarSettings';
import { EMPTY_MEMORY } from './dayChoices';
import type { DayAnswer, DayBody, DayPlan } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import { loadMarks, makeMorning, morningStep, saveMarks, type MorningDeps } from './morningBrief';

const APP: BriefingSettings = { ...BRIEFING_OFF, briefing: 'app', time: '07:00' };
const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m);

describe('when Your morning is made', () => {
  it('never with the briefing off, at any time', () => {
    for (const h of [0, 7, 12, 23]) expect(morningStep(BRIEFING_OFF, {}, at(h))).toBe('hidden');
  });

  it('from the briefing time, once a day; hidden for the day when hidden', () => {
    expect(morningStep(APP, {}, at(6, 59))).toBe('hidden');
    expect(morningStep(APP, {}, at(7, 0))).toBe('make');
    expect(morningStep({ ...APP, briefing: 'notify' }, {}, at(9))).toBe('make');
    expect(morningStep(APP, { made: '2026-10-09' }, at(9))).toBe('made_earlier');
    expect(morningStep(APP, { made: '2026-10-08' }, at(9))).toBe('make');
    expect(morningStep(APP, { made: '2026-10-09', hidden: '2026-10-09' }, at(9))).toBe('hidden');
    expect(morningStep(APP, { hidden: '2026-10-08' }, at(9))).toBe('make');
  });

  it('keeps only dates on the phone, per account, and reads anything odd as nothing', async () => {
    const data = new Map<string, string>();
    const store: SettingsStore = { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
    await saveMarks(store, 'alice', { made: '2026-10-09' });
    expect(await loadMarks(store, 'alice')).toEqual({ made: '2026-10-09' });
    expect(await loadMarks(store, 'bob')).toEqual({});
    expect([...data.entries()]).toEqual([['wilma.morning.v1.alice', '{"made":"2026-10-09"}']]);
    data.set('wilma.morning.v1.alice', '{"made":"soon","hidden":5}');
    expect(await loadMarks(store, 'alice')).toEqual({});
    data.set('wilma.morning.v1.alice', 'not json');
    expect(await loadMarks(store, 'alice')).toEqual({});
  });
});

describe('making it, the way My day does', () => {
  const ON: CalendarChoice = { on: true, ticked: ['home'] };
  function deps(read: AgendaResult, answer: DayAnswer) {
    const plan = jest.fn(async (_body: DayBody) => answer);
    const readAgenda = jest.fn(async () => read);
    const d: MorningDeps = {
      calendarChoice: async () => ON,
      readAgenda,
      memory: async () => EMPTY_MEMORY,
      plan,
      timeZone: 'America/New_York',
    };
    return { d, plan, readAgenda };
  }
  const AGENDA: AgendaResult = {
    agenda: {
      from: '2026-10-09', to: '2026-10-09', time_zone: 'America/New_York', calendars: 1,
      events: [{ title: 'Swim', start: '2026-10-09T16:30', end: '2026-10-09T18:30', all_day: false, calendar: 'Home' }],
    },
  };
  const GOOD: DayAnswer = { plan: structuredClone(PLAN) as unknown as DayPlan, usage: {} };

  it('reads today, asks for the plan, and says it in a sentence', async () => {
    const { d, plan, readAgenda } = deps(AGENDA, GOOD);
    const out = await makeMorning(d, at(7, 5), '2026-10-09T07:05');
    expect(readAgenda).toHaveBeenCalledWith(ON, '2026-10-09', 'America/New_York');
    expect(plan.mock.calls[0][0]).toMatchObject({ mode: 'day', date: '2026-10-09', tz: 'America/New_York', now: '2026-10-09T07:05' });
    expect(out).toMatchObject({ summary: expect.stringMatching(/^3 things today\. First: leave by 4:10 pm/) });
  });

  it('calendar off or unreadable: no plan is asked for', async () => {
    const { d, plan } = deps({ problem: 'off' }, GOOD);
    expect(await makeMorning(d, at(8), '2026-10-09T08:00')).toEqual({ problem: 'calendar' });
    expect(plan).not.toHaveBeenCalled();
  });

  it('Pro, the day’s limit and no connection each say so; never throws', async () => {
    expect(await makeMorning(deps(AGENDA, { problem: 'pro_required' }).d, at(8), '')).toEqual({ problem: 'pro' });
    expect(await makeMorning(deps(AGENDA, { problem: 'fair_use', limit: 30 }).d, at(8), '')).toEqual({ problem: 'limit' });
    expect(await makeMorning(deps(AGENDA, { problem: 'connection' }).d, at(8), '')).toEqual({ problem: 'connection' });
    const broken = deps(AGENDA, GOOD).d;
    broken.plan = async () => {
      throw new Error('offline');
    };
    expect(await makeMorning(broken, at(8), '')).toEqual({ problem: 'connection' });
  });
});
