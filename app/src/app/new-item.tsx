// Save a new note in a space, optionally with pictures or Visio files (saveNote.ts).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { SpaceChips } from '@/components/SpaceChips';
import { Button, Card, KeyboardScreen, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceUploadDeps } from '@/lib/deviceFiles';
import { saveNote } from '@/lib/saveNote';
import type { PickedFile } from '@/lib/upload';

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
      const target = itemId ? { itemId } : { space, title: title.trim(), body };
      const out = await saveNote(wilma, target, files, deviceUploadDeps, {
        onCreated: (id) => {
          itemId = id;
          setCreatedId(id);
        },
        onStatus: setStatus,
      });
      if (out.failed.length) {
        // Keep only the files that did not make it, to try again on the same note.
        setFiles(files.filter((f) => out.failed.every((line) => !line.startsWith(`${f.name}: `))));
        throw new Error(`Not uploaded: ${out.failed.join('; ')}.`);
      }
      router.replace({ pathname: '/item/[id]', params: { id: out.itemId } });
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
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Space</Text>
        <SpaceChips
          spaces={spaces.data}
          error={spaces.error}
          onRetry={spaces.reload}
          value={space}
          onChange={setSpace}
          disabled={busy || !!createdId}
        />

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
    </KeyboardScreen>
  );
}
