// Choose a space: one chip per space (restricted ones marked with a lock).
import { Pressable, Text, View } from 'react-native';

import type { Space } from '@/lib/wilma';

import { ErrorBox, Loading, Muted, useColors } from './ui';

export function SpaceChips({
  spaces,
  error,
  onRetry,
  value,
  onChange,
  disabled,
}: {
  spaces: Space[] | null;
  error: string | null;
  onRetry: () => void;
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <>
      {error ? <ErrorBox message={error} onRetry={onRetry} /> : null}
      {!spaces && !error ? <Loading /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(spaces ?? []).map((s) => {
          const on = s.id === value;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              disabled={disabled}
              onPress={() => onChange(s.id)}
              style={{
                borderWidth: 1,
                borderRadius: 16,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderColor: on ? c.accent : c.line,
                backgroundColor: on ? c.accent : c.card,
              }}>
              <Text style={{ color: on ? '#ffffff' : c.text }}>{(s.restricted ? '🔒 ' : '') + s.path}</Text>
            </Pressable>
          );
        })}
      </View>
      {spaces?.length === 0 ? <Muted>No spaces yet. Ask Wilma in the Claude app to create one.</Muted> : null}
    </>
  );
}
