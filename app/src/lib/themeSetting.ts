// Settings → Theme: light, dark, or the same as the phone (the default). One choice per phone,
// not per account (it is about the screen, not the user's data), kept in the phone's own settings
// store. Applied app-wide with React Native's Appearance.setColorScheme, so useColors(), the
// navigation theme, the status bar and the system's own dialogs all follow it.

import type { SettingsStore } from './calendarSettings';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const DEFAULT_THEME: ThemeChoice = 'system';

export const THEME_CHOICES: { theme: ThemeChoice; title: string }[] = [
  { theme: 'system', title: 'Same as the phone' },
  { theme: 'light', title: 'Light' },
  { theme: 'dark', title: 'Dark' },
];

export const THEME_KEY = 'wilma.theme.v1';

export const isThemeChoice = (v: unknown): v is ThemeChoice => v === 'system' || v === 'light' || v === 'dark';

/** The part of React Native's Appearance used here (so the tests need no phone). */
export interface AppearanceLike {
  setColorScheme(scheme: 'light' | 'dark' | 'unspecified'): void;
}

/** The saved choice; the default when nothing (or something unreadable) is saved. */
export async function loadTheme(store: SettingsStore): Promise<ThemeChoice> {
  try {
    const v = await store.get(THEME_KEY);
    return isThemeChoice(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Saves the choice; false when the phone could not store it (the theme still changes for now). */
export async function saveTheme(store: SettingsStore, theme: ThemeChoice): Promise<boolean> {
  try {
    await store.set(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Shows the app in this theme ("Same as the phone" hands the choice back to the phone). */
export function applyTheme(appearance: AppearanceLike, theme: ThemeChoice): void {
  try {
    appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
  } catch {
    // An older phone without the override keeps following its own setting.
  }
}
