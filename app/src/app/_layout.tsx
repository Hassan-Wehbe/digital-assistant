import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth';

// Keep the splash screen up until the saved session has been read, so the sign-in
// screen does not flash before the home screen.
SplashScreen.preventAutoHideAsync();

function Screens() {
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);
  const signedIn = !!session;
  // Signed out, only the sign-in screen exists; signed in, it does not.
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Wilma' }} />
        <Stack.Screen name="space/[id]" options={{ title: 'Space' }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Item' }} />
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
      <AuthProvider>
        <Screens />
      </AuthProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
