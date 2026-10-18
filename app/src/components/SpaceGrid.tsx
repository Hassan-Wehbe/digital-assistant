// Home's spaces as a small grid (D38): a coloured initial and the name, three to a row, no
// descriptions. The colour only tells tiles apart; it carries no meaning.
import { Pressable, Text, View } from 'react-native';

import { spaceTitle } from '@/lib/memory';
import type { Space } from '@/lib/wilma';

import { space, useColors } from './ui';

/** The last part of a path ("Work/Gartner" → "Gartner"), as the tile's name. */
export const tileName = (s: Pick<Space, 'path' | 'built_in'>) => spaceTitle({ ...s, path: s.path.split('/').pop() ?? s.path });

export function SpaceGrid({ spaces, onOpen }: { spaces: Space[]; onOpen: (s: Space) => void }) {
  const c = useColors();
  const tints = [
    [c.tint, c.accent],
    [c.goodBg, c.good],
    [c.warnBg, c.warn],
    [c.rainBg, c.rain],
  ] as const;
  const rows: Space[][] = [];
  for (let i = 0; i < spaces.length; i += 3) rows.push(spaces.slice(i, i + 3));
  return (
    <View style={{ gap: space.s }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: space.s }}>
          {[0, 1, 2].map((k) => {
            const s = row[k];
            // An empty cell keeps the last row's tiles the same width as the others.
            if (!s) return <View key={`empty${k}`} style={{ flex: 1 }} />;
            const [bg, fg] = tints[(r * 3 + k) % tints.length];
            const last = s.path.split('/').pop() ?? s.path;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.path}`}
                onPress={() => onOpen(s)}
                style={({ pressed }) => [
                  { flex: 1, minWidth: 0, minHeight: 72, borderWidth: 1, borderRadius: 12, borderColor: c.line, backgroundColor: c.card, padding: space.s, gap: 6 },
                  pressed && { opacity: 0.6 },
                ]}>
                <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: fg, fontSize: 14, fontWeight: '700' }}>{last.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                  {tileName(s)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
