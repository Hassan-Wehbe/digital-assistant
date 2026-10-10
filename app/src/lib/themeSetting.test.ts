import { describe, expect, it } from '@jest/globals';

import type { SettingsStore } from './calendarSettings';
import { applyTheme, DEFAULT_THEME, loadTheme, saveTheme, THEME_CHOICES, THEME_KEY } from './themeSetting';

function memoryStore(initial: Record<string, string> = {}): SettingsStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
  };
}

describe('theme setting', () => {
  it('defaults to the phone’s own setting', async () => {
    expect(DEFAULT_THEME).toBe('system');
    expect(await loadTheme(memoryStore())).toBe('system');
    expect(await loadTheme(memoryStore({ [THEME_KEY]: 'purple' }))).toBe('system');
    const broken: SettingsStore = { get: () => Promise.reject(new Error('disk')), set: () => Promise.resolve() };
    expect(await loadTheme(broken)).toBe('system');
  });

  it('saves and reads back each choice', async () => {
    const store = memoryStore();
    for (const { theme } of THEME_CHOICES) {
      expect(await saveTheme(store, theme)).toBe(true);
      expect(await loadTheme(store)).toBe(theme);
    }
    const full: SettingsStore = { get: async () => null, set: () => Promise.reject(new Error('full')) };
    expect(await saveTheme(full, 'dark')).toBe(false);
  });

  it('lists the three choices, the phone’s first', () => {
    expect(THEME_CHOICES.map((c) => c.theme)).toEqual(['system', 'light', 'dark']);
  });

  it('applies light and dark, and hands "same as the phone" back to the phone', () => {
    const calls: string[] = [];
    const appearance = { setColorScheme: (s: 'light' | 'dark' | 'unspecified') => void calls.push(s) };
    applyTheme(appearance, 'dark');
    applyTheme(appearance, 'light');
    applyTheme(appearance, 'system');
    expect(calls).toEqual(['dark', 'light', 'unspecified']);
    // A phone without the override: nothing breaks.
    expect(() => applyTheme({ setColorScheme: () => { throw new Error('no'); } }, 'dark')).not.toThrow();
  });
});
