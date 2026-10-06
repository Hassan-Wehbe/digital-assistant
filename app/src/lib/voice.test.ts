/* eslint-disable @typescript-eslint/no-require-imports -- the tests require voice.ts after jest.mock / resetModules to see when it loads the package. */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Records when the speech package is actually evaluated: a jest.mock factory runs only when
// something requires the module, so this shows whether voice.ts mockLoads it at import time.
const mockLoads = { count: 0 };
jest.mock('expo-speech-recognition', () => {
  mockLoads.count += 1;
  return { ExpoSpeechRecognitionModule: { start: jest.fn(), stop: jest.fn(), abort: jest.fn() } };
});

describe('voice.ts loading (start-up safety, A3a lesson)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLoads.count = 0;
  });

  it('importing voice.ts does not load the speech package', () => {
    jest.isolateModules(() => {
      require('./voice');
    });
    expect(mockLoads.count).toBe(0);
  });

  it('loads it on first use, once', async () => {
    const voice: typeof import('./voice') = require('./voice');
    const a = await voice.loadSpeech();
    const b = await voice.loadSpeech();
    expect(a).toBe(b);
    expect(typeof a.start).toBe('function');
    expect(mockLoads.count).toBe(1);
  });

  it('the mic is on (step 3)', () => {
    const { VOICE_ENABLED } = require('./config');
    expect(VOICE_ENABLED).toBe(true);
  });
});

describe('when the package cannot load', () => {
  it('says so plainly, without crashing', async () => {
    jest.resetModules();
    jest.doMock('expo-speech-recognition', () => {
      throw new Error('Cannot find native module ExpoSpeechRecognition');
    });
    const voice: typeof import('./voice') = require('./voice');
    await expect(voice.loadSpeech()).rejects.toThrow('Dictation could not start on this phone. Typing still works.');
    jest.dontMock('expo-speech-recognition');
  });
});

describe('appendDictation (dictated words go into the box, never sent)', () => {
  const { appendDictation } = jest.requireActual<typeof import('./voice')>('./voice');

  it('fills an empty box', () => {
    expect(appendDictation('', 'open recipes')).toBe('open recipes');
    expect(appendDictation('   ', ' open recipes ')).toBe('open recipes');
  });

  it('keeps what was typed and adds a space', () => {
    expect(appendDictation('remind me', 'to buy milk')).toBe('remind me to buy milk');
    expect(appendDictation('remind me ', 'to buy milk')).toBe('remind me to buy milk');
  });

  it('changes nothing when nothing was heard', () => {
    expect(appendDictation('typed', '')).toBe('typed');
    expect(appendDictation('typed', '  ')).toBe('typed');
  });
});

describe('speech options', () => {
  const { chooseOnDevice, phoneLanguage, speechOptions } = jest.requireActual<typeof import('./voice')>('./voice');

  it('uses on-device recognition only with the language downloaded (Q3)', () => {
    expect(chooseOnDevice(true, ['en-US', 'fr-FR'], 'en-US')).toBe(true);
    expect(chooseOnDevice(true, ['en_us'], 'en-US')).toBe(true);
    expect(chooseOnDevice(true, ['fr-FR'], 'en-US')).toBe(false);
    expect(chooseOnDevice(false, ['en-US'], 'en-US')).toBe(false);
    expect(chooseOnDevice(true, ['en-US'], '')).toBe(false);
  });

  it("listens in the phone's language, shows words while speaking, keeps no audio", () => {
    const o = speechOptions('fr-FR', false);
    expect(o).toMatchObject({ lang: 'fr-FR', interimResults: true, continuous: false, requiresOnDeviceRecognition: false });
    expect(o.recordingOptions?.persist).toBe(false);
    expect(speechOptions('en-US', true).requiresOnDeviceRecognition).toBe(true);
  });

  it('reads the phone language as a tag', () => {
    expect(phoneLanguage()).toMatch(/^([a-z]{2,3}(-[A-Za-z0-9]+)*)?$/);
  });
});

describe('dictationErrorMessage', () => {
  const { dictationErrorMessage } = jest.requireActual<typeof import('./voice')>('./voice');

  it('says nothing when the person stopped', () => {
    expect(dictationErrorMessage('aborted')).toBeNull();
  });

  it('gives a short line for the usual failures', () => {
    expect(dictationErrorMessage('not-allowed')).toMatch(/Settings/);
    expect(dictationErrorMessage('service-not-allowed')).toMatch(/no speech service/);
    expect(dictationErrorMessage('no-speech')).toMatch(/Didn't catch that/);
    expect(dictationErrorMessage('network')).toMatch(/connection/);
    expect(dictationErrorMessage('unknown')).toMatch(/try again/);
  });
});
