// One card shell in the chat (docs/ui-review.md, "Chat cards", plan step 6): every card uses
// ChatCard; Cancel comes before Delete, Delete is red text and never filled, finished delete cards
// are one dimmed line; the vault card still opens the app's own screens, never a server link.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const cards = read('components/ChatCards.tsx');
const bubble = read('components/ChatBubble.tsx');

describe('chat cards', () => {
  it('all use the one shell (no old Card blocks left)', () => {
    for (const src of [cards, bubble]) expect(src).not.toMatch(/<Card\b/);
    for (const icon of ['🗑', '🔒', '🗒']) expect(cards).toContain(`icon="${icon}"`);
    expect(bubble).toContain('icon="⚠️"');
  });

  it('delete: Cancel first, then Delete as red text (never filled)', () => {
    const actions = cards.slice(cards.indexOf('icon="🗑"\n      actions={'));
    const cancel = actions.indexOf('title={entry.cancelLabel}');
    const del = actions.indexOf('entry.confirmLabel}');
    expect(cancel).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(cancel);
    expect(actions.slice(del, actions.indexOf('/>', del))).toContain('kind="danger"');
  });

  it('a finished delete card is one dimmed line', () => {
    for (const t of ['Deleted ${title}', 'Left ${title} alone', 'Not done: ${title}']) {
      expect(cards).toContain(`<ChatCardDone icon="🗑" text={\`${t}\`} />`);
    }
  });

  it('the vault card opens only the app\'s own vault screens', () => {
    const vault = cards.slice(cards.indexOf('export function VaultCard'), cards.indexOf('export function NotesCard'));
    expect(vault).toContain('const route = vaultRoute(entry);');
    expect(vault).not.toMatch(/Linking|openURL|entry\.link/);
  });
});
