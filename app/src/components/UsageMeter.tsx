// This month's AI allowance (D28): a bar and "about N requests left · resets Nov 1". Hidden when
// the allowance cannot be read (offline): it is a convenience, never a reason to block anything.
import { Text, View } from 'react-native';

import type { UsageSummary } from '@/lib/usage';
import { usageText } from '@/lib/usage';

import { useColors } from './ui';

export function UsageMeter({ usage }: { usage: UsageSummary }) {
  const c = useColors();
  const color = usage.usedUp ? c.danger : usage.low ? '#d08a00' : c.accent;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={usageText(usage)}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(usage.fraction * 100) }}
      style={{ gap: 6 }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden' }}>
        <View style={{ height: 8, width: `${Math.max(2, Math.round(usage.fraction * 100))}%`, backgroundColor: color }} />
      </View>
      <Text style={{ color: usage.usedUp ? c.danger : c.muted, fontSize: 14 }}>{usageText(usage)}</Text>
    </View>
  );
}
