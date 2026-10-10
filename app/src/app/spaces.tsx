// All spaces (Home's "See all spaces"): every space, restricted ones dimmed and never opened from
// here (CLAUDE.md rule 3), and + New space. The Tasks space opens the Tasks screen.
import { router, Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { ErrorBox, GroupList, GroupRow, Loading, Muted, space, styles, TextLink, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { isTasksSpace } from '@/lib/homeSpaces';
import { isBuiltIn, spaceTitle } from '@/lib/memory';
import { useOpenSpace } from '@/lib/openSpace';

export default function SpacesScreen() {
  const c = useColors();
  const { wilma } = useAuth();
  const open = useOpenSpace();
  const { data, error, loading, reload } = useLoad('spaces:all', () => wilma.listSpaces());
  useReloadOnReturn(reload);
  const spaces = data ?? [];
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list}>
      <Stack.Screen options={{ title: 'All spaces' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.title, { color: c.text }]}>{`${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}`}</Text>
        <TextLink title="+ New space" onPress={() => router.push('/new-space')} />
      </View>
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {spaces.length ? (
        <GroupList>
          {spaces.map((sp, i) =>
            sp.restricted ? (
              <GroupRow key={sp.id} first={i === 0} dimmed title={`🔒 ${sp.path}`} subtitle="Restricted" />
            ) : (
              <GroupRow
                key={sp.id}
                first={i === 0}
                title={isTasksSpace(sp) ? `✅ ${sp.path}` : spaceTitle(sp)}
                subtitle={isTasksSpace(sp) ? 'Opens your tasks' : sp.description ?? undefined}
                badge={isBuiltIn(sp) ? 'BUILT-IN' : undefined}
                onPress={() => open(sp)}
              />
            ),
          )}
        </GroupList>
      ) : !loading && !error ? (
        <Muted>No spaces yet. Tap “+ New space” to create one.</Muted>
      ) : null}
      <View style={{ height: space.l }} />
    </ScrollView>
  );
}
