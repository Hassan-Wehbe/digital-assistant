// Sign-in state for the whole app, and a Wilma client bound to the session.
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { MCP_URL } from './config';
import { supabase } from './supabase';
import { wilmaClient, type WilmaClient } from './wilma';

interface AuthState {
  session: Session | null;
  /** True until the saved session has been read from the phone. */
  loading: boolean;
  wilma: WilmaClient;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const wilma = wilmaClient({
  url: MCP_URL,
  token: async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    // The saved session is gone or unreadable: go back to the sign-in screen.
    if (!token) await supabase.auth.signOut({ scope: 'local' });
    return token;
  },
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

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null)) // unreadable: show sign-in rather than hang on the splash screen
      .finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      wilma,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!error) return null;
        // Supabase's messages are plain ("Invalid login credentials"); never echo the password.
        return error.message || 'Sign-in failed.';
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
