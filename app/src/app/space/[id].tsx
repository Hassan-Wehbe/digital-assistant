// One space: its most recently updated items (and those of its sub-spaces).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { ItemRow } from '@/components/rows';
import { Button, confirm, ErrorBox, Loading, Muted, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SpaceScreen() {
  const c = useColors();
  const { id, path } = useLocalSearchParams<{ id: string; path?: string }>();
  const { wilma } = useAuth();
  const { data, error, loading, reload } = useLoad(`space:${id}`, () => wilma.search({ space: id, limit: 50 }));
  useReloadOnReturn(reload);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Only an empty space can be deleted; the server says what is still inside otherwise.
  const deleteSpace = async () => {
    const ok = await confirm('Delete this space?', `“${path ?? 'This space'}” will be deleted. Only an empty space can be deleted.`, 'Delete');
    if (!ok) return;
    setDeleting(true);
    setProblem(null);
    try {
      await wilma.deleteSpace(id);
      router.back();
    } catch (e) {
      setProblem((e instanceof Error ? e.message : String(e)).replace(/^Could not delete the space: /, ''));
      setDeleting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: path ?? 'Space' }} />
      <FlatList
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.list}
        data={data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ItemRow item={item} showSpace={item.space !== path} />}
        ListHeaderComponent={
          <>
            <Button title="New note here" onPress={() => router.push({ pathname: '/new-item', params: { space: id } })} />
            {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          </>
        }
        ListEmptyComponent={loading ? <Loading /> : error ? null : <Muted>Nothing in this space yet.</Muted>}
        ListFooterComponent={
          <View style={{ gap: 8, marginTop: 16 }}>
            {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
            <Button title={deleting ? 'Deleting…' : 'Delete space'} kind="danger" onPress={deleteSpace} disabled={deleting} />
          </View>
        }
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
      />
    </>
  );
}
