// One space: its most recently updated items (and those of its sub-spaces), then its vault
// entries as 🔒 rows (name and website only; a tap opens the entry in the Vault).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { ItemRow } from '@/components/rows';
import {
  Button,
  confirm,
  ErrorBox,
  GroupList,
  GroupRow,
  Loading,
  Muted,
  styles,
  useColors,
  useLoad,
  useReloadOnReturn,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { secretRoute, spaceSecretRow } from '@/lib/secretRows';

export default function SpaceScreen() {
  const c = useColors();
  const { id, path } = useLocalSearchParams<{ id: string; path?: string }>();
  const { wilma } = useAuth();
  const { data, error, loading, reload } = useLoad(`space:${id}`, () => wilma.search({ space: id, limit: 50 }));
  useReloadOnReturn(reload);
  // Names and websites only (find_secret never returns values; restricted spaces are left out).
  const secrets = useLoad(`space-secrets:${id}`, () => wilma.findSecrets({ space: id }));
  useReloadOnReturn(secrets.reload);
  const reloadAll = () => {
    reload();
    secrets.reload();
  };
  const nothing = !loading && !secrets.loading && !error && !secrets.error && !data?.length && !secrets.data?.length;
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
      <Stack.Screen
        options={{
          title: path ?? 'Space',
          // Edit (name and description) up here; Delete stays at the bottom of the list.
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit this space"
              onPress={() => router.push({ pathname: '/edit-space', params: { id } })}
              disabled={deleting}
              hitSlop={8}>
              <Text style={{ color: c.accent, fontSize: 16 }}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.list}
        data={data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ItemRow item={item} showSpace={item.space !== path} />}
        ListHeaderComponent={
          <>
            <Button title="New note here" onPress={() => router.push({ pathname: '/new-item', params: { space: id } })} />
            {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
            {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          </>
        }
        ListEmptyComponent={loading ? <Loading /> : nothing ? <Muted>Nothing in this space yet.</Muted> : null}
        ListFooterComponent={
          <View style={{ gap: 8, marginTop: 16 }}>
            {secrets.error ? <ErrorBox message={secrets.error} onRetry={secrets.reload} /> : null}
            {secrets.data?.length ? (
              <GroupList>
                {secrets.data.map((s, i) => (
                  <GroupRow key={s.id} first={i === 0} {...spaceSecretRow(s)} onPress={() => router.push(secretRoute(s))} />
                ))}
              </GroupList>
            ) : null}
            <Button title="New space inside this one" kind="plain" onPress={() => router.push({ pathname: '/new-space', params: { parent: id } })} />
            <Button title={deleting ? 'Deleting…' : 'Delete space'} kind="danger" onPress={deleteSpace} disabled={deleting} />
          </View>
        }
        refreshControl={<RefreshControl refreshing={(loading && !!data) || (secrets.loading && !!secrets.data)} onRefresh={reloadAll} />}
      />
    </>
  );
}
