// Dictation (A5e, docs/phase5-a5e-voice-plan.md): the phone turns speech into text, and the
// text goes into the message box. Nothing is ever sent by voice alone: the person reads the
// words and taps Send, so dictated text takes exactly the path typed text takes (the router,
// then Wilma, and the server's credential check, CLAUDE.md rule 9).
//
// This is the only file that loads expo-speech-recognition, and it loads it the first time
// the mic is used, never when the app starts (the A3a lesson in docs/handoff.md). The Android
// module does nothing at start-up either (no OnCreate, no foreground hook), but keeping its
// JavaScript out of start-up means a problem in it can only affect dictation.
//
// The mic is never offered in the vault, on sign-in or on the account screen
// (appConfig.test.ts checks those screens cannot reach this file).
import { useFocusEffect } from 'expo-router';
import type { ExpoSpeechRecognitionErrorCode, ExpoSpeechRecognitionOptions, ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

type SpeechPackage = typeof import('expo-speech-recognition');
export type SpeechModule = SpeechPackage['ExpoSpeechRecognitionModule'];

export class VoiceError extends Error {}

let loaded: SpeechModule | null = null;

/** The speech module, loaded on first use. Throws VoiceError when this phone cannot load it. */
export async function loadSpeech(): Promise<SpeechModule> {
  if (loaded) return loaded;
  try {
    // A require inside the function, not an import at the top: the package's JavaScript runs
    // only now (Metro also turns import() into this; Jest cannot run import()).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const speech: SpeechPackage = require('expo-speech-recognition');
    loaded = speech.ExpoSpeechRecognitionModule;
    return loaded;
  } catch {
    throw new VoiceError('Dictation could not start on this phone. Typing still works.');
  }
}

/** Dictated words go after what is already in the box, so you can type half and say half. */
export function appendDictation(box: string, words: string): string {
  const said = words.trim();
  if (!said) return box;
  if (!box.trim()) return said;
  return /\s$/.test(box) ? box + said : `${box} ${said}`;
}

/**
 * The phone's language as a BCP-47 tag ("en-US", "fr-FR", "ar-LB"), or '' when unknown.
 * Passed to the module on purpose: on Android it otherwise listens in "en-US" (its default
 * option), not in the phone's language (decision Q5).
 */
export function phoneLanguage(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  } catch {
    return '';
  }
}

/**
 * On-device recognition only when the phone has the language downloaded (decision Q3);
 * otherwise the phone's own speech service (usually Google's). Asking for on-device without
 * the language pack fails on Android instead of falling back.
 */
export function chooseOnDevice(supportsOnDevice: boolean, installedLocales: readonly string[], lang: string): boolean {
  if (!supportsOnDevice || !lang) return false;
  const want = lang.toLowerCase().replace('_', '-');
  return installedLocales.some((l) => l.toLowerCase().replace('_', '-') === want);
}

/** What the mic asks the phone for: words while speaking (Q6), stop after a pause, no audio kept. */
export function speechOptions(lang: string, onDevice: boolean): ExpoSpeechRecognitionOptions {
  return {
    lang,
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    requiresOnDeviceRecognition: onDevice,
    addsPunctuation: onDevice,
    // Never keep the audio: only the text is used.
    recordingOptions: { persist: false },
  };
}

/** A short line for under the box, or null when there is nothing to say (the person stopped). */
export function dictationErrorMessage(code: ExpoSpeechRecognitionErrorCode): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
      return 'Wilma may not use the microphone. Allow it in Settings > Apps > Wilma > Permissions. Typing still works.';
    case 'service-not-allowed':
      return 'This phone has no speech service Wilma can use. Typing still works.';
    case 'no-speech':
    case 'speech-timeout':
      return "Didn't catch that. Tap the mic and try again.";
    case 'network':
      return 'Dictation needs a connection on this phone. Try again when online, or type.';
    case 'language-not-supported':
      return "The phone's speech service does not support this language. Typing still works.";
    case 'audio-capture':
    case 'interrupted':
      return 'The microphone stopped. Tap the mic to try again.';
    case 'busy':
      return 'The speech service is busy. Try again in a moment.';
    default:
      return 'Dictation stopped. Tap the mic to try again, or type.';
  }
}

/** The parts of the speech module dictation uses (a fake one in the tests). */
export type SpeechApi = Pick<
  SpeechModule,
  'start' | 'stop' | 'abort' | 'getPermissionsAsync' | 'requestPermissionsAsync' | 'isRecognitionAvailable' | 'supportsOnDeviceRecognition' | 'getSupportedLocales'
> & {
  addListener(event: 'result', listener: (e: ExpoSpeechRecognitionResultEvent) => void): { remove(): void };
  addListener(event: 'error', listener: (e: { error: ExpoSpeechRecognitionErrorCode; message: string }) => void): { remove(): void };
  addListener(event: 'end', listener: () => void): { remove(): void };
};

export interface DictationState {
  /** The phone is listening: the mic shows "Stop dictating". */
  listening: boolean;
  /** Words heard so far, shown after the box's text while listening; not yet in the box (Q6). */
  partial: string;
  /** A short line for under the box, or null. */
  error: string | null;
  /** Whether Wilma may use the microphone, as far as the last tap found out. */
  permission: 'unknown' | 'granted' | 'denied';
}

export const idleDictation: DictationState = { listening: false, partial: '', error: null, permission: 'unknown' };

const NOT_ALLOWED = dictationErrorMessage('not-allowed');
const NO_SERVICE = dictationErrorMessage('service-not-allowed');

