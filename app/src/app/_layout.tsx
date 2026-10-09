import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ChatProvider } from '@/lib/chat';
import { ShareProvider, useShare } from '@/lib/shareIntake';
import { VaultProvider } from '@/lib/vault';

// Keep the splash screen up until the saved session has been read, so the sign-in
// screen does not flash before the home screen.
SplashScreen.preventAutoHideAsync();

function Screens() {
  const { signedIn, loading } = useAuth();
  const c = useColors();
  // Android draws the app under its three-button bar (and iOS under the home indicator): pad every
  // screen's bottom by that bar, so the last button or text box is never hidden behind it.
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  // Something was shared to Wilma: open the share screen once per share, as soon as the
  // app is signed in (signed out, the sign-in screen comes first and says why).
  const { seq } = useShare();
  const navReady = !!useRootNavigationState()?.key;
  const opened = useRef(0);
  useEffect(() => {
    if (loading || !signedIn || !navReady || !seq || opened.current === seq) return;
    opened.current = seq;
    router.navigate('/share');
  }, [loading, signedIn, navReady, seq]);
  // Signed out, only the sign-in screen exists; signed in, it does not.
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: c.background, paddingBottom: insets.bottom } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Wilma' }} />
        {/* The chat slides up from the bottom, as if the home box grew into it. */}
        <Stack.Screen name="chat" options={{ title: 'Ask Wilma', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="space/[id]" options={{ title: 'Space' }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Item' }} />
        <Stack.Screen name="new-item" options={{ title: 'New note' }} />
        <Stack.Screen name="edit-item" options={{ title: 'Edit note' }} />
        <Stack.Screen name="new-space" options={{ title: 'New space' }} />
        <Stack.Screen name="spaces" options={{ title: 'All spaces' }} />
        <Stack.Screen name="edit-space" options={{ title: 'Edit space' }} />
        <Stack.Screen name="attach" options={{ title: 'Add photos or files' }} />
        <Stack.Screen name="bin" options={{ title: 'Recycle bin' }} />
        <Stack.Screen name="account" options={{ title: 'Sign-in password' }} />
        <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="calendars" options={{ title: 'Calendars' }} />
        <Stack.Screen name="day" options={{ title: 'My day' }} />
        <Stack.Screen name="tasks" options={{ title: 'Tasks' }} />
        <Stack.Screen name="task" options={{ title: 'Task' }} />
        <Stack.Screen name="pro" options={{ title: 'Wilma Pro', presentation: 'modal' }} />
        <Stack.Screen name="share" options={{ title: 'Share to Wilma' }} />
        <Stack.Screen name="vault/index" options={{ title: 'Vault' }} />
        <Stack.Screen name="vault/[id]" options={{ title: 'Secret' }} />
        <Stack.Screen name="vault/enter" options={{ title: 'Save a secret' }} />
        <Stack.Screen name="vault/setup" options={{ title: 'Set up the vault' }} />
        <Stack.Screen name="vault/passphrase" options={{ title: 'Vault passphrase' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="create-account" options={{ title: 'Create account' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ShareProvider>
        <AuthProvider>
          <VaultProvider>
            <ChatProvider>
              <Screens />
            </ChatProvider>
          </VaultProvider>
        </AuthProvider>
      </ShareProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
