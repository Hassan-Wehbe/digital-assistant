// One item in full: text, tags, attachments (with a download button) and linked items.
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button, Card, confirm, ErrorBox, Loading, Muted, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fileSize, type Attachment } from '@/lib/wilma';

export default function ItemScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { wilma } = useAuth();
  const { data: item, error, loading, reload } = useLoad(`item:${id}`, () => wilma.getItem(id));

  // Coming back from "Add photos or files": show the new attachments.
  useReloadOnReturn(reload);

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
              <AttachmentCard key={a.id} attachment={a} onDeleted={reload} />
            ))}
          </>
        )}
        <Button
          title="Add photos or files"
          kind="plain"
          onPress={() => router.push({ pathname: '/attach', params: { itemId: item.id, title: item.title } })}
        />
        <DeleteNote id={item.id} title={item.title} />

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

// Moves the note to the recycle bin (restorable from the home screen's Recycle bin).
function DeleteNote({ id, title }: { id: string; title: string }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    const ok = await confirm(
      'Delete this note?',
      `“${title}” moves to the recycle bin, with its files. You can restore it from the Recycle bin on the home screen.`,
      'Delete',
    );
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await wilma.deleteItem(id);
      router.back();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
      <Button title={busy ? 'Deleting…' : 'Delete note'} kind="danger" onPress={remove} disabled={busy} />
    </>
  );
}

function AttachmentCard({ attachment: a, onDeleted }: { attachment: Attachment; onDeleted: () => void }) {
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

  // Files are deleted for good (the note's recycle bin is for whole notes).
  const remove = async () => {
    const ok = await confirm('Delete this file?', `“${a.filename}” will be deleted for good. This cannot be undone.`, 'Delete');
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await wilma.deleteAttachment(a.id);
      onDeleted();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
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
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title={busy ? 'Please wait…' : 'Download'} kind="plain" onPress={download} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Delete file" kind="danger" onPress={remove} disabled={busy} />
        </View>
      </View>
    </Card>
  );
}
