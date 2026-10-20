// 🌅 Your morning (from Home's Plan with Wilma row since recipes step 6; owner, 2026-10-20): this
// morning's summary as Home made it at the briefing time (components/useMorning.ts), Open My day,
// Make it again (since a pull on Home no longer does), Show it again when it was made earlier and
// is no longer in memory, or Make it now before the briefing time. With the briefing off, a way to
// Settings → Morning briefing. Pro: Free accounts see the Pro card. Making it is one plan, as My day.
import { router, Stack } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { ProCard, useProPlan } from '@/components/ProCard';
import { Button, Card, Muted, space, styles, useColors } from '@/components/ui';
import { useMorning } from '@/components/useMorning';
import { needsPro } from '@/lib/pro';

export default function Morning() {
  const c = useColors();
  const pro = useProPlan();
  const { shown, check } = useMorning({ auto: false });

  if (pro !== undefined && needsPro(pro)) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: space.l }}>
        <Stack.Screen options={{ title: 'Your morning' }} />
        <ProCard onNotNow={() => router.back()} />
      </View>
    );
  }

  const body = { color: c.text, fontSize: 15, lineHeight: 21 };
  return (
    <>
      <Stack.Screen options={{ title: 'Your morning' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.m }]}>
        <Card style={{ gap: space.s }}>
          <Text style={[styles.title, { color: c.text }]}>🌅 Your morning</Text>
          {shown.step === 'none' || shown.step === 'making' ? <Muted>{shown.step === 'making' ? 'Making your morning…' : 'One moment…'}</Muted> : null}
          {shown.step === 'summary' ? <Text style={body}>{shown.summary}</Text> : null}
          {shown.step === 'made_earlier' ? <Muted>Made earlier today.</Muted> : null}
          {shown.step === 'early' ? <Muted>Not made yet today. Wilma makes it the first time you open her after your briefing time.</Muted> : null}
          {shown.step === 'off' ? <Muted>The morning briefing is off. Turn it on to get what’s on, when to leave and rain each morning.</Muted> : null}
          {shown.step === 'problem' ? <Muted>{shown.text}</Muted> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s, flexWrap: 'wrap' }}>
            {shown.step === 'off' ? <Button title="Morning briefing ›" onPress={() => router.push('/briefing')} /> : null}
            {shown.step === 'early' ? <Button title="Make it now" kind="plain" onPress={() => void check({ now: true })} /> : null}
            {shown.step === 'summary' || shown.step === 'made_earlier' || shown.step === 'problem' ? (
              <Button
                title={shown.step === 'problem' ? 'Try again' : shown.step === 'summary' ? 'Make it again' : 'Show it again'}
                kind="plain"
                onPress={() => void check({ again: true })}
              />
            ) : null}
            {shown.step === 'summary' || shown.step === 'made_earlier' ? <Button title="Open My day ›" onPress={() => router.push('/day')} /> : null}
          </View>
        </Card>
        {shown.step === 'summary' || shown.step === 'early' ? <Muted>Change the time or turn it off in Settings → Morning briefing.</Muted> : null}
      </ScrollView>
    </>
  );
}
