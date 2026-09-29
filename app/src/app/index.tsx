// Home: search everything (restricted spaces are never searched), or browse by space.
import * as Application from 'expo-application';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { ItemRow, SpaceRow } from '@/components/rows';
import { Button, ErrorBox, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { versionLabel } from '@/lib/config';
import type { SearchResult, Space } from '@/lib/wilma';

type Row = { kind: 'space'; space: Space } | { kind: 'item'; item: SearchResult };

export default function Home() {
  const c = useColors();
  const { wilma, session, signOut } = useAuth();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  const { data, error, loading, reload } = useLoad<Row[]>(`home:${query}`, async () =>
    query
      ? (await wilma.search({ query, limit: 25, close_matches_only: true })).map((item) => ({ kind: 'item', item }))
      : (await wilma.listSpaces()).map((space) => ({ kind: 'space', space })),
  );

  const header = (
    <View style={{ gap: 12 }}>
      <TextInput
        style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
        placeholder="Search your notes, recipes, designs…"
        placeholderTextColor={c.muted}
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (!t.trim()) setQuery('');
        }}
        onSubmitEditing={() => setQuery(text.trim())}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCapitalize="none"
      />
      <Text style={[styles.title, { color: c.text }]}>{query ? `Results for “${query}”` : 'Spaces'}</Text>
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    </View>
  );

  const footer = (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Muted>Signed in as {session?.user.email ?? 'you'}</Muted>
      <Button title="Sign out" kind="plain" onPress={signOut} />
      <Muted>{versionLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion)}</Muted>
    </View>
  );

  const empty = loading ? (
    <Loading />
  ) : error ? null : (
    <Muted>{query ? 'Nothing found.' : 'No spaces yet. Ask Wilma in the Claude app to create one.'}</Muted>
  );

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.list}
      data={data ?? []}
      keyExtractor={(r) => (r.kind === 'space' ? r.space.id : r.item.id)}
      renderItem={({ item: r }) => (r.kind === 'space' ? <SpaceRow space={r.space} /> : <ItemRow item={r.item} />)}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
    />
  );
}