/**
 * One mic, without React (the hook below wraps it). `start(onWords)`: onWords gets the words
 * the phone heard, once per phrase, and is the only thing a result ever does: the screen
 * appends them to its box. Nothing here can send a message (Q1).
 */
export function createDictation(load: () => Promise<SpeechApi>, onChange: (state: DictationState) => void) {
  let state: DictationState = idleDictation;
  // Each start gets a number; anything from an older start (a slow permission answer, a late
  // event) is ignored once it has been stopped.
  let run = 0;
  let speech: SpeechApi | null = null;
  let subs: { remove(): void }[] = [];
  // Words shown but not yet given to the box (no final result yet).
  let pending = '';
  // True once the phone's recognizer has been started (not while asking for permission).
  let recognizing = false;
  let onWords: (words: string) => void = () => {};

  const set = (next: Partial<DictationState>) => {
    state = { ...state, ...next };
    onChange(state);
  };
  const detach = () => {
    for (const s of subs) s.remove();
    subs = [];
  };
  const commit = () => {
    const words = pending;
    pending = '';
    if (words.trim()) onWords(words);
  };
  // Listening is over: the words still showing go into the box, so nothing seen vanishes.
  const finish = (error: string | null) => {
    recognizing = false;
    detach();
    commit();
    set({ listening: false, partial: '', error });
  };

  return {
    get state() {
      return state;
    },

    async start(deliver: (words: string) => void): Promise<void> {
      if (state.listening) return;
      const mine = ++run;
      onWords = deliver;
      pending = '';
      set({ listening: true, partial: '', error: null });
      try {
        speech = speech ?? (await load());
        if (mine !== run) return;
        // Ask only when not yet allowed: Expo opens Android's permission screen even for a
        // permission already granted, and that screen pauses the app for a moment.
        let allowed = await speech.getPermissionsAsync();
        if (mine !== run) return;
        if (!allowed.granted) allowed = await speech.requestPermissionsAsync();
        if (mine !== run) return;
        if (!allowed.granted) {
          set({ listening: false, permission: 'denied', error: NOT_ALLOWED });
          return;
        }
        set({ permission: 'granted' });
        if (!speech.isRecognitionAvailable()) {
          set({ listening: false, error: NO_SERVICE });
          return;
        }
        const lang = phoneLanguage();
        let onDevice = false;
        try {
          if (speech.supportsOnDeviceRecognition() && lang) {
            onDevice = chooseOnDevice(true, (await speech.getSupportedLocales({})).installedLocales, lang);
          }
        } catch {
          // The list is not available on this phone (Android 12 and older): use its service.
        }
        if (mine !== run) return;
        const s = speech;
        subs = [
          s.addListener('result', (e) => {
            if (mine !== run) return;
            const words = e.results[0]?.transcript ?? '';
            if (e.isFinal) {
              pending = words;
              commit();
              set({ partial: '' });
            } else {
              pending = words;
              set({ partial: words.trim() });
            }
          }),
          s.addListener('error', (e) => {
            if (mine !== run) return;
            if (e.error === 'not-allowed') set({ permission: 'denied' });
            finish(dictationErrorMessage(e.error));
          }),
          s.addListener('end', () => {
            if (mine !== run || !state.listening) return;
            finish(state.error);
          }),
        ];
        recognizing = true;
        s.start(speechOptions(lang, onDevice));
      } catch (e) {
        if (mine !== run) return;
        detach();
        set({
          listening: false,
          partial: '',
          error: e instanceof VoiceError ? e.message : dictationErrorMessage('unknown'),
        });
      }
    },

    /** The mic tapped again: the phone finishes the phrase, and its words go into the box. */
    stop(): void {
      if (!state.listening) return;
      try {
        speech?.stop();
      } catch {
        this.cancel();
      }
    },

    /**
     * The app went to the background, the screen was left, or the box can no longer send:
     * stop at once. Words already showing still go into the box.
     */
    cancel(): void {
      if (!state.listening) return;
      run++;
      try {
        speech?.abort();
      } catch {
        // Already stopped.
      }
      finish(null);
    },

    /**
     * The app went to the background: stop, but only once the phone is really listening.
     * Android's permission screen also sends the app to the background for a moment; that must
     * not cancel the tap that opened it.
     */
    pause(): void {
      if (recognizing) this.cancel();
    },

    /** The person typed: an old error line goes away. */
    clearError(): void {
      if (state.error) set({ error: null });
    },
  };
}

export type Dictation = ReturnType<typeof createDictation>;

/**
 * The mic for one message box. `onWords` is given the dictated words (the screen appends them
 * to its text); `enabled` false (the box cannot send, or a reply streams) stops listening.
 * Listening also stops when the app goes to the background or the screen is left.
 */
export function useDictation(onWords: (words: string) => void, enabled: boolean) {
  const [state, setState] = useState<DictationState>(idleDictation);
  const [d] = useState(() => createDictation(loadSpeech as () => Promise<SpeechApi>, setState));

  useEffect(() => {
    if (!enabled) d.cancel();
  }, [enabled, d]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') d.pause();
    });
    return () => {
      sub.remove();
      d.cancel();
    };
  }, [d]);

  // Another screen opened on top (the chat from home, a space): stop listening.
  useFocusEffect(useCallback(() => () => d.cancel(), [d]));

  return {
    ...state,
    start: () => {
      if (enabled) void d.start(onWords);
    },
    stop: () => d.stop(),
    clearError: () => d.clearError(),
  };
}

export type DictationControls = ReturnType<typeof useDictation>;
