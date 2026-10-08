// My day's plan (day planner step 4): checked field by field, and the client for {"mode":"day"}.
import { describe, expect, it } from '@jest/globals';

import { dayClient, toDayAnswer, toDayPlan, type DayBody, type JsonFetch } from './dayPlan';
import { PLAN } from './dayPlan.fixture';
import { WilmaError } from './wilma';


describe('the plan from the server', () => {
  it('keeps every known row and field', () => {
    const p = toDayPlan(PLAN)!;
    expect(p.rows).toHaveLength(7);
    expect(p.rows[0]).toEqual(PLAN.rows[0]);
    expect(p.rows[3]).toEqual(PLAN.rows[3]);
    expect(p.weather_at[0].hourly[1]).toEqual({ at: '2026-10-09T16:00', rain_pct: 90 });
    expect(p.credits).toEqual(PLAN.credits);
    expect(p.home).toEqual({ set: true, label: 'Home' });
    expect(p.all_day).toEqual([{ key: 'bday', title: 'Mum’s birthday' }]);
  });

  it('drops unknown rows and fields, and rows that do not check', () => {
    const p = toDayPlan({
      ...PLAN,
      secret: 'x',
      rows: [
        { kind: 'teleport', to: 'Mars' },
        { kind: 'event', key: 'a', title: 'A', start: 'soon', end: '2026-10-09T10:00' },
        { kind: 'rain', place: 'Pool', for_keys: [], start: '2026-10-09T16:00', end: '2026-10-09T17:00', chance_pct: 140 },
        { kind: 'drive', from: 'Home', to: 'Pool', for_keys: ['a'], minutes: 12, token: 'pk.secret', coordinates: [1, 2] },
      ],
    })!;
    expect(p).not.toHaveProperty('secret');
    expect(p.rows).toEqual([{ kind: 'drive', from: 'Home', to: 'Pool', for_keys: ['a'], minutes: 12 }]);
  });

  it('is not a plan without a date, a home or rows', () => {
    expect(toDayPlan(null)).toBeNull();
    expect(toDayPlan({ ...PLAN, date: 'tomorrow' })).toBeNull();
    expect(toDayPlan({ ...PLAN, rows: undefined })).toBeNull();
  });

  it('reads each answer the day route gives', () => {
    expect(toDayAnswer(200, { plan: PLAN, usage: { used: 3, limit: 30 } })).toMatchObject({ usage: { used: 3, limit: 30 } });
    expect(toDayAnswer(403, { error: 'pro_required' })).toEqual({ problem: 'pro_required' });
    expect(toDayAnswer(429, { error: 'fair_use', used: 30, limit: 30 })).toEqual({ problem: 'fair_use', used: 30, limit: 30 });
    expect(toDayAnswer(503, { error: 'connection' })).toEqual({ problem: 'connection' });
    expect(toDayAnswer(400, { error: 'bad_request' })).toEqual({ problem: 'connection' });
    expect(toDayAnswer(200, { plan: { nonsense: true } })).toEqual({ problem: 'connection' });
  });
});

const BODY: DayBody = { mode: 'day', date: '2026-10-09', tz: 'America/New_York', events: [] };

function fakeFetch(answers: { status: number; body?: unknown; throws?: boolean }[]) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f: JsonFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const a = answers.shift()!;
    if (a.throws) throw new Error('offline');
    return { status: a.status, json: async () => a.body };
  };
  return { f, calls };
}

describe('the day client', () => {
  it('posts {"mode":"day"} with the token and reads the plan (no stream, no model)', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { plan: PLAN, usage: { used: 1, limit: 30 } } }]);
    const client = dayClient({ url: 'https://x/functions/v1/chat', token: async () => 'tok', refresh: async () => null, fetch: f });
    const out = await client.plan(BODY);
    expect('plan' in out && out.plan.rows).toHaveLength(7);
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].body)).toEqual(BODY);
  });

  it('refreshes the token once after a 401', async () => {
    const { f, calls } = fakeFetch([{ status: 401 }, { status: 403, body: { error: 'pro_required' } }]);
    const client = dayClient({ url: 'u', token: async () => 'old', refresh: async () => 'new', fetch: f });
    expect(await client.plan(BODY)).toEqual({ problem: 'pro_required' });
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer old', 'Bearer new']);
  });

  it('a session that has ended signs out; offline is a connection problem', async () => {
    const ended = dayClient({ url: 'u', token: async () => 'old', refresh: async () => null, fetch: fakeFetch([{ status: 401 }]).f });
    const err = await ended.plan(BODY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WilmaError);
    expect((err as WilmaError).signedOut).toBe(true);
    const offline = dayClient({ url: 'u', token: async () => 't', refresh: async () => 't', fetch: fakeFetch([{ status: 0, throws: true }]).f });
    expect(await offline.plan(BODY)).toEqual({ problem: 'connection' });
  });
});
