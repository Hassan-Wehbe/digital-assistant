// Settings → Reminders (alarms and reminders, docs/alarms-calendar-plan.md step 2): the reminders
// set from the chat on this phone, for this account, soonest first, each with Cancel. They live
// only in the phone's notification schedule: nothing is kept on Wilma's servers, signing out
// cancels them, and Android may show one a few minutes late while the phone sleeps.
import { useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { Button, Card, ErrorBox, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { cancelReminder, listReminders } from '@/lib/notifications';
import { matchReminders, reminderWhen } from '@/lib/phoneActions';

export default function Reminders() {
  const c = useColors();
  const userId = useAuth().session?.user.id ?? '';
  const list = useLoad(`reminders:${userId}`, async () => matchReminders(await listReminders(deviceNotifier, userId), undefined, new Date()));
  useReloadOnReturn(list.reload);
  const [problem, setProblem] = useState<string | null>(null);

  const page = (children: React.ReactNode) => (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
      {children}
    </ScrollView>
  );
  if (Platform.OS === 'web') return page(<Muted>Reminders work in the Wilma app on your phone.</Muted>);
  if (list.error) return page(<ErrorBox message={list.error} onRetry={list.reload} />);
  if (!list.data) return page(<Muted>Reading your reminders…</Muted>);

  const cancel = async (id: string) => {
    setProblem(null);
    if (await cancelReminder(deviceNotifier, id)) list.reload();
    else setProblem('That reminder could not be cancelled. Try again.');
  };
  const now = new Date();
  return page(
    <>
      {list.data.length ? (
        <Card>
          {list.data.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.text, fontSize: 16 }}>{r.text}</Text>
                <Muted>{reminderWhen(r.at, now)}</Muted>
              </View>
              <Button title="Cancel" kind="plain" onPress={() => void cancel(r.id)} />
            </View>
          ))}
        </Card>
      ) : (
        <Muted>No reminders. Ask Wilma: “remind me at 5 to call Sam”.</Muted>
      )}
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
      <Muted>
        Reminders are Wilma notifications kept only on this phone. Signing out cancels them. Android may show one a few minutes late
        while the phone sleeps; use an alarm when the minute matters.
      </Muted>
    </>,
  );
}
