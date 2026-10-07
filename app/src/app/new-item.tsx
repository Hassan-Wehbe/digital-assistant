// Save a new note in a space, optionally with pictures or Visio files (saveNote.ts). Choosing
// Place adds an address, a Google Maps link, the kind and so on (places.ts).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { Chips, PlaceFields } from '@/components/PlaceFields';
import { SpaceChips } from '@/components/SpaceChips';
import { Button, Card, KeyboardScreen, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceUploadDeps } from '@/lib/deviceFiles';
import { EMPTY_PLACE, placeMetadata, type PlaceForm } from '@/lib/places';
import { saveNote } from '@/lib/saveNote';
import type { PickedFile } from '@/lib/upload';

const KINDS_OF_NOTE = [
  { value: false, label: 'Note' },
  { value: true, label: '📍 Place' },
];

export default function NewItem() {
  const c = useColors();
  const { wilma } = useAuth();
  // here=1: the home screen's Save where I am (a place that starts by reading the location).
  // pick=camera|pictures: home's ＋ menu, which opens the camera or the picture picker at once.
  const params = useLocalSearchParams<{ space?: string; here?: string; pick?: string }>();
  const pick = params.pick === 'camera' || params.pick === 'pictures' ? params.pick : undefined;
  const spaces = useLoad('spaces', () => wilma.listSpaces());
  const [space, setSpace] = useState<string | undefined>(params.space);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPlace, setIsPlace] = useState(params.here === '1');
  const [place, setPlace] = useState<PlaceForm>(EMPTY_PLACE);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the note exists, so a retry after a failed upload does not create a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const save = async () => {
    if (!space) return setError('Choose a space.');
    if (!title.trim()) return setError(isPlace ? 'Give the place a name.' : 'Give the note a title.');
    const fields = isPlace && !createdId ? placeMetadata(place) : null;
    if (fields && 'error' in fields) return setError(fields.error);
    setBusy(true);
    setError(null);
    let itemId = createdId;
    try {
      const target = itemId ? { itemId } : { space, title: title.trim(), body, ...(fields ? { place: fields.metadata } : {}) };
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

        <Chips
          options={KINDS_OF_NOTE}
          selected={(v) => v === isPlace}
          onPress={setIsPlace}
          disabled={busy || !!createdId}
        />
        <TextInput
          style={input}
          placeholder={isPlace ? 'Name of the place' : 'Title'}
          placeholderTextColor={c.muted}
          maxLength={300}
          value={title}
          onChangeText={setTitle}
          editable={!busy && !createdId}
        />
        {isPlace ? (
          <PlaceFields value={place} onChange={setPlace} disabled={busy || !!createdId} locateNow={params.here === '1'} />
        ) : null}
        <TextInput
          style={[input, { minHeight: 140, textAlignVertical: 'top' }]}
          placeholder={isPlace ? 'Note (optional), e.g. try the fattoush' : 'Note (optional)'}
          placeholderTextColor={c.muted}
          multiline
          maxLength={40000}
          value={body}
          onChangeText={setBody}
          editable={!busy && !createdId}
        />
        <Muted>Passwords and other secrets belong in the vault, not in notes.</Muted>

        <Text style={[styles.title, { color: c.text }]}>Photos and files (optional)</Text>
        <AttachmentPicker files={files} onChange={setFiles} disabled={busy} start={pick} />

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
