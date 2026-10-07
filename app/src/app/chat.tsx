// Ask Wilma: the conversation screen. The thread and the running answer live in ChatProvider
// (lib/chat.tsx), so this screen only draws them. The box at the bottom is the Wilma box, as on
// home (docs/ui-review.md, plan step 5): ＋ (📍 "Send where I am", a photo, pictures, a new note),
// the usage counter, 🎤 and ↑ (■ while Wilma writes), with one status chip above it.
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { ChatBubble } from '@/components/ChatBubble';
import { MicButton } from '@/components/MicButton';
import { PasswordHold } from '@/components/PasswordHold';
import { confirm, GroupList, GroupRow, IconButton, KeyboardScreen, Loading, Muted, space, styles, useColors, useLoad } from '@/components/ui';
import { BoxCounter, WilmaBox } from '@/components/WilmaBox';
import { useAuth } from '@/lib/auth';
import { useChat } from '@/lib/chat';
import { chatChip, pinPoint, tapPin, type PinState } from '@/lib/chatHere';
import { cardActive, type Entry, type ErrorButton, lastUserText, notesActive } from '@/lib/chatThread';
import { VOICE_ENABLED } from '@/lib/config';
import { findCredential } from '@/lib/credentials';
import { deviceLocation } from '@/lib/location';
import { supabase } from '@/lib/supabase';
import { loadAllowance, usageCounterText, usageSummary } from '@/lib/usage';
import { appendDictation, useDictation } from '@/lib/voice';

