/* eslint-disable @typescript-eslint/no-require-imports -- the test requires the screens after jest.mock to see whether the speech package loads. */
// The mic in the two boxes (A5e plan, tests 3 and 5): loading the screens does not load the
// speech package; the mic is drawn only with VOICE_ENABLED; its words only go into the box.
import { describe, expect, it, jest } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const mockLoads = { count: 0 };
jest.mock('expo-speech-recognition', () => {
  mockLoads.count += 1;
  return { ExpoSpeechRecognitionModule: {} };
});
// The screens' other modules talk to Supabase and the phone's storage as they load; neither
// matters here.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./deviceStorage', () => ({ deviceSessionStorage: {}, deviceChatStore: {} }));

const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(SRC, f), 'utf8');
const SCREENS = ['app/index.tsx', 'app/chat.tsx'];

describe('start-up safety (test 5)', () => {
  it('loading the home and chat screens does not load the speech package', () => {
    for (const f of SCREENS) {
      jest.isolateModules(() => {
        const screen = require(resolve(SRC, f));
        expect(typeof screen.default).toBe('function');
      });
    }
    expect(mockLoads.count).toBe(0);
  });

  it.each(SCREENS)('%s draws the mic only when VOICE_ENABLED is on', (f) => {
    const src = read(f);
    const mics = src.match(/<MicButton\b[^>]*\/>/g) ?? [];
    expect(mics).toHaveLength(1);
    expect(src).toMatch(/\{VOICE_ENABLED \? <MicButton mic=\{mic\} disabled=\{!(chat\.)?canSend\} \/> : null\}/);
  });
});

describe('the mic never sends (test 3)', () => {
  it.each(SCREENS)('%s: dictated words are only appended to the box', (f) => {
    const src = read(f);
    expect(src).toContain('useDictation((words) => setText((t) => appendDictation(t, words)),');
    // Send waits while listening, so the words in the box are the ones that get sent.
    // (The chat's Send also waits while 📍 reads the location, places step 7.)
    // (On the Wilma box, Send's prop is sendDisabled. Send also waits while the text looks
    // like a password, plan step 4.)
    expect(src).toMatch(/(disabled|sendDisabled)=\{!(chat\.)?canSend \|\| !text\.trim\(\) \|\| mic\.listening( \|\| locating)? \|\| !!credential\}/);
  });

  it('the mic button and voice.ts have no way to send', () => {
    for (const f of ['components/MicButton.tsx', 'lib/voice.ts']) {
      const src = read(f);
      expect(src).not.toMatch(/useChat|\bsend\(|askWilma|lib\/chat['"]/);
    }
  });

  it('the boxes warn against saying passwords (Q8)', () => {
    expect(read('app/chat.tsx')).toContain('Never type or say passwords here. Use the Vault.');
    expect(read('app/index.tsx')).toMatch(/mic\.listening \? <Muted>Never type or say passwords here\. Use the Vault\.<\/Muted>/);
  });
});

describe('the mic is only in the two boxes (Q4)', () => {
  it('no other file uses MicButton or useDictation', () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /MicButton|useDictation/.test(readFileSync(p, 'utf8'))) {
          users.push(p.slice(SRC.length + 1));
        }
      }
    };
    walk(SRC);
    expect(users.sort()).toEqual(['app/chat.tsx', 'app/index.tsx', 'components/MicButton.tsx', 'lib/voice.ts']);
  });
});
