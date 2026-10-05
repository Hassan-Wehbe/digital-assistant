// Home: the one box (docs/phase5-a5d-one-box-plan.md): a space's or a secret's name is answered
// here with no model call, anything else goes to Wilma. A small Search button still runs the old
// note search on the box's text (restricted spaces are never searched); spaces to browse below.
import * as Application from 'expo-application';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';

import { ItemRow, SpaceRow } from '@/components/rows';
import { Button, ErrorBox, KeyboardScreen, Loading, Muted, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useChat } from '@/lib/chat';
import { versionLabel } from '@/lib/config';
import type { SearchResult, Space } from '@/lib/wilma';

type Row = { kind: 'space'; space: Space } | { kind: 'item'; item: SearchResult };

export default function Home() {
  const c = useColors();
  const { wilma, session, signOut } = useAuth();
  const chat = useChat();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  // Shown under the box when a message for Wilma could not be sent (allowance used up).
  const [held, setHeld] = useState<string | null>(null);
  // "Search" from a chat message comes back here and puts the cursor in the box.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const search = useRef<TextInput>(null);
  useEffect(() => {
    if (focus !== 'search') return;
    search.current?.focus();
    router.setParams({ focus: undefined });
  }, [focus]);

  const { data, error, loading, reload } = useLoad<Row[]>(`home:${query}`, async () =>
    query
      ? (await wilma.search({ query, limit: 25, close_matches_only: true })).map((item) => ({ kind: 'item', item }))
      : (await wilma.listSpaces()).map((space) => ({ kind: 'space', space })),
  );

  useReloadOnReturn(reload);

  const submit = async () => {
    if (!chat.canSend || !text.trim()) return;
    const out = await chat.send(text);
    if (out.to === 'none') return;
    if (out.to === 'blocked') {
      setHeld(chat.state.blocked);
      return;
    }
    setText('');
    setQuery('');
    setHeld(null);
    if (out.to === 'space') router.push({ pathname: '/space/[id]', params: { id: out.id, path: out.path } });
    else router.push('/chat');
  };

  const link = (title: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8}>
      <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600', opacity: disabled ? 0.5 : 1 }}>{title}</Text>
    </Pressable>
  );

  const header = (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          ref={search}
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card, flex: 1 }]}
          placeholder="Ask Wilma, or type a name"
          placeholderTextColor={c.muted}
          value={text}
          onChangeText={(t) => {
            setText(t);
            setHeld(null);
            if (!t.trim()) setQuery('');
          }}
          onSubmitEditing={submit}
          returnKeyType="send"
          clearButtonMode="while-editing"
          maxLength={20000}
        />
        <Button title="Send" onPress={submit} disabled={!chat.canSend || !text.trim()} />
      </View>
      {held ? <Muted>{held}</Muted> : null}
      <View style={{ flexDirection: 'row', gap: 24 }}>
        {/* Temporary (plan D3): the old note search, never the model. */}
        {link('Search', () => setQuery(text.trim()), !text.trim())}
        {link('Conversation', () => router.push('/chat'))}
      </View>
      <Button title="New note or photo" kind="plain" onPress={() => router.push('/new-item')} />
      {query ? (
        <Text style={[styles.title, { color: c.text }]}>{`Results for “${query}”`}</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.title, { color: c.text }]}>Spaces</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/new-space')} hitSlop={8}>
            <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>+ New space</Text>
          </Pressable>
        </View>
      )}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    </View>
  );

  const footer = (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Muted>Signed in as {session?.user.email ?? 'you'}</Muted>
      <Button title="Vault" kind="plain" onPress={() => router.push('/vault')} />
      <Button title="Recycle bin" kind="plain" onPress={() => router.push('/bin')} />
      <Button title="Change sign-in password" kind="plain" onPress={() => router.push('/account')} />
      <Button title="Sign out" kind="plain" onPress={signOut} />
      <Muted>{versionLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion)}</Muted>
    </View>
  );

  const empty = loading ? (
    <Loading />
  ) : error ? null : (
    <Muted>{query ? 'Nothing found.' : 'No spaces yet. Tap “+ New space” to create one.'}</Muted>
  );

  return (
    <KeyboardScreen>
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
    </KeyboardScreen>
  );
}
