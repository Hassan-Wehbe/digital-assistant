// The mic next to Send (A5e, docs/phase5-a5e-voice-plan.md): tap to dictate, tap again to stop.
// The words go into the box; only the person's own tap on Send ever sends them (Q1). Used only
// by the home box and the chat box, never in the vault, sign-in or account screens (Q4,
// appConfig.test.ts checks that).
import { Pressable, Text } from 'react-native';

import { styles, useColors } from '@/components/ui';
import type { DictationControls } from '@/lib/voice';

export function MicButton({ mic, disabled }: { mic: DictationControls; disabled?: boolean }) {
  const c = useColors();
  const listening = mic.listening;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop dictating' : 'Dictate'}
      accessibilityState={{ disabled: !!disabled && !listening, busy: listening }}
      onPress={listening ? mic.stop : mic.start}
      disabled={!!disabled && !listening}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { paddingHorizontal: 12 },
        listening ? { backgroundColor: c.danger } : { borderColor: c.line, borderWidth: 1 },
        (pressed || (disabled && !listening)) && { opacity: 0.6 },
      ]}>
      <Text style={[styles.buttonText, { color: listening ? '#ffffff' : c.accent }]}>{listening ? '■' : '🎤'}</Text>
    </Pressable>
  );
}
