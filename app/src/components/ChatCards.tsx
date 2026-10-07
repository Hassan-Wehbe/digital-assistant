// The cards Wilma puts in the conversation. A delete card shows the server's own question and
// button labels as given; nothing is deleted until Delete is tapped, and only what
// lib/chatDeletes.ts allows can run. Deleting a vault entry asks to unlock the vault first, here
// in the card, then carries on with the Delete.
//
// A vault card opens the app's own vault screen when tapped (never by itself, so a reply still
// being written is not interrupted), and never the server's link (lib/chatVault.ts).
//
// A place card (places step 8) lists the places Wilma's answer names, each with Open in Maps and
// Open note; the "📍 Share where I am" card reads the location only when its button is tapped.
//
// All of them use the one ChatCard shell (plan step 6): Cancel first, one filled main action,
// Delete as red text, finished cards as one dimmed line.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { ChatCard, ChatCardDone, ChatCardText } from '@/components/ChatCard';
import { UnlockCard } from '@/components/UnlockCard';
import { Button, Muted, TextLink, useColors } from '@/components/ui';
import { CANT_DO, checkDelete, needsVault } from '@/lib/chatDeletes';
import { LOCATION_ASK, LOCATION_DONE } from '@/lib/chatHere';
import type { Entry } from '@/lib/chatThread';
import { mapsLink, placeCardDetail } from '@/lib/places';
import { distanceText } from '@/lib/units';
import { vaultCardText, vaultRoute } from '@/lib/chatVault';
import { useVault } from '@/lib/vault';

type ConfirmEntry = Extract<Entry, { kind: 'confirm' }>;

