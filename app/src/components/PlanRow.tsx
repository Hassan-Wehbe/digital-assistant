// Home's "Plan with Wilma" row (D38): My day, and the planners still to come (D40) marked SOON. A
// SOON button answers on the phone with one line; it makes no AI request.
import { Alert, Pressable, Text, View } from 'react-native';

import { PLANNERS, type Planner } from '@/lib/planners';

import { Badge, space, styles, useColors } from './ui';

export function PlanRow({ onMyDay, myDayBadge }: { onMyDay: () => void; myDayBadge?: string }) {
  const c = useColors();
  const press = (p: Planner) => (p.id === 'day' ? onMyDay() : Alert.alert(p.title, p.soon ?? ''));
  return (
    <View style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>Plan with Wilma</Text>
      {[PLANNERS.slice(0, 2), PLANNERS.slice(2, 4)].map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: space.s }}>
          {row.map((p) => {
            const soon = !!p.soon;
            const badge = soon ? 'SOON' : p.id === 'day' ? myDayBadge : undefined;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={soon ? `${p.title}, coming soon` : p.title}
                onPress={() => press(p)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minWidth: 0,
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                    paddingHorizontal: space.m,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderStyle: soon ? 'dashed' : 'solid',
                    borderColor: soon ? c.line : c.tint,
                    backgroundColor: soon ? c.background : c.tint,
                  },
                  pressed && { opacity: 0.6 },
                ]}>
                <Text style={{ fontSize: 18 }}>{p.icon}</Text>
                <Text style={{ flex: 1, color: soon ? c.muted : c.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
                  {p.title}
                </Text>
                {badge ? <Badge text={badge} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
