// Home: the one box (docs/phase5-a5d-one-box-plan.md): a space's or a secret's name is answered
// here with no model call, anything else goes to Wilma. When Wilma can't answer (allowance used
// up, or the chat's Search button), the old note search runs on the text instead, never the model
// (restricted spaces are never searched); spaces to browse below.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { MicButton } from '@/components/MicButton';
import { ItemRow } from '@/components/rows';
import {
  ErrorBox,
  GroupList,
  GroupRow,
  IconButton,
  KeyboardScreen,
  Loading,
  Muted,
  Panel,
  space,
  styles,
  TextLink,
  Tile,
  useColors,
  useLoad,
  useReloadOnReturn,
} from '@/components/ui';
import { BoxCounter, WilmaBox } from '@/components/WilmaBox';
import { useAuth } from '@/lib/auth';
import { useChat } from '@/lib/chat';
import { lastUserText } from '@/lib/chatThread';
import { VOICE_ENABLED } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { loadAllowance, usageCounterText, usageSummary } from '@/lib/usage';
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
  // The ＋ menu under the box: a photo, pictures or a plain new note.
  const [menu, setMenu] = useState(false);
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

  const left = (
    <IconButton icon="＋" label="Add a note or a photo" selected={menu} onPress={() => setMenu((m) => !m)} />
  );
  const counter = usage.data ? (
    <BoxCounter
      text={usageCounterText(usage.data)}
      low={usage.data.low}
      usedUp={usage.data.usedUp}
      onPress={() => router.push('/settings')}
    />
  ) : null;
  const go = (params?: Record<string, string>) => {
    setMenu(false);
    router.push({ pathname: '/new-item', params });
  };
  const asked = lastUserText(chat.state.entries);

  // The top panel: the one box, then what you can do (UI tidy-up, home A2). It stays put while the
  // spaces below scroll.
  const panel = (
    <Panel>
      <WilmaBox
        inputRef={search}
        onPanel
        placeholder="Ask Wilma, or type a name"
        value={mic.listening ? appendDictation(text, mic.partial) : text}
        editable={!mic.listening}
        onChangeText={(t) => {
          setText(t);
          setHeld(null);
          mic.clearError();
          if (!t.trim()) setQuery('');
        }}
        onSend={submit}
        sendDisabled={!chat.canSend || !text.trim() || mic.listening}
        left={left}
        center={counter}
        mic={VOICE_ENABLED ? <MicButton mic={mic} disabled={!chat.canSend} /> : null}
      />
      {mic.listening ? <Muted>Never type or say passwords here. Use the Vault.</Muted> : null}
      {mic.error ? <Muted>{mic.error}</Muted> : null}
      {held ? <Muted>{held}</Muted> : chat.routing ? <Muted>One moment…</Muted> : null}
      {menu ? (
        <GroupList>
          <GroupRow first title="📷 Take a photo" onPress={() => go({ pick: 'camera' })} />
          <GroupRow title="🖼 Choose pictures" onPress={() => go({ pick: 'pictures' })} />
          <GroupRow title="📝 New note" onPress={() => go()} />
        </GroupList>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Tile
          grow={1.6}
          icon="💬"
          title={asked ? 'Continue' : 'Chat'}
          subtitle={asked ?? undefined}
          accessibilityLabel={asked ? 'Continue the conversation' : 'Open the conversation'}
          onPress={() => router.push('/chat')}
        />
        {/* Reads the location only after this tap, on the New note screen (places Q10). */}
        <Tile icon="📍" title="Save here" accessibilityLabel="Save where I am" onPress={() => go({ here: '1' })} />
        <Tile icon="🔒" title="Vault" onPress={() => router.push('/vault')} />
      </View>
    </Panel>
  );

  const spaces = data?.flatMap((r) => (r.kind === 'space' ? [r.space] : [])) ?? [];
  const items = data?.flatMap((r) => (r.kind === 'item' ? [r.item] : [])) ?? [];

  const header = (
    <View style={{ gap: space.m }}>
      {query ? (
        <Text style={[styles.title, { color: c.text }]}>{`Results for “${query}”`}</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.title, { color: c.text }]}>Spaces</Text>
          <TextLink title="+ New space" onPress={() => router.push('/new-space')} />
        </View>
      )}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {!query && spaces.length ? (
        <GroupList>
          {spaces.map((sp, i) =>
            sp.restricted ? (
              // Listed, never opened or searched here (CLAUDE.md rule 3).
              <GroupRow key={sp.id} first={i === 0} dimmed title={`🔒 ${sp.path}`} subtitle="Restricted" />
            ) : (
              <GroupRow
                key={sp.id}
                first={i === 0}
                title={sp.path}
                subtitle={sp.description ?? undefined}
                onPress={() => router.push({ pathname: '/space/[id]', params: { id: sp.id, path: sp.path } })}
              />
            ),
          )}
        </GroupList>
      ) : null}
    </View>
  );

  const empty = loading ? (
    <Loading />
  ) : error || spaces.length ? null : (
    <Muted>{query ? 'Nothing found.' : 'No spaces yet. Tap “+ New space” to create one.'}</Muted>
  );

  return (
    <KeyboardScreen>
      <Stack.Screen
        options={{ headerRight: () => <TextLink title="⚙ Settings" onPress={() => router.push('/settings')} /> }}
      />
      {panel}
      <FlatList
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ItemRow item={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reloadAll} />}
      />
    </KeyboardScreen>
  );
}
