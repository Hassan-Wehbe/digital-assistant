// Home: the one box (docs/phase5-a5d-one-box-plan.md): a space's or a secret's name is answered
// here with no model call, anything else goes to Wilma. When Wilma can't answer (allowance used
// up, or the chat's Search button), the old note search runs on the text instead, never the model
// (restricted spaces are never searched); spaces to browse below.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { MicButton } from '@/components/MicButton';
import { ItemRow, SpaceRow } from '@/components/rows';
import { UsageMeter } from '@/components/UsageMeter';
import { Button, ErrorBox, KeyboardScreen, Loading, Muted, styles, TextLink, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useChat } from '@/lib/chat';
import { VOICE_ENABLED } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { loadAllowance, usageSummary } from '@/lib/usage';
import { appendDictation, useDictation } from '@/lib/voice';
import type { SearchResult, Space } from '@/lib/wilma';

type Row = { kind: 'space'; space: Space } | { kind: 'item'; item: SearchResult };

export default function Home() {
  const c = useColors();
  const { wilma, session } = useAuth();
  const chat = useChat();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  // Shown under the box when a message for Wilma could not be sent (allowance used up).
  const [held, setHeld] = useState<string | null>(null);
  // "Search" from a chat message comes back here with the last question (q) and runs the note
  // search on it, or, with no question, puts the cursor in the box.
  const { focus, q } = useLocalSearchParams<{ focus?: string; q?: string }>();
  const search = useRef<TextInput>(null);
  const [seenQ, setSeenQ] = useState<string | undefined>(undefined);
  if (q !== seenQ) {
    setSeenQ(q);
    const words = focus === 'search' ? q?.trim() : '';
    if (words) {
      setText(words);
      setQuery(words);
    }
  }
  useEffect(() => {
    if (focus !== 'search') return;
    if (!q?.trim()) search.current?.focus();
    router.setParams({ focus: undefined, q: undefined });
  }, [focus, q]);

  const { data, error, loading, reload } = useLoad<Row[]>(`home:${query}`, async () =>
    query
      ? (await wilma.search({ query, limit: 25, close_matches_only: true })).map((item) => ({ kind: 'item', item }))
      : (await wilma.listSpaces()).map((space) => ({ kind: 'space', space })),
  );

  // This month's allowance (D28), read again whenever the home screen comes back into view.
  const usage = useLoad(`usage:${session?.user.id ?? ''}`, async () => {
    const a = await loadAllowance((fn) => supabase.rpc(fn));
    return a ? usageSummary(a) : null;
  });
  // Two stable reload functions: useReloadOnReturn re-runs whenever its function changes.
  useReloadOnReturn(reload);
  useReloadOnReturn(usage.reload);
  const reloadAll = () => {
    reload();
    usage.reload();
  };

  // Dictated words are added to the box; only Send sends them (A5e Q1).
  const mic = useDictation((words) => setText((t) => appendDictation(t, words)), chat.canSend);

  const submit = async () => {
    if (!chat.canSend || !text.trim() || mic.listening) return;
    const out = await chat.send(text);
    if (out.to === 'none') return;
    if (out.to === 'blocked') {
      // Wilma can't answer this month: search the notes for the text instead (no model).
      setHeld(chat.state.blocked);
      setQuery(text.trim());
      return;
    }
    setText('');
    setQuery('');
    setHeld(null);
    if (out.to === 'space') router.push({ pathname: '/space/[id]', params: { id: out.id, path: out.path } });
    else router.push('/chat');
  };

  const header = (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          ref={search}
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card, flex: 1 }]}
          placeholder="Ask Wilma, or type a name"
          placeholderTextColor={c.muted}
          value={mic.listening ? appendDictation(text, mic.partial) : text}
          editable={!mic.listening}
          onChangeText={(t) => {
            setText(t);
            setHeld(null);
            mic.clearError();
            if (!t.trim()) setQuery('');
          }}
          onSubmitEditing={submit}
          returnKeyType="send"
          clearButtonMode="while-editing"
          maxLength={20000}
        />
        {VOICE_ENABLED ? <MicButton mic={mic} disabled={!chat.canSend} /> : null}
        <Button title="Send" onPress={submit} disabled={!chat.canSend || !text.trim() || mic.listening} />
      </View>
      {mic.listening ? <Muted>Never type or say passwords here. Use the Vault.</Muted> : null}
      {mic.error ? <Muted>{mic.error}</Muted> : null}
      {held ? <Muted>{held}</Muted> : chat.routing ? <Muted>One moment…</Muted> : null}
      {/* Under the box only when it matters: from 80% of the month's allowance. */}
      {usage.data?.low && !held ? <UsageMeter usage={usage.data} /> : null}
      <TextLink title="Conversation" onPress={() => router.push('/chat')} />
      <Button title="New note or photo" kind="plain" onPress={() => router.push('/new-item')} />
      <Button title="📍 Save where I am" kind="plain" onPress={() => router.push({ pathname: '/new-item', params: { here: '1' } })} />
      {query ? (
        <Text style={[styles.title, { color: c.text }]}>{`Results for “${query}”`}</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.title, { color: c.text }]}>Spaces</Text>
          <TextLink title="+ New space" onPress={() => router.push('/new-space')} />
        </View>
      )}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    </View>
  );

  // The account, the recycle bin and the full meter are on Settings (⚙). The Vault stays here
  // until it becomes a tile under the box (UI tidy-up step 3).
  const footer = (
    <View style={{ marginTop: 16 }}>
      <Button title="Vault" kind="plain" onPress={() => router.push('/vault')} />
    </View>
  );

  const empty = loading ? (
    <Loading />
  ) : error ? null : (
    <Muted>{query ? 'Nothing found.' : 'No spaces yet. Tap “+ New space” to create one.'}</Muted>
  );

  return (
    <KeyboardScreen>
      <Stack.Screen
        options={{ headerRight: () => <TextLink title="⚙ Settings" onPress={() => router.push('/settings')} /> }}
      />
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
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reloadAll} />}
      />
    </KeyboardScreen>
  );
}
