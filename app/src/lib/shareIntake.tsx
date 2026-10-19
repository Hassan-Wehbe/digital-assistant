// Share -> Wilma: listens for what other apps share and keeps it until it is saved or
// cancelled. Built on expo-share-intent's native module rather than its hook, because the
// hook drops Android's content:// links (see shared.ts) and forgets the share whenever
// the app goes to the background (a password manager during sign-in is enough).
//
// Cold start (owner, 2026-10-19: sharing from Facebook, YouTube or Chrome with Wilma closed opened
// nothing; with Wilma open it worked): the share module keeps the share that started the app until
// it has handed it over once, and the first ask can come before the module is ready (it then fails
// quietly and keeps the share). So the app asks again a little later, and once more when it is
// signed in and can show the share screen (`askAgain`). Asking when nothing is waiting does nothing;
// once handed over, the module forgets it, so a share never arrives twice.
import { useLinkingURL } from 'expo-linking';
import { getScheme, getShareExtensionKey, ShareIntentModule } from 'expo-share-intent';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { nothingUsable, parseShared, type Shared } from './shared';

interface ShareState {
  /** The share waiting to be saved; `id` changes with every new share. */
  pending: { id: number; shared: Shared } | null;
  /** The share module could not read what was shared. */
  error: string | null;
  /** Changes with every share that came in, readable or not (to open the share screen). */
  seq: number;
  /** Forget the waiting share (after saving or cancelling). */
  clear(): void;
  /** Ask the share module again for a share that started the app (signed in, the screens ready). */
  askAgain(): void;
}

const ShareContext = createContext<ShareState>({ pending: null, error: null, seq: 0, clear: () => {}, askAgain: () => {} });

/** After start-up, the share module is asked again after these delays (ms), in case it was not ready. */
export const ASK_AGAIN_MS = [600, 2000];

export function ShareProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ShareState['pending']>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const counter = useRef(0);
  const url = useLinkingURL();

  // Ask the module for a share that opened the app. Android: kept from the app's start
  // (a share while the app is open arrives by itself). iOS: the share extension opens
  // "wilma://dataUrl=..." (iOS sharing is switched off in app.json until phase B).
  const refresh = useCallback(() => {
    if (!ShareIntentModule) return;
    // A failed ask (the module not ready yet) is asked again; it must never crash the app.
    if (Platform.OS === 'android') void Promise.resolve(ShareIntentModule.getShareIntent('')).catch(() => {});
    else if (url?.startsWith(`${getScheme()}://dataUrl=`)) ShareIntentModule.getShareIntent(url);
  }, [url]);

  useEffect(() => {
    if (!ShareIntentModule) return; // web, or a build without the module
    const changed = ShareIntentModule.addListener('onChange', (event: { value: unknown }) => {
      const shared = parseShared(event.value);
      counter.current += 1;
      setSeq(counter.current);
      if (nothingUsable(shared)) {
        setPending(null);
        setError('Nothing Wilma can save came with that share.');
        return;
      }
      setError(null);
      setPending({ id: counter.current, shared });
    });
    const failed = ShareIntentModule.addListener('onError', (event: { value?: string }) => {
      counter.current += 1;
      setSeq(counter.current);
      setError(`The shared item could not be read${event?.value ? ` (${event.value})` : ''}.`);
    });
    return () => {
      changed.remove();
      failed.remove();
    };
  }, []);

  // Listeners first (above), then ask; and again whenever the app comes back to the front.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (next) => next === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  // Cold start: ask again a little later (see the top of this file).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const timers = ASK_AGAIN_MS.map((ms) => setTimeout(refresh, ms));
    return () => timers.forEach(clearTimeout);
    // Once per start of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = useCallback(() => {
    ShareIntentModule?.clearShareIntent(getShareExtensionKey());
    setPending(null);
    setError(null);
  }, []);

  const value = useMemo(() => ({ pending, error, seq, clear, askAgain: refresh }), [pending, error, seq, clear, refresh]);
  return <ShareContext.Provider value={value}>{children}</ShareContext.Provider>;
}

export function useShare(): ShareState {
  return useContext(ShareContext);
}
