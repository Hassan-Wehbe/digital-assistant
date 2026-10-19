// The chat's 🔁 Save routine card (routines step 4, design D39; lib/chatRoutine.ts): Wilma's
// save_routine shows the routine's name, schedule and tasks. Nothing is saved until the user taps
// Save routine; then it says Saved, with Open to change it in Tasks → Routines. Text that looks
// like a password is never saved (the server refused it already; this is the phone's own check,
// rule 9).
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text } from 'react-native';

import { ChatCard, ChatCardDone, ChatCardText } from '@/components/ChatCard';
import { Button, Muted, TextLink, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { routineCardLine, saveRoutineCard } from '@/lib/chatRoutine';
import type { Entry } from '@/lib/chatThread';
import { findCredential } from '@/lib/credentials';
import { editError } from '@/lib/noteEdit';

type RoutineEntry = Extract<Entry, { kind: 'routine' }>;

export function RoutineCard({ entry, onSaved }: { entry: RoutineEntry; onSaved: (routineId: string) => void }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partly, setPartly] = useState(false);
  // How far a save got, so Try again finishes it instead of saving the routine twice.
  const progress = useRef<{ routineId: string; tasksSaved: number } | null>(null);

  const open = (id: string) => router.push({ pathname: '/routine', params: { id } });

  if (entry.saved) {
    return (
      <ChatCard icon="🔁">
        <Muted>{`Saved “${entry.name}”. Wilma offers its tasks in My day when there’s free time.`}</Muted>
        <TextLink title="Open" onPress={() => open(entry.saved!)} />
      </ChatCard>
    );
  }
  if (findCredential(entry.name) || entry.tasks.some((t) => findCredential(t.title))) return <ChatCardDone icon="🔁" text="Not saved: this routine looks like it holds a password. Passwords belong in the Vault." />;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await saveRoutineCard(wilma, entry, progress.current, (p) => {
        progress.current = p;
        setPartly(true);
      });
      if ('error' in out) setError(out.error);
      else onSaved(out.routineId);
    } catch (e) {
      setError(editError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatCard icon="🔁" actions={<Button title={busy ? 'Saving…' : partly ? 'Try again' : 'Save routine'} disabled={busy} onPress={() => void save()} />}>
      <ChatCardText>{`Save the routine “${entry.name}”`}</ChatCardText>
      <Muted>{routineCardLine(entry)}</Muted>
      {entry.tasks.map((t, i) => (
        <Text key={`${i}-${t.title}`} style={{ color: c.text, fontSize: 15 }}>
          {`☐ ${t.title}${t.minutes ? ` · ${t.minutes} min` : ''}`}
        </Text>
      ))}
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
    </ChatCard>
  );
}
