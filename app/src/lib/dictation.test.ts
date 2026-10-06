// The mic's behaviour with a fake speech module (A5e plan, tests 3, 4 and 6): words only ever go
// into the box, never sent; errors give a short line and leave the box alone.
import { describe, expect, it, jest } from '@jest/globals';
import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';

import { routeMessage } from './chatRoute';
import { appendDictation, createDictation, type DictationState, type SpeechApi, VoiceError } from './voice';

type Listener = (e?: unknown) => void;

function fakeSpeech(opts: { granted?: boolean; alreadyAllowed?: boolean; available?: boolean; onDevice?: boolean; installed?: string[] } = {}) {
  const listeners: Record<string, Listener[]> = {};
  const api = {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    // Not yet allowed until the person answers the question (requestPermissionsAsync).
    getPermissionsAsync: jest.fn(async () => ({ granted: (opts.granted ?? true) && !!opts.alreadyAllowed })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: opts.granted ?? true })),
    isRecognitionAvailable: jest.fn(() => opts.available ?? true),
    supportsOnDeviceRecognition: jest.fn(() => opts.onDevice ?? false),
    getSupportedLocales: jest.fn(async () => ({ locales: [], installedLocales: opts.installed ?? [] })),
    addListener: jest.fn((event: string, l: Listener) => {
      (listeners[event] ??= []).push(l);
      return { remove: () => (listeners[event] = listeners[event].filter((x) => x !== l)) };
    }),
  };
  const emit = (event: string, e?: unknown) => [...(listeners[event] ?? [])].forEach((l) => l(e));
  const result = (transcript: string, isFinal: boolean) => emit('result', { isFinal, results: [{ transcript, confidence: 1, segments: [] }] });
  const error = (code: ExpoSpeechRecognitionErrorCode) => emit('error', { error: code, message: 'native text' });
  const count = () => Object.values(listeners).reduce((n, l) => n + l.length, 0);
  return { api: api as unknown as SpeechApi & typeof api, emit, result, error, count };
}

/** A box like the screens': its text, the mic, and a `send` the mic must never call. */
function box(speech: ReturnType<typeof fakeSpeech>, typed = '') {
  const b = { text: typed, states: [] as DictationState[], send: jest.fn() };
  const mic = createDictation(async () => speech.api, (s) => b.states.push(s));
  const onWords = (words: string) => {
    b.text = appendDictation(b.text, words);
  };
  return { b, mic, start: () => mic.start(onWords) };
}

describe('dictation never sends (Q1)', () => {
  it('partial words only show; the final words are appended to what was typed', async () => {
    const speech = fakeSpeech();
    const { b, mic, start } = box(speech, 'remind me');
    await start();
    expect(mic.state.listening).toBe(true);
    expect(speech.api.start).toHaveBeenCalledTimes(1);

    speech.result('to buy', false);
    expect(mic.state.partial).toBe('to buy');
    expect(b.text).toBe('remind me');

    speech.result('to buy milk', true);
    expect(b.text).toBe('remind me to buy milk');
    speech.emit('end');
    expect(mic.state).toMatchObject({ listening: false, partial: '', error: null, permission: 'granted' });
    expect(b.text).toBe('remind me to buy milk');
    expect(b.send).not.toHaveBeenCalled();
    expect(speech.count()).toBe(0);
  });

  it('words already showing are kept when listening ends without a final result', async () => {
    const speech = fakeSpeech();
    const { b, start } = box(speech);
    await start();
    speech.result('open recipes', false);
    speech.emit('end');
    expect(b.text).toBe('open recipes');
  });

  it('cancel (app in the background, screen left) stops at once and keeps words shown', async () => {
    const speech = fakeSpeech();
    const { b, mic, start } = box(speech, 'note:');
    await start();
    speech.result('call the plumber', false);
    mic.cancel();
    expect(speech.api.abort).toHaveBeenCalledTimes(1);
    expect(mic.state.listening).toBe(false);
    expect(b.text).toBe('note: call the plumber');
    // A late event from the stopped run changes nothing.
    speech.result('more words', true);
    speech.error('aborted');
    expect(b.text).toBe('note: call the plumber');
    expect(mic.state.error).toBeNull();
  });

  it('already allowed: no permission question (it would pause the app and stop the mic)', async () => {
    const speech = fakeSpeech({ alreadyAllowed: true });
    const { mic, start } = box(speech);
    await start();
    expect(speech.api.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(speech.api.start).toHaveBeenCalledTimes(1);
    expect(mic.state.listening).toBe(true);
  });

  it("the permission screen pausing the app does not cancel the tap that opened it", async () => {
    const speech = fakeSpeech();
    let answer: (v: { granted: boolean }) => void = () => {};
    speech.api.requestPermissionsAsync.mockImplementation(() => new Promise((r) => (answer = r)));
    const { mic, start } = box(speech);
    const started = start();
    await Promise.resolve();
    await Promise.resolve();
    mic.pause(); // Android: the app is "in the background" while the question shows
    answer({ granted: true });
    await started;
    expect(speech.api.start).toHaveBeenCalledTimes(1);
    expect(mic.state.listening).toBe(true);
  });

  it('the app going to the background while listening stops the mic', async () => {
    const speech = fakeSpeech({ alreadyAllowed: true });
    const { b, mic, start } = box(speech);
    await start();
    speech.result('half a', false);
    mic.pause();
    expect(speech.api.abort).toHaveBeenCalledTimes(1);
    expect(mic.state.listening).toBe(false);
    expect(b.text).toBe('half a');
  });

  it('stop asks the phone to finish the phrase; its words still arrive', async () => {
    const speech = fakeSpeech();
    const { b, mic, start } = box(speech);
    await start();
    mic.stop();
    expect(speech.api.stop).toHaveBeenCalledTimes(1);
    speech.result('hello', true);
    speech.emit('end');
    expect(b.text).toBe('hello');
  });

  it('cancel while the permission question is open never starts listening', async () => {
    const speech = fakeSpeech();
    const { mic, start } = box(speech);
    const started = start();
    mic.cancel();
    await started;
    expect(speech.api.start).not.toHaveBeenCalled();
    expect(mic.state.listening).toBe(false);
  });

  it("listens in the phone's language, on the phone only with the language downloaded", async () => {
    const lang = Intl.DateTimeFormat().resolvedOptions().locale;
    const speech = fakeSpeech({ onDevice: true, installed: [lang] });
    await box(speech).start();
    expect(speech.api.start).toHaveBeenCalledWith(expect.objectContaining({ lang, requiresOnDeviceRecognition: true, interimResults: true }));

    const online = fakeSpeech({ onDevice: true, installed: [] });
    await box(online).start();
    expect(online.api.start).toHaveBeenCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: false }));
  });
});

