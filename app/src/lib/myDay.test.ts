// My day in the app (day planner step 4): Pro read from the server, the Open my day card in the
// chat (the date only, never the plan), and the screens: the plan is kept in memory only.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { toEntry } from './chatStore';
import { toChatEvent } from './chatStream';
import { chatReducer, initialChat, type ChatState } from './chatThread';
import { loadPlan, needsPro } from './pro';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('Pro', () => {
  it('is what the server says; unreadable means "let the server decide"', async () => {
    expect(await loadPlan(async () => ({ data: { plan: 'pro' }, error: null }))).toBe('pro');
    expect(await loadPlan(async () => ({ data: { plan: 'free' }, error: null }))).toBe('free');
    expect(await loadPlan(async () => ({ data: null, error: { message: 'offline' } }))).toBeNull();
    expect(await loadPlan(async () => Promise.reject(new Error('x')))).toBeNull();
    expect(needsPro('free')).toBe(true);
    expect(needsPro('pro')).toBe(false);
    expect(needsPro(null)).toBe(false);
    expect(needsPro(undefined)).toBe(false);
  });
});

describe('Open my day in the chat', () => {
  const asked = () => chatReducer(initialChat(), { type: 'send', text: 'plan my day' });
  const ev = (s: ChatState, raw: unknown) => {
    const event = toChatEvent(raw);
    return event ? chatReducer(s, { type: 'event', event }) : s;
  };

  it('reads the day_plan event', () => {
    expect(toChatEvent({ type: 'day_plan', date: '2026-10-09' })).toEqual({ type: 'day_plan', date: '2026-10-09' });
    expect(toChatEvent({ type: 'day_plan', date: 'tomorrow' })).toBeNull();
  });

  it('puts the card under Wilma’s answer, once it has ended', () => {
    let s = ev(asked(), { type: 'day_plan', date: '2026-10-09' });
    s = ev(s, { type: 'text', text: 'Leave at 4:10 for swim.' });
    expect(s.entries.map((e) => e.kind)).toEqual(['user', 'assistant']);
    s = ev(s, { type: 'done', counted: true });
    expect(s.entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'day']);
    expect(s.entries[2]).toEqual({ kind: 'day', id: '2', date: '2026-10-09' });
    expect(s.dayPlan).toBeNull();
  });

  it('no card when the answer failed, and none from an earlier answer', () => {
    let s = ev(asked(), { type: 'day_plan', date: '2026-10-09' });
    s = ev(s, { type: 'error', code: 'connection', message: 'Trouble connecting.' });
    s = ev(s, { type: 'done', counted: false });
    expect(s.entries.some((e) => e.kind === 'day')).toBe(false);
    s = chatReducer(s, { type: 'retry' });
    s = ev(s, { type: 'done', counted: true });
    expect(s.entries.some((e) => e.kind === 'day')).toBe(false);
  });

  it('the saved thread keeps only the date', () => {
    expect(toEntry({ kind: 'day', id: '4', date: '2026-10-09', plan: { rows: [] }, leave_at: '16:10' })).toEqual({ kind: 'day', id: '4', date: '2026-10-09' });
    expect(toEntry({ kind: 'day', id: '4', date: 'soon' })).toBeNull();
  });
});

describe('the screens', () => {
  const day = read('app/day.tsx');

  it('My day never saves the plan: only the user’s own choices and answers go to the phone', () => {
    // The one write to the phone is the memory (dayChoices.ts), whose type has no place for a plan.
    expect(day.match(/deviceDayMemory\.save\(/g)).toHaveLength(1);
    expect(day).toContain('void deviceDayMemory.save(userId, m)');
    expect(day).not.toMatch(/deviceChatStore|SecureStore|kv-store|AsyncStorage|setItem/);
    expect(day).toMatch(/const \[plan, setPlan\] = useState<DayPlan \| null>\(null\);/);
  });

  it('above the fair-use limit it keeps the plan still on screen', () => {
    expect(day).toMatch(/got\.problem === 'fair_use'[\s\S]*?if \(shown\.current\) setNote/);
  });

  it('shows the Pro card instead of asking when the server says free', () => {
    expect(day).toContain("const showPro = needsPro(pro) || screen.step === 'pro';");
    expect(day).toContain('if (pro === undefined || needsPro(pro)) return;');
  });

  it('Home has the 🌅 My day tile, with the Pro badge and the Pro card without Pro', () => {
    const home = read('app/index.tsx');
    expect(home).toMatch(/icon="🌅"\s+title="My day"\s+badge=\{needsPro\(pro\) \? 'PRO' : undefined\}/);
    expect(home).toContain("router.push(needsPro(pro) ? '/pro' : '/day')");
  });

  it('an empty chat offers 🌅 Plan my day (Pro), which sends "plan my day" past the router', () => {
    const chat = read('app/chat.tsx');
    expect(chat).toContain("const planMyDay = () => (needsPro(pro) ? router.push('/pro') : void askWilma(PLAN_MY_DAY));");
    expect(chat).toMatch(/ListEmptyComponent=\{[\s\S]*?🌅 Plan my day[\s\S]*?needsPro\(pro\) \? <Badge text="PRO" \/>/);
  });

  it('the chat re-sends one day with the places and choices from My day', () => {
    const provider = read('lib/chat.tsx');
    expect(provider).toMatch(/agendaForChat\(read\.agenda, \{[\s\S]*?geocode: phoneGeocode\(deviceGeocoder\)/);
  });

  it('My day’s memory is forgotten on sign-out, like the chat thread', () => {
    expect(read('lib/auth.tsx')).toMatch(/deviceChatStore\.forgetOthers\(keep\);[\s\S]*?deviceDayMemory\.forgetOthers\(keep\);/);
  });
});