export default function Chat() {
  const c = useColors();
  const { session } = useAuth();
  const { state, ready, canSend, routing, bannerVisible, send, askWilma, stop, retry, dismissBanner, clear, confirmDelete, cancelDelete } = useChat();
  const [text, setText] = useState('');
  const list = useRef<FlatList>(null);
  const box = useRef<TextInput>(null);
  // The ＋ menu above the box.
  const [menu, setMenu] = useState(false);
  // 📍 "near me" (places step 7): the location for the next message only, read on the tap.
  const [pin, setPin] = useState<PinState>(null);
  const [locating, setLocating] = useState(false);
  const onPin = async () => {
    setMenu(false);
    if (locating || !canSend) return;
    setLocating(true);
    try {
      setPin(await tapPin(pin, deviceLocation));
    } finally {
      setLocating(false);
    }
  };
  // Dictated words are added to the box; only Send sends them (A5e Q1). No mic while a reply streams.
  const mic = useDictation((words) => setText((t) => appendDictation(t, words)), canSend && !state.streaming);
  // Text that looks like a password is held on the phone and never sent (plan step 4).
  const credential = useMemo(() => findCredential(text), [text]);

  // This month's allowance (D28), read again after each answer.
  const usage = useLoad(`usage:${session?.user.id ?? ''}`, async () => {
    const a = await loadAllowance((fn) => supabase.rpc(fn));
    return a ? usageSummary(a) : null;
  });
  const reloadUsage = usage.reload;
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !state.streaming) reloadUsage();
    wasStreaming.current = state.streaming;
  }, [state.streaming, reloadUsage]);

  const submit = async () => {
    if (!canSend || !text.trim() || mic.listening || locating || credential) return;
    const out = await send(text, pinPoint(pin));
    // Used up or not sent: the text (and the 📍) stays.
    if (out.to === 'none' || out.to === 'blocked') return;
    setText('');
    setPin(null);
    if (out.to === 'space') router.push({ pathname: '/space/[id]', params: { id: out.id, path: out.path } });
  };

  const onButton = (button: ErrorButton) => {
    if (button === 'try_again') retry();
    else if (button === 'vault') router.push('/vault');
    // Search: the note search (no model) on the last question, on the home screen.
    else router.dismissTo({ pathname: '/', params: { focus: 'search', q: lastUserText(state.entries) ?? '' } });
  };

  // "Ask Wilma instead": the message just before the card goes to Wilma, past the router.
  const onAskWilma = (card: Entry) => {
    const at = state.entries.findIndex((e) => e.id === card.id);
    const asked = state.entries.slice(0, at).findLast((e) => e.kind === 'user');
    if (asked?.kind === 'user') askWilma(asked.text);
  };

  const newConversation = async () => {
    if (await confirm('Clear this conversation?', 'Your notes are not affected.', 'Clear')) clear();
  };

  const go = (params?: Record<string, string>) => {
    setMenu(false);
    router.push({ pathname: '/new-item', params });
  };

  const last = state.entries[state.entries.length - 1];
  const chip = chatChip({ blocked: state.blocked, locating, pin, micError: mic.error });
  const clearChip = () => {
    if (chip?.clears === 'pin') setPin(null);
    else if (chip?.clears === 'mic') mic.clearError();
  };

  return (
    <KeyboardScreen>
      <Stack.Screen
        options={{
          title: 'Ask Wilma',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New chat"
              onPress={newConversation}
              disabled={!state.entries.length && !state.streaming}
              hitSlop={8}>
              <Text style={{ color: c.accent, fontSize: 16 }}>New chat</Text>
            </Pressable>
          ),
        }}
      />

      {/* The allowance shows in one place at a time: used up is the chip, so no banner then. */}
      {bannerVisible && !state.blocked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: c.card, borderBottomColor: c.line, borderBottomWidth: 1 }}>
          <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{state.notice}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismissBanner} hitSlop={12}>
            <Text style={{ color: c.muted, fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {ready ? (
        <FlatList
          ref={list}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          data={state.entries}
          extraData={state.streaming}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <ChatBubble
              entry={item}
              onButton={onButton}
              buttonsEnabled={item === last && !state.streaming}
              cardActive={cardActive(state, item)}
              onConfirm={confirmDelete}
              onCancel={cancelDelete}
              notesActive={notesActive(state, item) && canSend}
              onAskWilma={onAskWilma}
            />
          )}
          ListEmptyComponent={<Muted>Ask about your notes, save something new, or find a password in your vault.</Muted>}
          ListFooterComponent={state.status ? <Muted>{state.status}</Muted> : routing ? <Muted>One moment…</Muted> : null}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <Loading />
      )}

      <View style={{ padding: space.m, gap: space.s, borderTopColor: c.line, borderTopWidth: 1, backgroundColor: c.card }}>
        {chip ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              alignSelf: 'flex-start',
              borderRadius: 16,
              borderWidth: 1,
              borderColor: chip.tone === 'danger' ? c.danger : chip.tone === 'warn' ? c.warn : c.line,
              paddingVertical: space.xs,
              paddingLeft: space.m,
              paddingRight: chip.clears ? space.xs : space.m,
            }}>
            <Text style={{ color: chip.tone === 'danger' ? c.danger : chip.tone === 'warn' ? c.warn : c.muted, fontSize: 13, flexShrink: 1 }}>
              {chip.text}
            </Text>
            {chip.clears ? (
              <IconButton
                icon="✕"
                kind="plain"
                label={chip.clears === 'pin' ? 'Remove your location' : 'Dismiss'}
                onPress={clearChip}
              />
            ) : null}
          </View>
        ) : null}
        {mic.listening ? <Muted>Never type or say passwords here. Use the Vault.</Muted> : null}
        {credential ? <PasswordHold kind={credential} onEdit={() => box.current?.focus()} /> : null}
        {menu ? (
          <GroupList>
            <GroupRow
              first
              title={pinPoint(pin) ? '📍 Don’t send where I am' : '📍 Send where I am'}
              subtitle={pinPoint(pin) ? undefined : 'With your next message, to find saved places near you'}
              onPress={onPin}
            />
            <GroupRow title="📷 Take a photo" onPress={() => go({ pick: 'camera' })} />
            <GroupRow title="🖼 Choose pictures" onPress={() => go({ pick: 'pictures' })} />
            <GroupRow title="📝 New note" onPress={() => go()} />
          </GroupList>
        ) : null}
        <WilmaBox
          inputRef={box}
          placeholder="Message Wilma"
          minLines={2}
          value={mic.listening ? appendDictation(text, mic.partial) : text}
          editable={!mic.listening}
          onChangeText={(t) => {
            setText(t);
            mic.clearError();
          }}
          onSend={submit}
          sendDisabled={!canSend || !text.trim() || mic.listening || locating || !!credential}
          onStop={state.streaming ? stop : undefined}
          warn={!!credential}
          left={
            <IconButton
              icon="＋"
              label="More: send where I am, a photo or a note"
              selected={menu || !!pinPoint(pin)}
              busy={locating}
              onPress={() => setMenu((m) => !m)}
            />
          }
          center={
            usage.data ? (
              <BoxCounter
                text={usageCounterText(usage.data)}
                low={usage.data.low}
                usedUp={usage.data.usedUp}
                onPress={() => router.push('/settings')}
              />
            ) : null
          }
          mic={VOICE_ENABLED ? <MicButton mic={mic} disabled={!canSend} /> : null}
        />
      </View>
    </KeyboardScreen>
  );
}
