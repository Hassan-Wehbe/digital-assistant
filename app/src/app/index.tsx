// Placeholder home screen (milestone A0). Sign-in and search arrive in A1.
import * as Application from 'expo-application';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { versionLabel } from '@/lib/config';

export default function Home() {
  const c = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.line }]}>
        <Text style={[styles.title, { color: c.text }]}>{"Hi, I'm Wilma."}</Text>
        <Text style={[styles.body, { color: c.text }]}>
          Your assistant app is being built. Soon you can search your spaces, save notes and photos,
          and open your vault here.
        </Text>
        <Text style={[styles.muted, { color: c.muted }]}>
          {versionLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: 12, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24 },
  muted: { fontSize: 14 },
});
