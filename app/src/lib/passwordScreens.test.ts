// The password check on the phone (docs/ui-review.md, plan step 4): on home and in the chat,
// text that looks like a password turns the box amber, shows the card and holds Send; the chat
// itself refuses to send it whichever screen asks; "Save in Vault" never carries the text.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(SRC, f), 'utf8');
const SCREENS = ['app/index.tsx', 'app/chat.tsx'];

describe('home and chat hold a password', () => {
  it.each(SCREENS)('%s checks the text in the box', (f) => {
    const src = read(f);
    expect(src).toContain("import { findCredential } from '@/lib/credentials';");
    expect(src).toContain('const credential = useMemo(() => findCredential(text), [text]);');
  });

  it.each(SCREENS)('%s: submit returns before sending', (f) => {
    expect(read(f)).toMatch(/const submit = async \(\) => \{\n\s+if \([^\n]*\|\| credential\) return;/);
  });

  it.each(SCREENS)('%s shows the card and holds Send', (f) => {
    const src = read(f);
    expect(src).toMatch(/\{credential \? <PasswordHold kind=\{credential\} onEdit=\{\(\) => \w+\.current\?\.focus\(\)\} \/> : null\}/);
    expect(src).toMatch(/(disabled|sendDisabled)=\{[^}]*\|\| !!credential\}/);
  });

  it.each(SCREENS)('%s: the box edge turns amber', (f) => {
    expect(read(f)).toContain('warn={!!credential}');
  });
});

describe('the chat refuses to send a password (the backstop)', () => {
  it('send and askWilma return before anything is routed or sent', () => {
    const src = read('lib/chat.tsx');
    const at = (s: string, from = 0) => {
      const i = src.indexOf(s, from);
      expect(i).toBeGreaterThan(0);
      return i;
    };
    const send = src.slice(at('async send(text, here) {'), at('async askWilma(text) {'));
    const ask = src.slice(at('async askWilma(text) {'), at('stop() {', at('async askWilma(text) {')));
    for (const body of [send, ask]) {
      const guard = body.indexOf('if (findCredential(text)) return none;');
      expect(guard).toBeGreaterThan(0);
      for (const step of ['routeMessage(', 'act(', 'start(']) {
        if (body.includes(step)) expect(guard).toBeLessThan(body.indexOf(step));
      }
    }
  });
});

describe('the card', () => {
  const src = read('components/PasswordHold.tsx');

  it('gets the kind only, never the text', () => {
    expect(src).toMatch(/export function PasswordHold\(\{ kind, onEdit \}: \{ kind: CredentialKind; onEdit: \(\) => void \}\)/);
  });

  it('opens an empty "Save a secret" form', () => {
    expect(src).toContain("router.push('/vault/enter')");
    expect(src).not.toMatch(/vault\/enter['"],\s*params|params:/);
  });

  it('says what happened', () => {
    expect(src).toContain("Wilma won't send it.");
    expect(src).toContain('Edit message');
    expect(src).toContain('Save in Vault');
  });
});
