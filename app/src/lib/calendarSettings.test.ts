import { describe, expect, it } from '@jest/globals';

import { loadChoice, OFF, parseChoice, saveChoice, toggleCalendar, type SettingsStore } from './calendarSettings';

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

describe('the calendar choice, kept on this phone per account', () => {
  it('is off until chosen, and per account', async () => {
    const s = memory();
    expect(await loadChoice(s, 'alice')).toEqual(OFF);
    expect(await saveChoice(s, 'alice', { on: true, ticked: ['home', 'work'] })).toBe(true);
    expect(await loadChoice(s, 'alice')).toEqual({ on: true, ticked: ['home', 'work'] });
    expect(await loadChoice(s, 'bob')).toEqual(OFF);
  });

  it('turning off keeps no calendar ids', async () => {
    const s = memory();
    await saveChoice(s, 'alice', { on: false, ticked: ['home'] });
    expect([...s.data.values()]).toEqual([JSON.stringify(OFF)]);
  });

  it('reads anything odd as off, and never throws', async () => {
    for (const raw of [null, '', 'not json', '[]', '{"on":"yes","ticked":[]}', '{"on":true}', '5']) expect(parseChoice(raw)).toEqual(OFF);
    expect(parseChoice('{"on":true,"ticked":["a","a",7,""]}')).toEqual({ on: true, ticked: ['a'] });
    expect(await loadChoice(memory(true), 'alice')).toEqual(OFF);
    expect(await saveChoice(memory(true), 'alice', { on: true, ticked: [] })).toBe(false);
    expect(await loadChoice(memory(), '')).toEqual(OFF);
  });

  it('a tap ticks or unticks one calendar', () => {
    expect(toggleCalendar({ on: true, ticked: ['home', 'work'] }, 'work')).toEqual({ on: true, ticked: ['home'] });
    expect(toggleCalendar({ on: true, ticked: ['home'] }, 'work')).toEqual({ on: true, ticked: ['home', 'work'] });
  });
});
