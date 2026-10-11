// Alarm and reminder cards in the chat (docs/alarms-calendar-plan.md step 2, design D31). Nothing
// happens until the user taps (owner: a card to confirm, on everything):
//
//   ⏰ alarm      Set in Clock → the Clock's own set-alarm screen, filled in; then Open Clock
//   ⏰ alarms     Open Clock (alarms are seen, changed and cancelled there; Wilma cannot)
//   🔔 reminder   Set reminder → a Wilma notification at that time; then Cancel
//   🔔 reminders  this phone's matching reminders, each with Cancel (matched here: the model never
//                 sees them)
//
// Reminders are kept only in this phone's notification schedule, for this account; signing out
// cancels them (notifications.ts forgetOtherAccounts).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ChatCard, ChatCardDone, ChatCardText } from '@/components/ChatCard';
import { Button, Muted, TextLink, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Entry } from '@/lib/chatThread';
import { clockAvailable, openAlarms, openSetAlarm } from '@/lib/deviceClock';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { cancelReminder, listReminders, setReminder } from '@/lib/notifications';
import {
  alarmCardText, matchReminders, reminderCardText, reminderNote, reminderProblem, type ReminderRow, reminderWhen,
} from '@/lib/phoneActions';

const NO_CLOCK = 'Your phone’s Clock app didn’t open. Set it there yourself.';
const ANDROID_ONLY = 'Alarms open your phone’s Clock app; that works on Android only.';
const DENIED = 'Wilma isn’t allowed to show notifications. Turn them on in your phone’s Settings → Apps → Wilma → Notifications, then try again.';

export function AlarmCard({ entry }: { entry: Extract<Entry, { kind: 'alarm' }> }) {
  const c = useColors();
  const [state, setState] = useState<'ready' | 'opening' | 'opened' | 'failed'>('ready');
  if (!clockAvailable) return <ChatCardDone icon="⏰" text={ANDROID_ONLY} />;
  const words = alarmCardText(entry, new Date());
  const set = async () => {
    setState('opening');
    setState((await openSetAlarm(entry)) ? 'opened' : 'failed');
  };
  if (state === 'opened') {
    return (
      <ChatCard icon="⏰" actions={<Button title="Open Clock" kind="plain" onPress={() => void openAlarms()} />}>
        <ChatCardText>{`${words.title}: save it in your Clock. To change or cancel it later, open the Clock.`}</ChatCardText>
      </ChatCard>
    );
  }
  return (
    <ChatCard icon="⏰" actions={<Button title={state === 'opening' ? 'Opening the Clock…' : 'Set in Clock'} onPress={() => void set()} disabled={state === 'opening'} />}>
      <ChatCardText>{words.title}</ChatCardText>
      {words.detail ? <Muted>{words.detail}</Muted> : null}
      {state === 'failed' ? <Text style={{ color: c.warn, fontSize: 15 }}>{NO_CLOCK}</Text> : null}
    </ChatCard>
  );
}

export function AlarmsCard() {
  if (!clockAvailable) return <ChatCardDone icon="⏰" text={ANDROID_ONLY} />;
  return (
    <ChatCard icon="⏰" actions={<Button title="Open Clock" onPress={() => void openAlarms()} />}>
      <ChatCardText>Your alarms are in your phone’s Clock app; change or cancel them there.</ChatCardText>
    </ChatCard>
  );
}

export function ReminderCard({ entry }: { entry: Extract<Entry, { kind: 'reminder' }> }) {
  const c = useColors();
  const userId = useAuth().session?.user.id ?? null;
  const note = reminderNote(entry, `c${entry.id}`);
  const [state, setState] = useState<'checking' | 'ready' | 'busy' | 'set' | 'cancelled'>(userId && note ? 'checking' : 'ready');
  const [error, setError] = useState<string | null>(null);

  // Already set from this card (the chat was reopened): show it as set.
  useEffect(() => {
    let live = true;
    if (!userId || !note) return;
    listReminders(deviceNotifier, userId)
      .then((rows) => live && setState(rows.some((r) => r.id === note.id) ? 'set' : 'ready'))
      .catch(() => live && setState('ready'));
    return () => {
      live = false;
    };
  }, [userId, note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = reminderCardText(entry, new Date());
  if (state === 'cancelled') return <ChatCardDone icon="🔔" text={`Cancelled: ${words}`} />;
  if (state === 'set') {
    return (
      <ChatCard icon="🔔" actions={<TextLink title="Cancel reminder" onPress={() => void cancel()} />}>
        <ChatCardText>{`Reminder set: ${words}`}</ChatCardText>
      </ChatCard>
    );
  }
  const problem = reminderProblem(entry, new Date());
  if (problem && state === 'ready') return <ChatCardDone icon="🔔" text={`${words}. ${problem}`} />;

  async function set() {
    if (!userId || !note) return;
    setState('busy');
    setError(null);
    const out = await setReminder(deviceNotifier, userId, note);
    if (out === 'set') setState('set');
    else {
      setState('ready');
      setError(out === 'denied' ? DENIED : 'The reminder could not be set. Try again.');
    }
  }
  async function cancel() {
    if (note && (await cancelReminder(deviceNotifier, note.id))) setState('cancelled');
  }

  return (
    <ChatCard
      icon="🔔"
      actions={<Button title={state === 'busy' ? 'Setting…' : 'Set reminder'} onPress={() => void set()} disabled={state !== 'ready' || !userId} />}>
      <ChatCardText>{words}</ChatCardText>
      <Muted>A Wilma notification on this phone at that time.</Muted>
      {error ? <Text style={{ color: c.warn, fontSize: 15 }}>{error}</Text> : null}
    </ChatCard>
  );
}

/** "Cancel my reminder to call Sam" / "what reminders do I have?": this phone's reminders, matched here. */
export function RemindersCard({ entry }: { entry: Extract<Entry, { kind: 'reminders' }> }) {
  const userId = useAuth().session?.user.id ?? null;
  const [rows, setRows] = useState<ReminderRow[] | null>(userId ? null : []);
  const [gone, setGone] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    if (!userId) return;
    listReminders(deviceNotifier, userId)
      .then((all) => live && setRows(matchReminders(all, entry.about, new Date())))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [userId, entry.about]);

  if (rows === null) return <ChatCardDone icon="🔔" text="Looking at your reminders…" />;
  const now = new Date();
  const left = rows.filter((r) => !gone.has(r.id));
  const cancel = async (id: string) => {
    if (await cancelReminder(deviceNotifier, id)) setGone(new Set([...gone, id]));
  };
  return (
    <ChatCard icon="🔔" actions={<TextLink title="All reminders" onPress={() => router.push('/reminders')} />}>
      {!rows.length ? (
        <ChatCardText>{entry.about ? `No reminder about “${entry.about}” on this phone.` : 'No reminders set on this phone.'}</ChatCardText>
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map((r) => (
            <View key={r.id} style={{ gap: 2 }}>
              <ChatCardText>{`${reminderWhen(r.at, now)}: ${r.text}`}</ChatCardText>
              {gone.has(r.id) ? <Muted>Cancelled</Muted> : <TextLink title="Cancel" onPress={() => void cancel(r.id)} />}
            </View>
          ))}
          {!left.length && rows.length ? <Muted>All cancelled.</Muted> : null}
        </View>
      )}
    </ChatCard>
  );
}
