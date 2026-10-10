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

/** The spacing scale (docs/ui-review.md): gaps and padding use these, nothing in between. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;

/** A link-styled button: "+ New space", "Conversation". */
export function TextLink({ title, onPress, accessibilityLabel }: { title: string; onPress: () => void; accessibilityLabel?: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
      <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

/**
 * A round button holding one symbol (＋, 🎤, ↑). `label` is what a screen reader says, so it must
 * name the action ("Send", "Dictate"), never the symbol. kind: plain (no outline), outline,
 * primary (filled accent: Send), danger (filled red: the mic while listening).
 */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  kind = 'outline',
  selected,
  busy,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'plain' | 'outline' | 'primary' | 'danger';
  selected?: boolean;
  busy?: boolean;
}) {
  const c = useColors();
  const filled = kind === 'primary' || kind === 'danger' || selected;
  const fill = kind === 'danger' ? c.danger : c.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected, busy: !!busy }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        filled ? { backgroundColor: fill } : kind === 'outline' ? { borderColor: c.line, borderWidth: 1, backgroundColor: c.card } : null,
        (pressed || disabled) && { opacity: 0.5 },
      ]}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: filled ? '#ffffff' : c.accent }}>{icon}</Text>
    </Pressable>
  );
}

/** One action tile (💬 Chat, 📍 Save here, 🔒 Vault); tiles sit in a row and share its width. */
export function Tile({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  grow = 1,
  badge,
}: {
  icon: string;
  title: string;
  /** A small label on the corner ("PRO"). */
  badge?: string;
  /** A second, muted line ("where's the wifi note?"), cut to one line. */
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** Share of the row's width (the Continue tile is wider). */
  grow?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        { flex: grow, minWidth: 0, borderWidth: 1, borderRadius: 12, borderColor: c.line, backgroundColor: c.card, padding: space.s, gap: 2 },
        subtitle ? { alignItems: 'flex-start' } : { alignItems: 'center' },
        pressed && { opacity: 0.6 },
      ]}>
      <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
        {subtitle ? `${icon} ${title}` : icon}
      </Text>
      <Text style={{ color: subtitle ? c.muted : c.text, fontSize: 13 }} numberOfLines={1}>
        {subtitle ?? title}
      </Text>
      {badge ? <Badge text={badge} corner /> : null}
    </Pressable>
  );
}

/** A small filled label ("PRO"); `corner` pins it to a tile's top right. */
export function Badge({ text, corner }: { text: string; corner?: boolean }) {
  const c = useColors();
  return (
    <View
      style={[
        { backgroundColor: c.warn, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
        corner && { position: 'absolute', top: -6, right: -4 },
      ]}>
      <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>{text}</Text>
    </View>
  );
}

/** Rows in one rounded box with thin lines between them (spaces on home, Settings). */
export function GroupList({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={{ borderWidth: 1, borderRadius: 12, borderColor: c.line, backgroundColor: c.card, overflow: 'hidden' }}>{children}</View>;
}

/** A row of a GroupList. Without onPress it is plain text (a restricted space, "Signed in as"). */
export function GroupRow({
  title,
  subtitle,
  onPress,
  first,
  dimmed,
  checked,
  badge,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** The first row has no line above it. */
  first?: boolean;
  dimmed?: boolean;
  /** One of a set of choices (Settings → Distances): a ✓ instead of ›, read out as a radio button. */
  checked?: boolean;
  /** A small label after the title (BUILT-IN on Tasks and Memories). */
  badge?: string;
}) {
  const choice = checked !== undefined;
  const c = useColors();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.m, paddingHorizontal: space.m }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: onPress ? '600' : '400' }}>{title}</Text>
          {badge ? <Badge text={badge} /> : null}
        </View>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {choice ? (
        <Text style={{ color: c.accent, fontSize: 18, fontWeight: '700' }}>{checked ? '✓' : ''}</Text>
      ) : onPress ? (
        <Text style={{ color: c.muted, fontSize: 20 }}>›</Text>
      ) : null}
    </View>
  );
  const frame = [!first && { borderTopWidth: 1, borderTopColor: c.line }, dimmed && { opacity: 0.6 }];
  return onPress ? (
    <Pressable
      accessibilityRole={choice ? 'radio' : 'button'}
      accessibilityState={choice ? { checked } : undefined}
      onPress={onPress}
      style={({ pressed }) => [...frame, pressed && { opacity: 0.6 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={frame}>{body}</View>
  );
}

/** The white top panel on home that holds the Wilma box and the tiles, apart from what is below. */
export function Panel({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={{ backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line, padding: space.m, gap: space.m }}>{children}</View>;
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
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
