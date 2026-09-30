// Copying a revealed value: the clipboard is cleared 30 seconds later (as on the web
// reveal page). Android may pause the app in the background, so a clear that was due
// while away happens as soon as the app is back.
import * as Clipboard from 'expo-clipboard';
import { AppState } from 'react-native';

import { SHOW_MS } from './vaultFlow';

let dueAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function clearNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  dueAt = null;
  Clipboard.setStringAsync('').catch(() => {});
}

AppState.addEventListener('change', (next) => {
  if (next === 'active' && dueAt !== null && Date.now() >= dueAt) clearNow();
});

/** Copy a secret value; it leaves the clipboard after 30 seconds. */
export async function copySecret(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
  if (timer) clearTimeout(timer);
  dueAt = Date.now() + SHOW_MS;
  timer = setTimeout(clearNow, SHOW_MS);
}
