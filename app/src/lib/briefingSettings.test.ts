import { describe, expect, it } from '@jest/globals';

import {
  BRIEFING_OFF, briefingSummary, loadBriefing, parseBriefing, saveBriefing, sendsNotifications, timeText, type BriefingSettings,
} from './briefingSettings';
import type { SettingsStore } from './calendarSettings';

function memory(fail = false): SettingsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => {
      if (fail) throw new Error('disk');
      return data.get(k) ?? null;
    },
    set: async (k, v) => {
      if (fail) throw new Error('disk');
      data.set(k, v);
    },
  };
}

const ON: BriefingSettings = { briefing: 'notify', time: '06:45', leaveAlerts: true, lead: 15 };

describe('the morning briefing settings, kept on this phone per account', () => {
  it('start off, and are per account', async () => {
    const s = memory();
    expect(await loadBriefing(s, 'alice')).toEqual(BRIEFING_OFF);
    expect(BRIEFING_OFF).toEqual({ briefing: 'off', time: '07:00', leaveAlerts: false, lead: 10 });
    expect(await saveBriefing(s, 'alice', ON)).toBe(true);
    expect(await loadBriefing(s, 'alice')).toEqual(ON);
    expect(await loadBriefing(s, 'bob')).toEqual(BRIEFING_OFF);
    expect([...s.data.keys()]).toEqual(['wilma.briefing.v1.alice']);
  });

  it('each setting is its own: the briefing in Wilma only, with leave-by alerts off or on', async () => {
    const s = memory();
    await saveBriefing(s, 'alice', { ...BRIEFING_OFF, briefing: 'app' });
    expect(await loadBriefing(s, 'alice')).toEqual({ ...BRIEFING_OFF, briefing: 'app' });
    await saveBriefing(s, 'alice', { ...BRIEFING_OFF, leaveAlerts: true });
    expect(await loadBriefing(s, 'alice')).toEqual({ ...BRIEFING_OFF, leaveAlerts: true });
  });

  it('reads anything odd as its default, field by field, and never throws', async () => {
    for (const raw of [null, '', 'not json', '[]', '5', 'null']) expect(parseBriefing(raw)).toEqual(BRIEFING_OFF);
    expect(parseBriefing('{"briefing":"loud","time":"25:00","leaveAlerts":"yes","lead":7}')).toEqual(BRIEFING_OFF);
    expect(parseBriefing('{"briefing":"app","time":"7:00","leaveAlerts":true,"lead":20}')).toEqual({ ...BRIEFING_OFF, briefing: 'app', leaveAlerts: true, lead: 20 });
    expect(await loadBriefing(memory(true), 'alice')).toEqual(BRIEFING_OFF);
    expect(await saveBriefing(memory(true), 'alice', ON)).toBe(false);
    expect(await saveBriefing(memory(), '', ON)).toBe(false);
  });

  it('only a notification or alerts need Android’s permission', () => {
    expect(sendsNotifications(BRIEFING_OFF)).toBe(false);
    expect(sendsNotifications({ ...BRIEFING_OFF, briefing: 'app' })).toBe(false);
    expect(sendsNotifications({ ...BRIEFING_OFF, briefing: 'notify' })).toBe(true);
    expect(sendsNotifications({ ...BRIEFING_OFF, leaveAlerts: true })).toBe(true);
  });

  it('says the settings in a line', () => {
    expect(timeText('07:00')).toBe('7:00 am');
    expect(timeText('00:05')).toBe('12:05 am');
    expect(timeText('13:30')).toBe('1:30 pm');
    expect(briefingSummary(BRIEFING_OFF)).toBe('Off');
    expect(briefingSummary({ ...BRIEFING_OFF, briefing: 'app' })).toBe('In Wilma at 7:00 am');
    expect(briefingSummary(ON)).toBe('At 6:45 am, with a notification; leave-by alerts 15 min before');
    expect(briefingSummary({ ...BRIEFING_OFF, leaveAlerts: true })).toBe('Leave-by alerts 10 min before');
  });
});
