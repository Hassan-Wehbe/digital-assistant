// Help (docs/help-plan.md, design D37, step 1): opened from the "?" in the top bar of Home and Ask
// Wilma, or Settings → Help. The topics list, one line each; a topic shows a few lines and "Try it"
// examples, which open the chat with the words in the box, not sent (Q3). ?topic= opens one topic
// (the chat's 🛟 card, step 3).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { Button, Card, GroupList, GroupRow, Muted, space, styles, TextLink, useColors } from '@/components/ui';
import { helpTopic, helpTopics, type HelpTopic } from '@/lib/help';

/** "Try it": back to the chat (or to it, in place of Help) with the words in the box. */
function tryIt(words: string) {
  router.dismissTo({ pathname: '/chat', params: { draft: words, at: String(Date.now()) } });
}

export default function Help() {
  const c = useColors();
  const params = useLocalSearchParams<{ topic?: string }>();
  const [open, setOpen] = useState<HelpTopic | null>(() => helpTopic(params.topic));

  if (open) {
    return (
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
        <Stack.Screen options={{ title: open.title }} />
        <Card>
          {open.lines.map((l) => (
            <Text key={l} style={[styles.body, { color: c.text }]}>
              {l}
            </Text>
          ))}
        </Card>
        {open.tryIt.length ? (
          <View style={{ gap: space.s }}>
            <Muted>Try it (the words go in the chat box; you send them):</Muted>
            {open.tryIt.map((t) => (
              <Button key={t} title={`“${t.trim()}”`} kind="plain" onPress={() => tryIt(t)} />
            ))}
          </View>
        ) : null}
        {open.more ? <TextLink title={open.more.label} onPress={() => router.push(open.more!.path as never)} /> : null}
        {open.url ? <TextLink title={open.url.label} onPress={() => void Linking.openURL(open.url!.href).catch(() => {})} /> : null}
        <TextLink title="All topics" onPress={() => setOpen(null)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
      <Stack.Screen options={{ title: 'Help' }} />
      <GroupList>
        {helpTopics().map((t, i) => (
          <GroupRow key={t.id} first={i === 0} title={`${t.icon} ${t.title}`} subtitle={t.line} onPress={() => setOpen(t)} />
        ))}
      </GroupList>
      <Muted>Or just ask Wilma: “how do I …?”</Muted>
    </ScrollView>
  );
}
