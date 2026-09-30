// Save a new note in a space, optionally with pictures or Visio files.
// Without files: save_item. With files: attach_file creates the note and gives an
// upload link in one step, then the files go up (upload.ts).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { Button, Card, ErrorBox, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceUploadDeps } from '@/lib/deviceFiles';
import { uploadToLink, type PickedFile } from '@/lib/upload';

export default function NewItem() {
  const c = useColors();
  const { wilma } = useAuth();
  const params = useLocalSearchParams<{ space?: string }>();
  const spaces = useLoad('spaces', () => wilma.listSpaces());
  const [space, setSpace] = useState<string | undefined>(params.space);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the note exists, so a retry after a failed upload does not create a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const save = async () => {
    if (!space) return setError('Choose a space.');
    if (!title.trim()) return setError('Give the note a title.');
    setBusy(true);
    setError(null);
    let itemId = createdId;
    try {
      if (!files.length) {
        if (!itemId) itemId = (await wilma.saveItem({ space, title: title.trim(), body })).id;
      } else {
        setStatus('Getting an upload link…');
        const link = await wilma.uploadLink(itemId ? { item_id: itemId } : { space, title: title.trim(), note: body });
        itemId = link.item.id;
        setCreatedId(itemId);
        await uploadToLink(link.upload_link, files, deviceUploadDeps, setStatus);
      }
      router.replace({ pathname: '/item/[id]', params: { id: itemId! } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(itemId ? `${message} The note is saved; press Save to try the files again, or open it.` : message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Space</Text>
        {spaces.error ? <ErrorBox message={spaces.error} onRetry={spaces.reload} /> : null}
        {!spaces.data && !spaces.error ? <Loading /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(spaces.data ?? []).map((s) => {
            const on = s.id === space;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                disabled={busy || !!createdId}
                onPress={() => setSpace(s.id)}
                style={{
                  borderWidth: 1,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderColor: on ? c.accent : c.line,
                  backgroundColor: on ? c.accent : c.card,
                }}>
                <Text style={{ color: on ? '#ffffff' : c.text }}>{(s.restricted ? '🔒 ' : '') + s.path}</Text>
              </Pressable>
            );
          })}
        </View>
        {spaces.data?.length === 0 ? <Muted>No spaces yet. Ask Wilma in the Claude app to create one.</Muted> : null}

        <TextInput
          style={input}
          placeholder="Title"
          placeholderTextColor={c.muted}
          maxLength={300}
          value={title}
          onChangeText={setTitle}
          editable={!busy && !createdId}
        />
        <TextInput
          style={[input, { minHeight: 140, textAlignVertical: 'top' }]}
          placeholder="Note (optional)"
          placeholderTextColor={c.muted}
          multiline
          maxLength={40000}
          value={body}
          onChangeText={setBody}
          editable={!busy && !createdId}
        />
        <Muted>Passwords and other secrets belong in the vault, not in notes.</Muted>

        <Text style={[styles.title, { color: c.text }]}>Photos and files (optional)</Text>
        <AttachmentPicker files={files} onChange={setFiles} disabled={busy} />

        {error ? (
          <Card>
            <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text>
            {createdId ? (
              <Button
                title="Open the note"
                kind="plain"
                onPress={() => router.replace({ pathname: '/item/[id]', params: { id: createdId } })}
              />
            ) : null}
          </Card>
        ) : null}
        {status ? <Muted>{status}</Muted> : null}
        <Button title={busy ? 'Saving…' : files.length ? `Save with ${files.length} file${files.length > 1 ? 's' : ''}` : 'Save'} onPress={save} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
