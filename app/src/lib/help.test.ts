// Help (docs/help-plan.md, design D37, step 1): short topics, Android-only ones hidden elsewhere,
// "Try it" words that fill the chat box and are never sent by themselves, and the "?" reachable
// from Home, Ask Wilma and Settings.
import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { findCredential } from './credentials';
import { draftText, HELP_TOPICS, helpTopic, helpTopics, MAX_DRAFT } from './help';

const src = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('the topics', () => {
  it('are the eight agreed (Q2), each with a one-line summary and at most four short lines', () => {
    expect(HELP_TOPICS.map((t) => t.id)).toEqual(['notes', 'vault', 'day', 'alarms', 'places', 'memory', 'spaces', 'privacy']);
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.line.length).toBeLessThanOrEqual(70);
      expect(t.lines.length).toBeGreaterThanOrEqual(1);
      expect(t.lines.length).toBeLessThanOrEqual(4);
      for (const l of t.lines) expect(l.length).toBeLessThanOrEqual(100);
    }
  });

  it('every Try it fits the box and looks nothing like a password', () => {
    for (const t of HELP_TOPICS) {
      for (const words of t.tryIt) {
        expect(draftText(words)).toBe(words);
        expect(findCredential(words)).toBeNull();
      }
    }
  });

  it('link only to screens that exist', () => {
    for (const t of HELP_TOPICS) {
      if (!t.more) continue;
      const base = resolve(__dirname, '../app', t.more.path.slice(1));
      expect(existsSync(`${base}.tsx`) || existsSync(resolve(base, 'index.tsx'))).toBe(true);
    }
  });

  it('alarms and the calendar card show only in the Android app', () => {
    expect(helpTopics('android').map((t) => t.id)).toContain('alarms');
    expect(helpTopics('web').map((t) => t.id)).not.toContain('alarms');
    expect(helpTopics('ios').map((t) => t.id)).not.toContain('alarms');
    expect(helpTopic('alarms', 'web')).toBeNull();
    expect(helpTopic('vault', 'web')?.title).toBe('Passwords & the Vault');
    expect(helpTopic('nope', 'android')).toBeNull();
  });
});

describe('Try it', () => {
  it('takes only a short single line of words', () => {
    expect(draftText('Plan my day')).toBe('Plan my day');
    expect(draftText('two\nlines')).toBe('two lines');
    for (const bad of [undefined, 7, '', '   ', 'x'.repeat(MAX_DRAFT + 1), ['Plan my day']]) expect(draftText(bad)).toBeNull();
  });

  it('fills the chat box and never sends: the draft only sets the box text', () => {
    const chat = src('../app/chat.tsx');
    expect(chat).toMatch(/useLocalSearchParams<\{ draft\?: string; at\?: string \}>/);
    const block = chat.slice(chat.indexOf('const { draft, at }'), chat.indexOf('const { draft, at }') + 500);
    expect(block).toMatch(/setText\(draftText\(draft\)!\)/);
    expect(block).not.toMatch(/send\(|askWilma\(/);
    expect(src('../app/help.tsx')).toMatch(/router\.dismissTo\(\{ pathname: '\/chat', params: \{ draft: words/);
  });
});

describe('the "?"', () => {
  it('is in the top bar of Home and Ask Wilma, and Settings has a Help row (Q1)', () => {
    expect(src('../app/index.tsx')).toMatch(/title="\?" accessibilityLabel="Help" onPress=\{\(\) => router\.push\('\/help'\)\}/);
    expect(src('../app/chat.tsx')).toMatch(/accessibilityLabel="Help" onPress=\{\(\) => router\.push\('\/help'\)\}/);
    expect(src('../app/settings.tsx')).toMatch(/title="\? Help"[^\n]*router\.push\('\/help'\)/);
    expect(src('../app/_layout.tsx')).toMatch(/name="help" options=\{\{ title: 'Help', presentation: 'modal' \}\}/);
  });

  it('is mentioned once on the welcome card (Q6)', () => {
    expect(src('../components/WelcomeCard.tsx')).toContain('Tap ? any time for help.');
  });
});
