// The vault on the phone: unlock with the passphrase (then the fingerprint), keep the
// keys in memory while unlocked, lock again after 5 minutes or a minute away.
// Owner's choices (2026-09-30): passphrase once, then fingerprint; 5 minutes; values
// hidden until Show.
//
// Fingerprint: after a passphrase unlock, the private key (never the passphrase) is kept
// in the phone's keystore with requireAuthentication, so only a fingerprint check
// releases it. Android invalidates it when fingerprints change; then the passphrase is
// needed again. Signing out deletes it.
//
// Nothing here logs or reports a passphrase, key or value.
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import sodium from 'react-native-libsodium';

import { useAuth } from './auth';
import { supabase } from './supabase';
import { forgetKeys, vaultCrypto, VaultError, type Sodium, type VaultKeys, type VaultRecord } from './vaultCrypto';
import { revealSecret, shouldLock, UNLOCK_MS, type Revealed } from './vaultFlow';

export const crypto = vaultCrypto(sodium as unknown as Sodium);

const keyItem = (userId: string) => `wilma.vault.key.${userId}`;
const pubItem = (userId: string) => `wilma.vault.pub.${userId}`;
const PROTECTED: SecureStore.SecureStoreOptions = { requireAuthentication: true };

type Status = 'loading' | 'error' | 'not_set_up' | 'locked' | 'unlocked';

interface VaultState {
  status: Status;
  /** Why the vault state could not be read (status 'error'). */
  problem: string | null;
  /** When an unlocked vault locks by itself. */
  locksAt: number | null;
  /** A fingerprint-protected key is kept on this phone for this vault. */
  fingerprint: boolean;
  /** This phone can keep a fingerprint-protected key. */
  fingerprintPossible: boolean;
  refresh(): Promise<void>;
  unlockWithPassphrase(passphrase: string): Promise<{ fingerprintNote: string | null }>;
  unlockWithFingerprint(): Promise<void>;
  lock(): void;
  forgetFingerprint(): Promise<void>;
  reveal(secretId: string): Promise<Revealed>;
}

const VaultContext = createContext<VaultState | null>(null);

