// Colours shared with the vault and upload pages (docs/vault/vault.css). The tints (tint, rain,
// good, warnBg) are My day's rows, as in docs/day-planner-mockups.html.
export const Colors = {
  light: {
    text: '#1c1f24', muted: '#5d6570', background: '#f6f7f9', card: '#ffffff', line: '#dde1e6', accent: '#2754c5', danger: '#b3261e', warn: '#9a6400',
    tint: '#e8eefb', rain: '#2f6f8f', rainBg: '#e2f0f6', good: '#1d6b3a', goodBg: '#e3f2e8', warnBg: '#fbf1de',
  },
  dark: {
    text: '#e8eaed', muted: '#9aa2ad', background: '#121417', card: '#1b1e23', line: '#2e333a', accent: '#7aa2ff', danger: '#ff8a80', warn: '#d08a00',
    tint: '#1d2638', rain: '#8cc8e6', rainBg: '#15252e', good: '#8fd6a6', goodBg: '#16261c', warnBg: '#2a2214',
  },
} as const;

export type Scheme = keyof typeof Colors;