export function DeleteCard({
  entry,
  active,
  onConfirm,
  onCancel,
}: {
  entry: ConfirmEntry;
  /** Delete and Cancel can be tapped (the card waits, and no answer is being written). */
  active: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const vault = useVault();
  // Delete was tapped on a vault entry while the vault was locked: unlock here, then carry on.
  const [askedUnlock, setAskedUnlock] = useState(false);
  const resume = useRef(false);
  const waiting = entry.state === 'pending' || entry.state === 'failed';
  const unlocking = askedUnlock && waiting && vault.status === 'locked';

  // Unlocked from the card: carry on with that Delete, once, if the card still waits for it.
  useEffect(() => {
    if (!resume.current || vault.status !== 'unlocked') return;
    resume.current = false;
    if (active) onConfirm();
  }, [vault.status, active, onConfirm]);

  const title = `“${entry.target.title}”`;

  switch (entry.state) {
    case 'deleted':
      return <ChatCardDone icon="🗑" text={`Deleted ${title}`} />;
    case 'cancelled':
      return <ChatCardDone icon="🗑" text={`Left ${title} alone`} />;
    case 'not_done':
      return <ChatCardDone icon="🗑" text={`Not done: ${title}`} />;
  }

  // A card the app does not accept: nothing can be run from it.
  if (!checkDelete(entry)) {
    return (
      <ChatCard icon="⚠️">
        <ChatCardText>{CANT_DO}</ChatCardText>
      </ChatCard>
    );
  }

  const running = entry.state === 'running';
  const tapDelete = () => {
    if (needsVault(entry) && vault.status === 'locked') {
      resume.current = true;
      setAskedUnlock(true);
    } else onConfirm();
  };

  return (
    <ChatCard
      icon="🗑"
      actions={
        <>
          <Button title={entry.cancelLabel} kind="plain" onPress={onCancel} disabled={!active} />
          <Button title={running ? 'Deleting…' : entry.confirmLabel} kind="danger" onPress={tapDelete} disabled={!active || unlocking} />
        </>
      }>
      <ChatCardText>{entry.message}</ChatCardText>
      {entry.state === 'failed' && entry.error ? <Text style={{ color: c.danger, fontSize: 15 }}>{entry.error}</Text> : null}
      {unlocking ? <UnlockCard /> : null}
    </ChatCard>
  );
}

export function VaultCard({ entry }: { entry: Extract<Entry, { kind: 'vault' }> }) {
  const { text, button } = vaultCardText(entry);
  const open = () => {
    const route = vaultRoute(entry);
    switch (route.screen) {
      case 'secret':
        return router.push({ pathname: '/vault/[id]', params: route.params });
      case 'change':
      case 'new':
        return router.push({ pathname: '/vault/enter', params: route.params });
      case 'list':
        return router.push('/vault');
    }
  };
  return (
    <ChatCard icon="🔒" actions={<Button title={button} onPress={open} />}>
      <ChatCardText>{text}</ChatCardText>
    </ChatCard>
  );
}

/**
 * The notes found for a search the classifier recognised (one-box plan step 6). Each opens the
 * note; "Ask Wilma instead" sends the same message to Wilma, so a wrong guess is never a dead end.
 */
export function NotesCard({
  entry,
  active,
  onAskWilma,
}: {
  entry: Extract<Entry, { kind: 'notes' }>;
  /** "Ask Wilma instead" can be tapped (the card is the newest entry and Wilma can be asked). */
  active: boolean;
  onAskWilma: () => void;
}) {
  const c = useColors();
  return (
    <ChatCard icon="🗒" actions={active ? <Button title="Ask Wilma instead" kind="plain" onPress={onAskWilma} /> : undefined}>
      {entry.notes.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/item/[id]', params: { id: n.id } })}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{n.title}</Text>
            {n.space ? <Muted>{n.space}</Muted> : null}
            {n.snippet ? (
              <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }} numberOfLines={2}>
                {n.snippet}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ChatCard>
  );
}

/** The places Wilma's answer names: name, kind and cuisine, about how far, Open in Maps, Open note. */
export function PlacesCard({ entry }: { entry: Extract<Entry, { kind: 'places' }> }) {
  const c = useColors();
  const [problem, setProblem] = useState<string | null>(null);
  const openMaps = async (link: string) => {
    setProblem(null);
    try {
      await Linking.openURL(link);
    } catch {
      setProblem('Could not open Google Maps on this phone.');
    }
  };
  return (
    <ChatCard icon="📍">
      {entry.cards.map((p) => {
        const detail = placeCardDetail(p);
        const far = p.distance ? distanceText(p.distance.value, p.distance.unit) : '';
        const link = mapsLink({ address: p.address, maps_url: p.maps_url, lat: p.lat, lng: p.lng });
        return (
          <View key={p.id} style={{ gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{p.title}</Text>
            {detail || far ? <Muted>{[detail, far].filter(Boolean).join(' · ')}</Muted> : null}
            {p.address ? <Muted>{p.address}</Muted> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 2 }}>
              {link ? <TextLink title="Open in Maps" accessibilityLabel={`Open ${p.title} in Maps`} onPress={() => void openMaps(link)} /> : null}
              <TextLink
                title="Open note"
                accessibilityLabel={`Open the note for ${p.title}`}
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: p.id } })}
              />
            </View>
          </View>
        );
      })}
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
    </ChatCard>
  );
}

/**
 * Wilma asks where the user is (Q11). Nothing is read until "📍 Share where I am" is tapped; then
 * one reading, and the question goes to Wilma again with it. Not now leaves it.
 */
export function LocationCard({
  entry,
  active,
  onShare,
  onNotNow,
}: {
  entry: Extract<Entry, { kind: 'location' }>;
  /** Its buttons can be tapped (it waits, and a message can go to Wilma now). */
  active: boolean;
  onShare: () => void;
  onNotNow: () => void;
}) {
  const c = useColors();
  if (entry.state === 'shared' || entry.state === 'dismissed' || entry.state === 'not_done') {
    return <ChatCardDone icon="📍" text={LOCATION_DONE[entry.state]} />;
  }
  const locating = entry.state === 'locating';
  return (
    <ChatCard
      icon="📍"
      actions={
        <>
          <Button title="Not now" kind="plain" onPress={onNotNow} disabled={!active} />
          <Button title={locating ? 'Finding where you are…' : '📍 Share where I am'} onPress={onShare} disabled={!active} />
        </>
      }>
      <ChatCardText>{LOCATION_ASK}</ChatCardText>
      {entry.error ? <Text style={{ color: c.warn, fontSize: 15 }}>{entry.error}</Text> : null}
    </ChatCard>
  );
}
