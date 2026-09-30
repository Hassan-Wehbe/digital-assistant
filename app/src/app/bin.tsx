// The recycle bin: deleted notes, to restore or delete for good.
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { Button, Card, confirm, ErrorBox, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { BinItem } from '@/lib/wilma';

export default function RecycleBin() {
  const c = useColors();
  const { wilma } = useAuth();
  const { data, error, loading, reload } = useLoad('bin', () => wilma.recycleBin());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setProblem(null);
    try {
      await action();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const purge = async (item: BinItem) => {
    const files = item.attachments ? ` and its ${item.attachments} ${item.attachments === 1 ? 'file' : 'files'}` : '';
    if (await confirm('Delete for good?', `“${item.title}”${files} will be deleted for good. This cannot be undone.`, 'Delete')) {
      await run(item.id, () => wilma.purgeItem(item.id));
    }
  };

  const emptyBin = async () => {
    const items = data ?? [];
    if (!(await confirm('Empty the recycle bin?', `${items.length} ${items.length === 1 ? 'note' : 'notes'} and their files will be deleted for good. This cannot be undone.`, 'Empty'))) return;
    await run('all', async () => {
      for (const item of items) await wilma.purgeItem(item.id);
    });
  };

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.list}
      data={data ?? []}
      keyExtractor={(i) => i.id}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <Muted>Deleted notes stay here until you restore them or delete them for good.</Muted>
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
        </View>
      }
      renderItem={({ item }) => (
        <Card>
          <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
          <Muted>
            {[item.space, item.item_type, item.attachments ? `${item.attachments} ${item.attachments === 1 ? 'file' : 'files'}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
          <Muted>Deleted {new Date(item.deleted_at).toLocaleString()}</Muted>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Restore" kind="plain" onPress={() => run(item.id, () => wilma.restoreItem(item.id))} disabled={!!busy} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={busy === item.id ? 'Please wait…' : 'Delete for good'} kind="danger" onPress={() => purge(item)} disabled={!!busy} />
            </View>
          </View>
        </Card>
      )}
      ListEmptyComponent={loading ? <Loading /> : error ? null : <Muted>The recycle bin is empty.</Muted>}
      ListFooterComponent={
        data && data.length > 1 ? (
          <Button title={busy === 'all' ? 'Emptying…' : 'Empty the recycle bin'} kind="danger" onPress={emptyBin} disabled={!!busy} />
        ) : null
      }
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
    />
  );
}
