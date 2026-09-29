// Supabase client for sign-in. Signs in with email and password (like the vault
// pages), so the session is a normal one with no `client_id`.
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { deviceSessionStorage } from './deviceStorage';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // On the web build the browser's own storage is used; on phones, the encrypted store.
    ...(Platform.OS !== 'web' ? { storage: deviceSessionStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

// Refresh the token only while the app is open (a background timer cannot be relied on).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