async function rpc(fn: string, args?: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/** Let the screen draw a "working…" state before a call that blocks for a second or two. */
const nextFrame = () => new Promise((r) => setTimeout(r, 50));

export function VaultProvider({ children }: { children: ReactNode }) {
  const { session, signedIn, wilma } = useAuth();
  const userId = session?.user.id ?? null;
  const [status, setStatus] = useState<Status>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [locksAt, setLocksAt] = useState<number | null>(null);
  const [fingerprint, setFingerprint] = useState(false);
  const fingerprintPossible = useMemo(() => {
    try {
      return SecureStore.canUseBiometricAuthentication();
    } catch {
      return false;
    }
  }, []);
  const record = useRef<VaultRecord | null>(null);
  const keys = useRef<VaultKeys | null>(null);
  const unlockedAt = useRef(0);
  const awaySince = useRef<number | null>(null);

  const lock = useCallback(() => {
    forgetKeys(keys.current);
    keys.current = null;
    setLocksAt(null);
    setStatus((s) => (s === 'unlocked' ? 'locked' : s));
  }, []);

  const forgetStored = useCallback(async (uid: string) => {
    await SecureStore.deleteItemAsync(keyItem(uid), PROTECTED).catch(() => {});
    await SecureStore.deleteItemAsync(pubItem(uid)).catch(() => {});
    setFingerprint(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setProblem(null);
    try {
      const r = await rpc('get_vault_keys');
      if (!r?.set_up) {
        record.current = null;
        lock();
        setStatus('not_set_up');
        return;
      }
      record.current = r as VaultRecord;
      // A kept key for another key pair (the vault was set up again) is useless.
      const pub = await SecureStore.getItemAsync(pubItem(userId)).catch(() => null);
      if (pub && pub !== r.public_key) await forgetStored(userId);
      setFingerprint(!!pub && pub === r.public_key);
      setStatus((s) => (s === 'unlocked' && keys.current ? 'unlocked' : 'locked'));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [userId, lock, forgetStored]);

  // Signed out, or another account: lock, and forget the previous account's kept key.
  // (Opened offline, the session can be missing for a moment while still signed in;
  // that keeps everything.)
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastUser.current;
    if (!signedIn || (userId && previous && userId !== previous)) {
      lock();
      if (previous) forgetStored(previous);
      lastUser.current = null;
    }
    if (!userId) return;
    lastUser.current = userId;
    record.current = null;
    setStatus('loading');
    refresh();
  }, [userId, signedIn, lock, forgetStored, refresh]);

  // Lock after 5 minutes, and after a minute away from the app.
  useEffect(() => {
    if (!locksAt) return;
    const t = setTimeout(lock, Math.max(0, locksAt - Date.now()));
    return () => clearTimeout(t);
  }, [locksAt, lock]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (keys.current && shouldLock(unlockedAt.current, Date.now(), awaySince.current)) lock();
        awaySince.current = null;
      } else if (awaySince.current === null) {
        awaySince.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [lock]);

  const opened = useCallback((k: VaultKeys) => {
    forgetKeys(keys.current);
    keys.current = k;
    unlockedAt.current = Date.now();
    setLocksAt(unlockedAt.current + UNLOCK_MS);
    setStatus('unlocked');
  }, []);

  const needRecord = () => {
    if (!record.current) throw new VaultError('not_ready', 'The vault is not ready yet; try again.');
    return record.current;
  };

  const unlockWithPassphrase = useCallback(
    async (passphrase: string) => {
      const r = needRecord();
      await nextFrame();
      const k = crypto.unlockWithPassphrase(r, passphrase);
      opened(k);
      // Keep a fingerprint-protected copy of the key for next time.
      if (!userId || !fingerprintPossible || fingerprint) return { fingerprintNote: null };
      try {
        await SecureStore.setItemAsync(keyItem(userId), crypto.toB64(k.privateKey), {
          ...PROTECTED,
          authenticationPrompt: 'Confirm with your fingerprint to unlock the vault this way next time',
        });
        await SecureStore.setItemAsync(pubItem(userId), r.public_key);
        setFingerprint(true);
        return { fingerprintNote: 'Next time you can unlock with your fingerprint.' };
      } catch {
        return { fingerprintNote: 'Fingerprint unlock was not set up; you can try again next time.' };
      }
    },
    [opened, userId, fingerprintPossible, fingerprint],
  );

  const unlockWithFingerprint = useCallback(async () => {
    const r = needRecord();
    if (!userId) throw new VaultError('signed_out', 'Sign in again.');
    let stored: string | null;
    try {
      stored = await SecureStore.getItemAsync(keyItem(userId), { ...PROTECTED, authenticationPrompt: 'Unlock your Wilma vault' });
    } catch {
      throw new VaultError('cancelled', 'Fingerprint unlock did not work. Try again, or use your passphrase.');
    }
    const k = stored ? crypto.keysFromStored(r, stored) : null;
    if (!k) {
      // Fingerprints changed (the phone threw the key away) or the vault changed.
      await forgetStored(userId);
      throw new VaultError('fingerprint_reset', "The fingerprints on this phone changed, so enter your passphrase once more.");
    }
    opened(k);
  }, [userId, opened, forgetStored]);

  const forgetFingerprint = useCallback(async () => {
    if (userId) await forgetStored(userId);
  }, [userId, forgetStored]);

  const reveal = useCallback(
    async (secretId: string) => {
      const k = keys.current;
      if (!k || shouldLock(unlockedAt.current, Date.now(), null)) {
        lock();
        throw new VaultError('locked', 'The vault locked. Unlock it again.');
      }
      return revealSecret({ revealLink: wilma.revealLink, rpc }, crypto, k, secretId);
    },
    [wilma, lock],
  );

  const value = useMemo<VaultState>(
    () => ({
      status,
      problem,
      locksAt,
      fingerprint,
      fingerprintPossible,
      refresh,
      unlockWithPassphrase,
      unlockWithFingerprint,
      lock,
      forgetFingerprint,
      reveal,
    }),
    [status, problem, locksAt, fingerprint, fingerprintPossible, refresh, unlockWithPassphrase, unlockWithFingerprint, lock, forgetFingerprint, reveal],
  );
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultState {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}
