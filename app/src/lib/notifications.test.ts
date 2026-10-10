import { describe, expect, it } from '@jest/globals';

import { BRIEFING_OFF, type BriefingSettings } from './briefingSettings';
import type { DayNote } from './dayAlerts';
import { applyBriefing, forgetOtherAccounts, syncMornings, tapTarget, type Notifier, type Permission, type Scheduled } from './notifications';

/** The phone's schedule, in memory. */
function phone(permission: Permission = 'granted') {
  const list = new Map<string, Scheduled & { title?: string }>();
  const log: string[] = [];
  const n: Notifier = {
    permission: async () => permission,
    ask: async () => permission === 'granted',
    schedule: async (note: DayNote, userId: string) => {
      log.push(`+${note.id}`);
      list.set(note.id, { id: note.id, userId, at: note.at.getTime(), title: note.title });
    },
    cancel: async (id) => {
      log.push(`-${id}`);
      list.delete(id);
    },
    scheduled: async () => [...list.values()],
  };
  return { n, list, log };
}

const NOW = new Date(2026, 9, 9, 6, 0);
const NOTIFY: BriefingSettings = { ...BRIEFING_OFF, briefing: 'notify' };

describe('keeping the morning greetings scheduled', () => {
  it('schedules the next mornings, and leaves them alone when nothing changed', async () => {
    const p = phone();
    expect(await syncMornings(p.n, 'alice', NOTIFY, NOW)).toBe(true);
    expect(p.list.size).toBe(7);
    expect(p.list.get('wilma.2026-10-09.morning')).toMatchObject({ userId: 'alice', at: new Date(2026, 9, 9, 7, 0).getTime() });
    p.log.length = 0;
    await syncMornings(p.n, 'alice', NOTIFY, NOW);
    expect(p.log).toEqual([]);
  });

  it('a new time replaces them; off cancels them', async () => {
    const p = phone();
    await syncMornings(p.n, 'alice', NOTIFY, NOW);
    await syncMornings(p.n, 'alice', { ...NOTIFY, time: '06:30' }, NOW);
    expect(p.list.size).toBe(7);
    expect(p.list.get('wilma.2026-10-09.morning')?.at).toBe(new Date(2026, 9, 9, 6, 30).getTime());
    await syncMornings(p.n, 'alice', { ...NOTIFY, briefing: 'app' }, NOW);
    expect(p.list.size).toBe(0);
  });

  it('a morning already replaced by that day’s summary stays', async () => {
    const p = phone();
    await syncMornings(p.n, 'alice', NOTIFY, NOW);
    p.list.set('wilma.2026-10-10.morning', { ...p.list.get('wilma.2026-10-10.morning')!, title: 'Your day' });
    await syncMornings(p.n, 'alice', NOTIFY, NOW);
    expect(p.list.get('wilma.2026-10-10.morning')?.title).toBe('Your day');
  });

  it('nothing is scheduled without Android’s permission', async () => {
    const p = phone('denied');
    expect(await syncMornings(p.n, 'alice', NOTIFY, NOW)).toBe(false);
    expect(p.list.size).toBe(0);
  });

  it('turning leave-by alerts off cancels them, and leaves other notifications alone', async () => {
    const p = phone();
    p.list.set('wilma.2026-10-09.leave.0', { id: 'wilma.2026-10-09.leave.0', userId: 'alice' });
    p.list.set('other.app.thing', { id: 'other.app.thing' });
    await applyBriefing(p.n, 'alice', BRIEFING_OFF, NOW);
    expect([...p.list.keys()]).toEqual(['other.app.thing']);
  });
});

describe('another account never sees them', () => {
  it('signing out cancels every Wilma notification; signing in cancels the other accounts’', async () => {
    const p = phone();
    await syncMornings(p.n, 'alice', NOTIFY, NOW);
    p.list.set('wilma.2026-10-09.leave.0', { id: 'wilma.2026-10-09.leave.0', userId: 'bob' });
    p.list.set('other.app.thing', { id: 'other.app.thing' });
    await forgetOtherAccounts(p.n, 'alice');
    expect(p.list.has('wilma.2026-10-09.leave.0')).toBe(false);
    expect(p.list.size).toBe(8);
    await forgetOtherAccounts(p.n, null);
    expect([...p.list.keys()]).toEqual(['other.app.thing']);
  });

  it('a tap opens My day only for the account it was made for, and only My day', () => {
    expect(tapTarget({ url: '/day?date=2026-10-09', userId: 'alice' }, 'alice')).toBe('/day?date=2026-10-09');
    expect(tapTarget({ url: '/day', userId: 'alice' }, 'alice')).toBe('/day');
    expect(tapTarget({ url: '/day?date=2026-10-09', userId: 'bob' }, 'alice')).toBe('/');
    expect(tapTarget({ url: '/day?date=2026-10-09', userId: 'alice' }, null)).toBe('/');
    expect(tapTarget({ url: '/vault/abc', userId: 'alice' }, 'alice')).toBe('/');
    expect(tapTarget({ url: 'https://evil.example', userId: 'alice' }, 'alice')).toBe('/');
    expect(tapTarget(null, 'alice')).toBe('/');
  });
});
