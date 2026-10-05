// The cards Wilma puts in the conversation. A delete card shows the server's own question and
// button labels as given; nothing is deleted until Delete is tapped, and only what
// lib/chatDeletes.ts allows can run. Deleting a vault entry asks to unlock the vault first, here
// in the card, then carries on with the Delete.
//
// A vault card opens the app's own vault screen when tapped (never by itself, so a reply still
// being written is not interrupted), and never the server's link (lib/chatVault.ts).
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { UnlockCard } from '@/components/UnlockCard';
import { Button, Card, Muted, useColors } from '@/components/ui';
import { CANT_DO, checkDelete, needsVault } from '@/lib/chatDeletes';
import type { Entry } from '@/lib/chatThread';
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

  const box = { alignSelf: 'flex-start' as const, maxWidth: '85%' as const, gap: 10 };
  const title = `“${entry.target.title}”`;

  switch (entry.state) {
    case 'deleted':
      return (
        <Card style={box}>
          <Muted>{`Deleted ${title}`}</Muted>
        </Card>
      );
    case 'cancelled':
      return (
        <Card style={box}>
          <Muted>{`Left ${title} alone`}</Muted>
        </Card>
      );
    case 'not_done':
      return (
        <Card style={box}>
          <Muted>{`Not done: ${title}`}</Muted>
        </Card>
      );
  }

  // A card the app does not accept: nothing can be run from it.
  if (!checkDelete(entry)) {
    return (
      <Card style={box}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{CANT_DO}</Text>
      </Card>
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
    <Card style={box}>
      <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{entry.message}</Text>
      {entry.state === 'failed' && entry.error ? <Text style={{ color: c.danger, fontSize: 15 }}>{entry.error}</Text> : null}
      {unlocking ? <UnlockCard /> : null}
      <Button title={running ? 'Deleting…' : entry.confirmLabel} kind="danger" onPress={tapDelete} disabled={!active || unlocking} />
      <Button title={entry.cancelLabel} kind="plain" onPress={onCancel} disabled={!active} />
    </Card>
  );
}

export function VaultCard({ entry }: { entry: Extract<Entry, { kind: 'vault' }> }) {
  const c = useColors();
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
    <Card style={{ alignSelf: 'flex-start', maxWidth: '85%', gap: 10 }}>
      <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{`🔒 ${text}`}</Text>
      <Button title={button} kind="plain" onPress={open} />
    </Card>
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
    <Card style={{ alignSelf: 'flex-start', maxWidth: '85%', gap: 10 }}>
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
      {active ? <Button title="Ask Wilma instead" kind="plain" onPress={onAskWilma} /> : null}
    </Card>
  );
}
