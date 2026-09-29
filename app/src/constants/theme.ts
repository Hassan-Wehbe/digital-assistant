// Colours shared with the vault and upload pages (docs/vault/vault.css).
export const Colors = {
  light: { text: '#1c1f24', muted: '#5d6570', background: '#f6f7f9', card: '#ffffff', line: '#dde1e6', accent: '#2754c5' },
  dark: { text: '#e8eaed', muted: '#9aa2ad', background: '#121417', card: '#1b1e23', line: '#2e333a', accent: '#7aa2ff' },
} as const;

export type Scheme = keyof typeof Colors;
