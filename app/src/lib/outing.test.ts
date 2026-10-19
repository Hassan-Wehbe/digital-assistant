// Date night and family day (planners step 3, D40): the plan read back field by field, the client,
// the default days, who is coming as roles and ages only (never a name, Q4), one calendar event with
// the steps in its notes (Q6; a password-like line never goes into it, rule 9), Use this one, and
// Another idea leaving out the places just shown.
import { describe, expect, it } from '@jest/globals';

import { toPhoneEvent } from './calendar';
import type { Member } from './household';
import {
  avoidOf, clock, nextWeekday, outingClient, planEvent, rainLine, stepDetail, toOutingAnswer, toOutingPlan, whoFrom, withAlternative,
  type JsonFetch, type OutingBody,
} from './outing';
import { eventProblem } from './phoneActions';
import { WilmaError } from './wilma';

const PLACE = { id: 'p1', title: 'Tawlet', kind: 'restaurant', cuisine: ['lebanese'], price_level: 2, address: 'Armenia St, Beirut', lat: 33.89, lng: 35.52 };
const WALK = { id: 'p2', title: 'Corniche', kind: 'to-visit', lat: 33.9, lng: 35.48 };
const PLAN = {
  kind: 'date', date: '2026-10-23', title: 'Dinner and a walk', from: 'Home', leave_at: '19:10',
  steps: [
    { start: '19:30', end: '21:00', line: 'Your 5-star farmers’ kitchen.', place: PLACE, drive_min: 20 },
    { start: '21:15', end: '22:00', line: 'A walk by the sea.', place: WALK, drive_min: 10 },
  ],
  back_home_min: 15,
  alternative: { place: { id: 'p3', title: 'Café Younes', kind: 'cafe', lat: 33.89, lng: 35.48 }, line: 'Or coffee.', minutes: 12 },
  rain: [{ at: '2026-10-23T20:00', rain_pct: 10 }, { at: '2026-10-23T21:00', rain_pct: 60 }],
  credits: ['Drive times © Mapbox'],
};

describe('the plan from the server', () => {
  it('keeps every known field', () => {
    const p = toOutingPlan(PLAN)!;
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0]).toEqual(PLAN.steps[0]);
    expect(p.alternative?.place.title).toBe('Café Younes');
    expect(p.leave_at).toBe('19:10');
  });

  it('drops odd steps and fields; no place left is no plan', () => {
    const p = toOutingPlan({
      ...PLAN,
      steps: [{ ...PLAN.steps[0], extra: 'x' }, { start: '25:00', end: '26:00', line: 'x', place: WALK }, { start: '21:00', end: '22:00', line: 'x' }],
      leave_at: 'soon',
      title: '',
    })!;
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).not.toHaveProperty('extra');
    expect(p).not.toHaveProperty('leave_at');
    expect(p.title).toBe('Date night');
    expect(toOutingPlan({ ...PLAN, steps: [{ start: '10:00', end: '11:00', line: 'h', home: true }] })).toBeNull();
    expect(toOutingPlan({ ...PLAN, kind: 'vacation' })).toBeNull();
    expect(toOutingPlan({ ...PLAN, steps: [{ ...PLAN.steps[0], place: { ...PLACE, lat: 999 } }] })).toBeNull();
  });

  it('reads each answer the route can give', () => {
    expect(toOutingAnswer(200, { plan: PLAN, usage: { used: 3, limit: 30 } })).toMatchObject({ usage: { used: 3, limit: 30 } });
    expect(toOutingAnswer(200, { plan: null, reason: 'no_places' })).toEqual({ empty: 'no_places' });
    expect(toOutingAnswer(403, { error: 'pro_required' })).toEqual({ problem: 'pro_required' });
    expect(toOutingAnswer(429, { error: 'allowance_used' })).toEqual({ problem: 'allowance_used' });
    expect(toOutingAnswer(429, { error: 'fair_use' })).toEqual({ problem: 'fair_use' });
    expect(toOutingAnswer(503, {})).toEqual({ problem: 'connection' });
    expect(toOutingAnswer(200, { plan: { nope: 1 } })).toEqual({ problem: 'connection' });
  });
});

describe('the client', () => {
  const body: OutingBody = { mode: 'outing', kind: 'date', date: '2026-10-23', tz: 'Asia/Beirut', events: [] };

  it('posts with the token, refreshes once on 401, and signs out when that fails', async () => {
    const calls: string[] = [];
    let n = 0;
    const f: JsonFetch = async (_url, init) => {
      calls.push(init.headers.Authorization);
      n += 1;
      return n === 1 ? { status: 401, json: async () => ({}) } : { status: 200, json: async () => ({ plan: PLAN }) };
    };
    const c = outingClient({ url: 'u', token: async () => 'a', refresh: async () => 'b', fetch: f });
    expect(await c.plan(body)).toHaveProperty('plan');
    expect(calls).toEqual(['Bearer a', 'Bearer b']);
    const dead = outingClient({ url: 'u', token: async () => 'a', refresh: async () => null, fetch: async () => ({ status: 401, json: async () => ({}) }) });
    await expect(dead.plan(body)).rejects.toBeInstanceOf(WilmaError);
    const offline = outingClient({ url: 'u', token: async () => 'a', refresh: async () => 'b', fetch: async () => { throw new Error('offline'); } });
    expect(await offline.plan(body)).toEqual({ problem: 'connection' });
  });
});

