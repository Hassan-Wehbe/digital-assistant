// List rows for spaces and items.
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { isPlace, placeLine } from '@/lib/places';
import type { SearchResult, Space } from '@/lib/wilma';

import { Card, Muted, styles, useColors } from './ui';

export function SpaceRow({ space }: { space: Space }) {
  const c = useColors();
  if (space.restricted) {
    // Restricted spaces are listed but never opened or searched here (CLAUDE.md rule 3).
    return (
      <Card>
        <Text style={[styles.title, { color: c.text }]}>🔒 {space.path}</Text>
        <Muted>Restricted space. Opening restricted spaces in the app comes later.</Muted>
      </Card>
    );
  }
  return (
    <Link href={{ pathname: '/space/[id]', params: { id: space.id, path: space.path } }} asChild>
      <Pressable accessibilityRole="button">
        <Card>
          <Text style={[styles.title, { color: c.text }]}>{space.path}</Text>
          {space.description ? <Muted>{space.description}</Muted> : null}
        </Card>
      </Pressable>
    </Link>
  );
}

export function ItemRow({ item, showSpace = true }: { item: SearchResult; showSpace?: boolean }) {
  const c = useColors();
  // A place shows its kind and want / been instead of "place" ("Restaurant · $$ · Want to go").
  const kind = isPlace(item.item_type) ? placeLine(item.place ?? {}) : item.item_type;
  const meta = [showSpace ? item.space : null, kind, ...(item.tags ?? []).map((t) => `#${t}`)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link href={{ pathname: '/item/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button">
        <Card>
          <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
          {meta ? <Muted>{meta}</Muted> : null}
          {item.snippet ? (
            <View>
              <Text style={{ color: c.text, fontSize: 15, lineHeight: 22 }} numberOfLines={3}>
                {item.snippet}
              </Text>
            </View>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  );
}
