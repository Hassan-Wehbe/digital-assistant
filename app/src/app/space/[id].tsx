// One space: its most recently updated items (and those of its sub-spaces).
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, RefreshControl } from 'react-native';

import { ItemRow } from '@/components/rows';
import { ErrorBox, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SpaceScreen() {
  const c = useColors();
  const { id, path } = useLocalSearchParams<{ id: string; path?: string }>();
  const { wilma } = useAuth();
  const { data, error, loading, reload } = useLoad(`space:${id}`, () => wilma.search({ space: id, limit: 50 }));

  return (
    <>
      <Stack.Screen options={{ title: path ?? 'Space' }} />
      <FlatList
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.list}
        data={data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ItemRow item={item} showSpace={item.space !== path} />}
        ListHeaderComponent={error ? <ErrorBox message={error} onRetry={reload} /> : null}
        ListEmptyComponent={loading ? <Loading /> : error ? null : <Muted>Nothing in this space yet.</Muted>}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
      />
    </>
  );
}
