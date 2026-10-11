// The phone's own Clock app (alarms, docs/alarms-calendar-plan.md step 2): its set-alarm screen
// filled in, or its list of alarms. Android only; the package is loaded on first use (as
// location.ts does), so the rest of the app never touches it. Wilma never sets, reads or deletes
// an alarm itself: the Clock shows its own screen and the user saves there.
import { Platform } from 'react-native';

import { alarmIntent, type AlarmCardData, SHOW_ALARMS } from './phoneActions';

/** The Clock opens here only on Android. */
export const clockAvailable = Platform.OS === 'android';

type Launcher = { startActivityAsync: (action: string, params?: { extra?: Record<string, unknown> }) => Promise<unknown> };

function launcher(): Launcher {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-intent-launcher') as Launcher;
}

/**
 * Opens the Clock with `start`. Resolves once it is open (or fails to open), not when the user comes
 * back: the launcher's own promise waits for that, so it is left to run on its own.
 */
function open(action: string, extra?: Record<string, unknown>): Promise<boolean> {
  if (!clockAvailable) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      launcher().startActivityAsync(action, extra ? { extra } : undefined).then(() => done(true), () => done(false));
      // No error within a moment: the Clock is open (its result only comes when the user returns).
      setTimeout(() => done(true), 800);
    } catch {
      done(false);
    }
  });
}

/** The Clock's set-alarm screen with the time (and label) filled in. False: no Clock app took it. */
export function openSetAlarm(a: AlarmCardData): Promise<boolean> {
  const { action, extra } = alarmIntent(a);
  return open(action, extra);
}

/** The Clock's list of alarms. */
export function openAlarms(): Promise<boolean> {
  return open(SHOW_ALARMS);
}
