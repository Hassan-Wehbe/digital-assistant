// Home: the one box (docs/phase5-a5d-one-box-plan.md): a space's or a secret's name is answered
// here with no model call, anything else goes to Wilma. When Wilma can't answer (allowance used
// up, or the chat's Search button), the old note search runs on the text instead, never the model
// (restricted spaces are never searched); below, the spaces opened most recently on this phone and
// "See all spaces" (homeSpaces.ts; the Tasks space is reached by the ✅ Tasks tile).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { MicButton } from '@/components/MicButton';
import { PasswordHold } from '@/components/PasswordHold';
import { useProPlan } from '@/components/ProCard';
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
import { deviceRecentSpaces } from '@/lib/deviceStorage';
import { homeSpaces } from '@/lib/homeSpaces';
import { useOpenSpace } from '@/lib/openSpace';
import { useAuth } from '@/lib/auth';
import { useChat } from '@/lib/chat';
import { lastUserText } from '@/lib/chatThread';
import { VOICE_ENABLED } from '@/lib/config';
import { findCredential } from '@/lib/credentials';
import { needsPro } from '@/lib/pro';
import { supabase } from '@/lib/supabase';
import { loadAllowance, usageCounterText, usageSummary } from '@/lib/usage';
import { appendDictation, useDictation } from '@/lib/voice';
import type { SearchResult, Space } from '@/lib/wilma';

type Row = { kind: 'space'; space: Space } | { kind: 'item'; item: SearchResult };

export default function Home() {
  const c = useColors();
  const { wilma, session } = useAuth();
  const chat = useChat();
  // 🌅 My day is Pro: without it the tile shows the badge and opens the Pro card.
  const pro = useProPlan();
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

  // The spaces opened most recently on this phone (ids only), read again on return.
  const openSpace = useOpenSpace();
  const recent = useLoad(`recent:${session?.user.id ?? ''}`, async () => (session ? deviceRecentSpaces.load(session.user.id) : []));
  useReloadOnReturn(recent.reload);

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
  // Text that looks like a password is held on the phone: it never goes to Wilma, the name
  // lookup or the note search (plan step 4; CLAUDE.md rules 1 and 9).
  const credential = useMemo(() => findCredential(text), [text]);

  const submit = async () => {
    if (!chat.canSend || !text.trim() || mic.listening || credential) return;
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
    if (out.to === 'space') openSpace({ id: out.id, path: out.path });
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
        sendDisabled={!chat.canSend || !text.trim() || mic.listening || !!credential}
        warn={!!credential}
        left={left}
        center={counter}
        mic={VOICE_ENABLED ? <MicButton mic={mic} disabled={!chat.canSend} /> : null}
      />
      {credential ? <PasswordHold kind={credential} onEdit={() => search.current?.focus()} /> : null}
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
          grow={1.3}
          icon="💬"
          title={asked ? 'Continue' : 'Chat'}
          subtitle={asked ?? undefined}
          accessibilityLabel={asked ? 'Continue the conversation' : 'Open the conversation'}
          onPress={() => router.push('/chat')}
        />
        {/* Reads the location only after this tap, on the New note screen (places Q10). */}
        <Tile icon="📍" title="Save here" accessibilityLabel="Save where I am" onPress={() => go({ here: '1' })} />
        <Tile icon="🔒" title="Vault" onPress={() => router.push('/vault')} />
        <Tile icon="✅" title="Tasks" onPress={() => router.push('/tasks')} />
        {/* Opens the timeline straight away: no typing and no AI request (day planner step 4). */}
        <Tile
          icon="🌅"
          title="My day"
          badge={needsPro(pro) ? 'PRO' : undefined}
          accessibilityLabel={needsPro(pro) ? 'My day, part of Pro' : 'My day'}
          onPress={() => router.push(needsPro(pro) ? '/pro' : '/day')}
        />
      </View>
    </Panel>
  );

  const spaces = data?.flatMap((r) => (r.kind === 'space' ? [r.space] : [])) ?? [];
  const home = homeSpaces(spaces, recent.data ?? []);
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
      {!query && home.shown.length ? (
        <GroupList>
          {home.shown.map((sp, i) => (
            <GroupRow key={sp.id} first={i === 0} title={sp.path} subtitle={sp.description ?? undefined} onPress={() => openSpace(sp)} />
          ))}
        </GroupList>
      ) : null}
      {!query && home.more > 0 ? <TextLink title={`See all spaces (${home.total}) ›`} onPress={() => router.push('/spaces')} /> : null}
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
