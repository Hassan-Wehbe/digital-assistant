import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth';
import { ShareProvider, useShare } from '@/lib/shareIntake';

// Keep the splash screen up until the saved session has been read, so the sign-in
// screen does not flash before the home screen.
SplashScreen.preventAutoHideAsync();

function Screens() {
  const { signedIn, loading } = useAuth();
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
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Wilma' }} />
        <Stack.Screen name="space/[id]" options={{ title: 'Space' }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Item' }} />
        <Stack.Screen name="new-item" options={{ title: 'New note' }} />
        <Stack.Screen name="attach" options={{ title: 'Add photos or files' }} />
        <Stack.Screen name="bin" options={{ title: 'Recycle bin' }} />
        <Stack.Screen name="share" options={{ title: 'Share to Wilma' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
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
          <Screens />
        </AuthProvider>
      </ShareProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
