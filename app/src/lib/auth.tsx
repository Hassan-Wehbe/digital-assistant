// Sign-in state for the whole app, and a Wilma client bound to the session.
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { threadsToKeep } from './chatStore';
import { MCP_URL } from './config';
import { deviceChatStore } from './deviceStorage';
import { changePassword as changePasswordFlow } from './password';
import { sessionToken } from './sessionToken';
import { supabase } from './supabase';
import { wilmaClient, type WilmaClient } from './wilma';

interface AuthState {
  session: Session | null;
  /** Signed in: a session, or a saved one that could not be refreshed yet for lack of a connection. */
  signedIn: boolean;
  /** True until the saved session has been read from the phone. */
  loading: boolean;
  wilma: WilmaClient;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** New sign-in password; the current one is checked first. */
  changePassword(current: string, next: string, again: string): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const wilma = wilmaClient({
  url: MCP_URL,
  token: () =>
    sessionToken({
      getSession: () => supabase.auth.getSession(),
      signOutLocally: () => supabase.auth.signOut({ scope: 'local' }),
      isConnectionError: isAuthRetryableFetchError,
    }),
  refresh: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    // No connection: keep the session and let the call fail with "could not reach".
    if (isAuthRetryableFetchError(error)) throw error;
    if (error || !data.session) {
      await supabase.auth.signOut({ scope: 'local' });
      return null;
    }
    return data.session.access_token;
  },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Opened without a connection while the saved session needed its routine refresh:
  // stay signed in (the screens say "could not reach Wilma" and retry) instead of
  // asking for the password again.
  const [waitingForConnection, setWaitingForConnection] = useState(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        setSession(data.session);
        setWaitingForConnection(!data.session && isAuthRetryableFetchError(error));
      })
      .catch(() => setSession(null)) // unreadable: show sign-in rather than hang on the splash screen
      .finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s || event === 'SIGNED_OUT') setWaitingForConnection(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // The chat thread is kept per account on the phone: forgotten on sign-out (also when the
  // session ends by itself, and on account deletion, which signs out), and another account's
  // left-over thread is forgotten when someone signs in.
  const userId = session?.user.id ?? null;
  const signedIn = !!session || waitingForConnection;
  useEffect(() => {
    const keep = threadsToKeep(loading, signedIn, userId);
    if (keep !== undefined) deviceChatStore.forgetOthers(keep);
  }, [loading, signedIn, userId]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      signedIn,
      loading,
      wilma,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!error) return null;
        // Supabase's messages are plain ("Invalid login credentials"); never echo the password.
        return error.message || 'Sign-in failed.';
      },
      async changePassword(current, next, again) {
        await changePasswordFlow(
          {
            verify: async (email, password) => (await supabase.auth.signInWithPassword({ email, password })).error?.message ?? null,
            update: async (password) => (await supabase.auth.updateUser({ password })).error?.message ?? null,
          },
          session?.user.email,
          current,
          next,
          again,
        );
      },
      async signOut() {
        // Ends the session on the server too; without a connection that fails, so the
        // phone forgets it anyway.
        const { error } = await supabase.auth.signOut();
        if (error) await supabase.auth.signOut({ scope: 'local' });
        setWaitingForConnection(false);
      },
    }),
    [session, loading, signedIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
