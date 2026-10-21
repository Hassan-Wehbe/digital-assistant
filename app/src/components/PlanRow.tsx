// Home's "Plan with Wilma" row (D38): My day, Your morning (app/morning.tsx; NEW until this
// morning's briefing is opened), Date night and Family day (D40, app/outing.tsx), and Vacation
// marked SOON. A SOON button answers on the phone with one line; it makes no AI request. Under it,
// "Cook with Wilma" (recipes step 6): What's for dinner? and Make a cocktail (app/suggest.tsx).
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useAge } from '@/components/useAge';
import { drinks } from '@/lib/age';
import { COOKS, pairs, PLANNERS, type Planner } from '@/lib/planners';

import { Badge, space, styles, useColors } from './ui';

function RowButton({ icon, title, badge, soon, onPress }: { icon: string; title: string; badge?: string; soon?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={soon ? `${title}, coming soon` : badge === 'NEW' ? `${title}, new` : title}
      onPress={onPress}
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
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={{ flex: 1, color: soon ? c.muted : c.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
        {title}
      </Text>
      {badge ? <Badge text={badge} /> : null}
    </Pressable>
  );
}

function Rows<T>({ title, list, button }: { title: string; list: readonly T[]; button: (x: T) => ReactElement }) {
  const c = useColors();
  return (
    <View style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {pairs(list).map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: space.s }}>
          {row.map(button)}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

export function PlanRow({
  onMyDay,
  myDayBadge,
  morningBadge,
}: {
  onMyDay: () => void;
  /** "PRO" for Free accounts (My day and Your morning are Pro). */
  myDayBadge?: string;
  /** "NEW" while this morning's briefing has not been opened. */
  morningBadge?: string;
}) {
  const press = (p: Planner) =>
    p.soon
      ? Alert.alert(p.title, p.soon)
      : p.id === 'day'
        ? onMyDay()
        : p.id === 'morning'
          ? router.push(myDayBadge ? '/pro' : '/morning')
          : router.push({ pathname: '/outing', params: { kind: p.id } });
  return (
    <Rows
      title="Plan with Wilma"
      list={PLANNERS}
      button={(p) => (
        <RowButton
          key={p.id}
          icon={p.icon}
          title={p.title}
          soon={!!p.soon}
          badge={p.soon ? 'SOON' : p.id === 'day' ? myDayBadge : p.id === 'morning' ? (myDayBadge ?? morningBadge) : undefined}
          onPress={() => press(p)}
        />
      )}
    />
  );
}

export function CookRow() {
  // Under 21, or until the age is given: Make a mocktail (D44; the server gives mocktails only).
  const d = drinks(useAge().status);
  const list = COOKS.map((x) => (x.mode === 'cocktail' ? { ...x, icon: d.icon, title: d.button } : x));
  return (
    <Rows
      title="Cook with Wilma"
      list={list}
      button={(x) => (
        <RowButton key={x.mode} icon={x.icon} title={x.title} onPress={() => router.push({ pathname: '/suggest', params: { mode: x.mode } })} />
      )}
    />
  );
}
