// Ask Wilma: the conversation screen. The thread and the running answer live in ChatProvider
// (lib/chat.tsx), so this screen only draws them.
import { router, Stack } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { ChatBubble } from '@/components/ChatBubble';
import { MicButton } from '@/components/MicButton';
import { PasswordHold } from '@/components/PasswordHold';
import { Button, confirm, KeyboardScreen, Loading, Muted, styles, useColors } from '@/components/ui';
import { useChat } from '@/lib/chat';
import { PIN_ON, pinPoint, tapPin, type PinState } from '@/lib/chatHere';
import { cardActive, type Entry, type ErrorButton, lastUserText, notesActive } from '@/lib/chatThread';
import { VOICE_ENABLED } from '@/lib/config';
import { findCredential } from '@/lib/credentials';
import { deviceLocation } from '@/lib/location';
import { appendDictation, useDictation } from '@/lib/voice';

export default function Chat() {
  const c = useColors();
  const { state, ready, canSend, routing, bannerVisible, send, askWilma, stop, retry, dismissBanner, clear, confirmDelete, cancelDelete } = useChat();
  const [text, setText] = useState('');
  const list = useRef<FlatList>(null);
  const box = useRef<TextInput>(null);
  // 📍 "near me" (places step 7): the location for the next message only, read on the tap.
  const [pin, setPin] = useState<PinState>(null);
  const [locating, setLocating] = useState(false);
  const onPin = async () => {
    if (locating) return;
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

  const last = state.entries[state.entries.length - 1];
  const input = [styles.input, { color: c.text, borderColor: credential ? c.warn : c.line, backgroundColor: c.card, flex: 1, maxHeight: 140 }];

  return (
    <KeyboardScreen>
      <Stack.Screen
        options={{
          title: 'Ask Wilma',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              onPress={newConversation}
              disabled={!state.entries.length && !state.streaming}
              hitSlop={8}>
              <Text style={{ color: c.accent, fontSize: 16 }}>New</Text>
            </Pressable>
          ),
        }}
      />

      {bannerVisible ? (
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

      <View style={{ padding: 12, gap: 6, borderTopColor: c.line, borderTopWidth: 1 }}>
        {credential ? <PasswordHold kind={credential} onEdit={() => box.current?.focus()} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextInput
            ref={box}
            style={input}
            placeholder="Message Wilma"
            placeholderTextColor={c.muted}
            value={mic.listening ? appendDictation(text, mic.partial) : text}
            editable={!mic.listening}
            onChangeText={(t) => {
              setText(t);
              mic.clearError();
            }}
            multiline
            maxLength={20000}
          />
          {state.streaming ? (
            <Button title="Stop" kind="plain" onPress={stop} />
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={pinPoint(pin) ? 'Remove your location' : 'Send your location with the next message'}
                accessibilityState={{ selected: !!pinPoint(pin), busy: locating, disabled: !canSend || locating }}
                onPress={onPin}
                disabled={!canSend || locating}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.button,
                  { paddingHorizontal: 12 },
                  pinPoint(pin) ? { backgroundColor: c.accent } : { borderColor: c.line, borderWidth: 1 },
                  (pressed || !canSend || locating) && { opacity: 0.6 },
                ]}>
                <Text style={styles.buttonText}>📍</Text>
              </Pressable>
              {VOICE_ENABLED ? <MicButton mic={mic} disabled={!canSend} /> : null}
              <Button title="Send" onPress={submit} disabled={!canSend || !text.trim() || mic.listening || locating || !!credential} />
            </>
          )}
        </View>
        {mic.error ? <Muted>{mic.error}</Muted> : null}
        {locating ? <Muted>Finding where you are…</Muted> : pin && 'error' in pin ? <Muted>{pin.error}</Muted> : pinPoint(pin) ? <Muted>{PIN_ON}</Muted> : null}
        {/* Used up: names of spaces and secrets still work; anything else waits for next month. */}
        {state.blocked ? <Muted>{state.blocked}</Muted> : null}
        <Muted>Never type or say passwords here. Use the Vault.</Muted>
      </View>
    </KeyboardScreen>
  );
}
