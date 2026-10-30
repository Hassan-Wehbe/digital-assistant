// "What is it?" (docs/note-kind-mockups.html, layout A): one connected bar of icons, like tabs, so it
// never looks like the space or any other choice (owner, 2026-10-30).
import { Pressable, Text, View } from 'react-native';

import { useColors } from './ui';

export function KindBar<T extends string>({
  options,
  selected,
  onPress,
  disabled,
}: {
  options: readonly { value: T; icon: string; label: string }[];
  selected: T;
  onPress: (value: T) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: 'hidden', backgroundColor: c.card }}>
      {options.map((o, i) => {
        const on = o.value === selected;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={o.label}
            disabled={disabled}
            onPress={() => onPress(o.value)}
            style={({ pressed }) => [
              { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2, backgroundColor: on ? c.accent : 'transparent' },
              i > 0 && { borderLeftWidth: 1, borderLeftColor: c.line },
              pressed && !on && { opacity: 0.6 },
            ]}>
            <Text style={{ fontSize: 18 }}>{o.icon}</Text>
            <Text style={{ fontSize: 12, color: on ? '#ffffff' : c.text, fontWeight: on ? '700' : '400' }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
