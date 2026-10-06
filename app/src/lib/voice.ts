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
import type { ExpoSpeechRecognitionErrorCode, ExpoSpeechRecognitionOptions } from 'expo-speech-recognition';

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
