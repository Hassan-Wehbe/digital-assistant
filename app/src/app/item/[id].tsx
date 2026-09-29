// One item in full: text, tags, attachments (with a download button) and linked items.
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button, Card, ErrorBox, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fileSize, type Attachment } from '@/lib/wilma';

export default function ItemScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { wilma } = useAuth();
  const { data: item, error, loading, reload } = useLoad(`item:${id}`, () => wilma.getItem(id));

  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 16 }}>
        {error ? <ErrorBox message={error} onRetry={reload} /> : <Loading />}
      </View>
    );
  }

  const meta = [item.space.path ?? item.space.name, item.item_type, ...item.tags.map((t) => `#${t}`)].join(' · ');
  return (
    <>
      <Stack.Screen options={{ title: item.title }} />
      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
        {error ? <ErrorBox message={error} onRetry={reload} /> : null}
        <Card>
          <Text style={[styles.title, { color: c.text, fontSize: 20 }]} selectable>
            {item.title}
          </Text>
          <Muted>{meta}</Muted>
          {item.summary ? (
            <Text style={[styles.body, { color: c.text, fontStyle: 'italic' }]} selectable>
              {item.summary}
            </Text>
          ) : null}
          {item.body_markdown ? (
            <Text style={[styles.body, { color: c.text }]} selectable>
              {item.body_markdown}
            </Text>
          ) : null}
          <Muted>
            Updated {new Date(item.updated_at).toLocaleString()}
            {item.revision_count > 0 ? ` · ${item.revision_count} earlier version(s)` : ''}
          </Muted>
        </Card>

        {item.attachments.length > 0 && (
          <>
            <Text style={[styles.title, { color: c.text }]}>Attachments</Text>
            {item.attachments.map((a) => (
              <AttachmentCard key={a.id} attachment={a} />
            ))}
          </>
        )}

        {item.links.length > 0 && (
          <>
            <Text style={[styles.title, { color: c.text }]}>Linked items</Text>
            {item.links.map((l) => (
              <Link key={`${l.direction}-${l.item_id}`} href={{ pathname: '/item/[id]', params: { id: l.item_id } }} asChild>
                <Pressable accessibilityRole="button">
                  <Card>
                    <Text style={{ color: c.accent, fontSize: 16 }}>{l.title}</Text>
                    <Muted>{linkLabel(l.direction, l.relation)}</Muted>
                  </Card>
                </Pressable>
              </Link>
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

function linkLabel(direction: 'outgoing' | 'incoming', relation: string): string {
  if (relation === 'supersedes') return direction === 'outgoing' ? 'Replaces this older item' : 'Replaced by this newer item';
  return 'Related';
}

function AttachmentCard({ attachment: a }: { attachment: Attachment }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A fresh 10-minute link each time, opened in the phone's browser, which downloads the file.
  // The link is never stored or logged.
  const download = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { download_link } = await wilma.attachmentLink(a.id);
      await Linking.openURL(download_link);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not open the download link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>{a.filename}</Text>
      <Muted>{[a.mime_type, fileSize(a.size_bytes)].filter(Boolean).join(' · ')}</Muted>
      {a.caption ? <Text style={[styles.body, { color: c.text }]}>{a.caption}</Text> : null}
      {a.description ? (
        <Text style={[styles.body, { color: c.text }]} selectable>
          {a.description}
        </Text>
      ) : null}
      {a.extracted_text ? (
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }} numberOfLines={6} selectable>
          {a.extracted_text}
        </Text>
      ) : null}
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
      <Button title={busy ? 'Getting the link…' : 'Download'} kind="plain" onPress={download} disabled={busy} />
    </Card>
  );
}
