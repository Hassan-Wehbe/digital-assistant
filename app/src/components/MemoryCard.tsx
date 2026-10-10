// The one-time memory card on Home (memory step 3, Q3): memory is off until each person turns it
// on. Shown while it is off and the card was never closed on this phone; Turn on or Not now
// closes it for good (Settings → Memory stays the place to change it).
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { deviceMemoryCard } from '@/lib/deviceStorage';
import { loadMemoryOn, type MemoryDb, saveMemoryOn, showMemoryCard } from '@/lib/memory';
import { supabase } from '@/lib/supabase';
import { Button, Card, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from './ui';

export function MemoryCard() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [closedNow, setClosedNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const state = useLoad(`memory-card:${userId ?? ''}`, async () => {
    if (!userId) return false;
    const [on, closed] = await Promise.all([
      loadMemoryOn(supabase as unknown as MemoryDb, userId),
      deviceMemoryCard.closed(userId).catch(() => false),
    ]);
    return showMemoryCard(on, closed);
  });
  // Turned on in Settings meanwhile: gone when Home shows again.
  useReloadOnReturn(state.reload);
  const show = !!state.data && !closedNow;

  if (!show || !userId) return null;
  const close = () => {
    setClosedNow(true);
    void deviceMemoryCard.close(userId).catch(() => {});
  };
  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    if (await saveMemoryOn(supabase as unknown as MemoryDb, userId, true)) return close();
    setBusy(false);
    setNote("That wasn't saved. Check your connection and try again.");
  };
  return (
    <Card style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>🧠 Let Wilma remember</Text>
      <Muted>When you mention something lasting (Lexi swims on Tuesdays, your plumber is Mike), Wilma can keep it, so you never have to say it twice.</Muted>
      <Muted>You see each one under her reply, with Undo, and all of them in the Memories space. Passwords are never kept, and health or money only when you say “remember”.</Muted>
      {note ? <Text style={{ color: c.danger, fontSize: 15 }}>{note}</Text> : null}
      <View style={{ gap: space.s }}>
        <Button title={busy ? 'Turning on…' : 'Turn on'} onPress={() => void turnOn()} disabled={busy} />
        <Button title="Not now" kind="plain" onPress={close} disabled={busy} />
      </View>
    </Card>
  );
}
