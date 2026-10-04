// Small building blocks shared by the screens.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors } from '@/constants/theme';

export function useColors() {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

/**
 * Load something from Wilma whenever `key` changes; `reload` fetches again (pull to
 * refresh, retry). An older, slower answer never replaces a newer one.
 */
export function useLoad<T>(key: string, load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; tag: string; data: T | null; error: string | null } | null>(null);
  const tag = `${key}#${attempt}`;

  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setResult({ key, tag, data, error: null }),
      (e: unknown) =>
        current &&
        setResult((r) => ({
          key,
          tag,
          data: r?.key === key ? r.data : null, // keep what is shown if a refresh fails
          error: e instanceof Error ? e.message : String(e),
        })),
    );
    return () => {
      current = false;
    };
    // `load` is a new function on every render; `key` says when it asks for something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    data: result?.key === key ? result.data : null,
    error: result?.tag === tag ? result.error : null,
    loading: result?.tag !== tag,
    reload,
  };
}

/** Load again when the screen is shown again (coming back after adding or deleting something). */
export function useReloadOnReturn(reload: () => void) {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reload();
    }, [reload]),
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.line }, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  disabled,
  kind = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'plain' | 'danger';
}) {
  const c = useColors();
  const primary = kind === 'primary';
  const color = primary ? '#ffffff' : kind === 'danger' ? c.danger : c.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: c.accent } : { borderColor: c.line, borderWidth: 1 },
        (pressed || disabled) && { opacity: 0.6 },
      ]}>
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

/** Ask before doing something destructive; resolves true only if the user confirms. */
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <Card>
      <Text style={{ color: c.text, fontSize: 16 }}>{message}</Text>
      {onRetry && <Button title="Try again" kind="plain" onPress={onRetry} />}
    </Card>
  );
}

/**
 * A screen that stays clear of the on-screen keyboard. KeyboardAvoidingView measures the keyboard
 * from the window top, so the header and status bar above the screen must be passed as its offset.
 * (The bottom button bar of Android is padded once for every screen in app/_layout.tsx.)
 */
export function KeyboardScreen({ children }: { children: ReactNode }) {
  const c = useColors();
  const top = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  return (
    <View
      ref={top}
      style={{ flex: 1, backgroundColor: c.background }}
      onLayout={() => top.current?.measureInWindow((_x, y) => setOffset(y))}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={offset}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.muted, fontSize: 14 }}>{children}</Text>;
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  button: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 12 },
  title: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