describe('what the screens need', () => {
  it('finds the coming Friday or Saturday, today included', () => {
    expect(nextWeekday('2026-10-19', 5)).toBe('2026-10-23');
    expect(nextWeekday('2026-10-23', 5)).toBe('2026-10-23');
    expect(nextWeekday('2026-10-25', 6)).toBe('2026-10-31');
  });

  it('turns the household into roles and ages, never names (Q4)', () => {
    const m = (id: string, label: string, kind: 'adult' | 'child', birth_year: number | null): Member => ({ id, label, kind, birth_year, position: 0 });
    const who = whoFrom([m('1', 'Me', 'adult', null), m('2', 'Sam', 'adult', null), m('3', 'Lea', 'child', 2020), m('4', 'Kid', 'child', null)], 2026);
    expect(who).toEqual({ adults: 2, child_ages: [6] });
    expect(JSON.stringify(who)).not.toMatch(/Me|Sam|Lea|Kid/);
  });

  it('says each step and the weather plainly', () => {
    expect(clock('19:30')).toBe('7:30 pm');
    expect(stepDetail(PLAN.steps[0] as never)).toBe('lebanese · $$ · 20 min drive');
    expect(rainLine(toOutingPlan(PLAN)!)).toBe('Rain likely around 9:00 pm (60%).');
    expect(rainLine({ ...toOutingPlan(PLAN)!, rain: [{ at: '2026-10-23T20:00', rain_pct: 5 }] })).toBe('Dry, by the forecast.');
    expect(rainLine({ ...toOutingPlan(PLAN)!, rain: [] })).toBeNull();
  });

  it('makes one calendar event for the whole plan, its steps in the notes (Q6)', () => {
    const e = planEvent(toOutingPlan(PLAN)!);
    expect(e).toMatchObject({ title: 'Dinner and a walk', start: '2026-10-23T19:30', end: '2026-10-23T22:00', allDay: false, location: 'Armenia St, Beirut' });
    expect(e.notes).toBe('7:10 pm Leave Home\n7:30 pm Tawlet: Your 5-star farmers’ kitchen.\n9:15 pm Corniche: A walk by the sea.\nPlanned with Wilma.');
    expect(eventProblem(e, new Date('2026-10-19T12:00:00'))).toBeNull();
    expect(toPhoneEvent(e, true)).toMatchObject({ notes: e.notes, location: 'Armenia St, Beirut' });
  });

  it('never writes password-like notes into a calendar (rule 9)', () => {
    const e = { ...planEvent(toOutingPlan(PLAN)!), notes: 'Door code: 4831, password hunter2' };
    expect(eventProblem(e, new Date('2026-10-19T12:00:00'))).toMatch(/password or code/);
    expect(eventProblem({ ...e, notes: 'x'.repeat(2001) }, new Date('2026-10-19T12:00:00'))).toMatch(/notes shorter/);
  });

  it('uses the alternative in the first place’s step, and Another idea avoids the places shown', () => {
    const p = withAlternative(toOutingPlan(PLAN)!);
    expect(p.steps[0].place?.title).toBe('Café Younes');
    expect(p.steps[0].drive_min).toBe(12);
    expect(p.leave_at).toBe('19:18');
    expect(p).not.toHaveProperty('alternative');
    expect(avoidOf(toOutingPlan(PLAN)!)).toEqual(['p1', 'p2']);
  });
});

describe('the plan in the chat (plan_outing)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toChatEvent } = require('./chatStream') as typeof import('./chatStream');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chatReducer, initialChat } = require('./chatThread') as typeof import('./chatThread');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toEntry } = require('./chatStore') as typeof import('./chatStore');

  it('is read from the outing_plan event, checked like the screen’s', () => {
    expect(toChatEvent({ type: 'outing_plan', plan: PLAN })).toMatchObject({ type: 'outing_plan', plan: { title: 'Dinner and a walk' } });
    expect(toChatEvent({ type: 'outing_plan', plan: { ...PLAN, steps: [] } })).toBeNull();
  });

  it('becomes a card in the thread, and is never saved with the chat (Mapbox’s terms)', () => {
    let s = chatReducer(initialChat(), { type: 'send', text: 'plan a date night Friday' });
    s = chatReducer(s, { type: 'event', event: toChatEvent({ type: 'outing_plan', plan: PLAN })! });
    const card = s.entries.find((e) => e.kind === 'outing');
    expect(card).toMatchObject({ kind: 'outing', plan: { title: 'Dinner and a walk' } });
    expect(toEntry({ ...card })).toBeNull();
  });
});