describe('dictated text takes the typed path (test 4)', () => {
  it('"the wifi is hunter2" said aloud goes to Wilma (and her credential check), never a lookup', async () => {
    const speech = fakeSpeech();
    const { b, start } = box(speech, 'the wifi is');
    await start();
    speech.result('hunter2', true);
    const reads = { spaces: jest.fn(async () => []), findSecrets: jest.fn(async () => []) };
    expect(await routeMessage(b.text, reads)).toEqual({ to: 'wilma' });
    expect(reads.spaces).not.toHaveBeenCalled();
    expect(reads.findSecrets).not.toHaveBeenCalled();
  });
});

describe('errors: a short line under the box, the text left alone (test 6)', () => {
  it('permission denied', async () => {
    const speech = fakeSpeech({ granted: false });
    const { b, mic, start } = box(speech, 'typed');
    await start();
    expect(speech.api.start).not.toHaveBeenCalled();
    expect(mic.state).toMatchObject({ listening: false, permission: 'denied' });
    expect(mic.state.error).toMatch(/Settings/);
    expect(b.text).toBe('typed');
  });

  it('no speech service on the phone', async () => {
    const speech = fakeSpeech({ available: false });
    const { b, mic, start } = box(speech, 'typed');
    await start();
    expect(speech.api.start).not.toHaveBeenCalled();
    expect(mic.state.error).toMatch(/no speech service/);
    expect(b.text).toBe('typed');
  });

  const cases: [ExpoSpeechRecognitionErrorCode, RegExp][] = [
    ['no-speech', /Didn't catch that/],
    ['network', /connection/],
    ['not-allowed', /Settings/],
    ['service-not-allowed', /no speech service/],
  ];
  it.each(cases)('%s while listening', async (code, line) => {
    const speech = fakeSpeech();
    const { b, mic, start } = box(speech, 'typed');
    await start();
    speech.error(code);
    speech.emit('end');
    expect(mic.state.listening).toBe(false);
    expect(mic.state.error).toMatch(line);
    expect(mic.state.error).not.toContain('native text');
    expect(b.text).toBe('typed');
    expect(speech.count()).toBe(0);
  });

  it('the package cannot load on this phone', async () => {
    const mic = createDictation(async () => {
      throw new VoiceError('Dictation could not start on this phone. Typing still works.');
    }, () => {});
    await mic.start(() => {});
    expect(mic.state).toMatchObject({ listening: false, error: 'Dictation could not start on this phone. Typing still works.' });
  });

  it('a new tap clears the old line', async () => {
    const speech = fakeSpeech();
    const { mic, start } = box(speech);
    await start();
    speech.error('no-speech');
    expect(mic.state.error).not.toBeNull();
    await start();
    expect(mic.state.error).toBeNull();
  });
});
