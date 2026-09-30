// Share -> Wilma: save what another app shared (photos, Visio files, text or a link) as a
// new note, or add the files to an existing note. Same checks and upload as "New note"
// (picked.ts, saveNote.ts); the shared files are copied into the app's cache first.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { SpaceChips } from '@/components/SpaceChips';
import { Button, Card, ErrorBox, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceUploadDeps, prepareShared, removeCopies } from '@/lib/deviceFiles';
import { saveNote, type SaveTarget } from '@/lib/saveNote';
import { draftFromShared, TITLE_MAX, type Shared } from '@/lib/shared';
import { useShare } from '@/lib/shareIntake';
import type { PickedFile } from '@/lib/upload';

export default function ShareScreen() {
  const c = useColors();
  const { pending, error, clear } = useShare();
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
    clear();
  };
  if (!pending) {
    return (
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list}>
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : <Muted>Nothing shared is waiting to be saved.</Muted>}
        <Button title="Home" kind="plain" onPress={leave} />
      </ScrollView>
    );
  }
  // A new share replaces the form (and its files) entirely.
  return <ShareForm key={pending.id} shared={pending.shared} onDone={clear} onCancel={leave} />;
}

type Mode = 'new' | 'existing';

function ShareForm({ shared, onDone, onCancel }: { shared: Shared; onDone: () => void; onCancel: () => void }) {
  const c = useColors();
  const { wilma } = useAuth();
  const draft = draftFromShared(shared);
  const spaces = useLoad('spaces', () => wilma.listSpaces());
  const [mode, setMode] = useState<Mode>('new');
  const [space, setSpace] = useState<string | undefined>();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [preparing, setPreparing] = useState(shared.files.length > 0);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once a new note exists, so a retry after a failed upload does not create a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const copies = useRef<string[]>([]);

  // Copy and check the shared files once; delete the copies when the screen closes.
  useEffect(() => {
    let current = true;
    if (shared.files.length) {
      prepareShared(shared.files).then(
        (out) => {
          copies.current = out.cleanup;
          if (!current) return removeCopies(out.cleanup);
          setFiles(out.files);
          setProblems(out.errors);
          setPreparing(false);
        },
        (e: unknown) => {
          if (!current) return;
          setProblems([e instanceof Error ? e.message : String(e)]);
          setPreparing(false);
        },
      );
    }
    return () => {
      current = false;
      removeCopies(copies.current);
    };
  }, [shared]);

  const hasText = !!shared.text;
  const canAddToNote = shared.files.length > 0;

  const save = async () => {
    setError(null);
    let target: SaveTarget;
    if (createdId) target = { itemId: createdId };
    else if (mode === 'existing') {
      if (!noteId) return setError('Choose the note to add the files to.');
      if (!files.length) return setError('None of the shared files can be added.');
      target = { itemId: noteId };
    } else {
      if (!space) return setError('Choose a space.');
      if (!title.trim()) return setError('Give the note a title.');
      target = { space, title: title.trim(), body };
    }
    setBusy(true);
    let savedId = createdId;
    try {
      const out = await saveNote(wilma, target, files, deviceUploadDeps, {
        onCreated: (id) => {
          if (mode === 'new') {
            savedId = id;
            setCreatedId(id);
          }
        },
        onStatus: setStatus,
      });
      if (out.failed.length) {
        setFiles(files.filter((f) => out.failed.every((line) => !line.startsWith(`${f.name}: `))));
        throw new Error(`Not uploaded: ${out.failed.join('; ')}.`);
      }
      router.replace({ pathname: '/item/[id]', params: { id: out.itemId } });
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(savedId ? `${message} The note is saved; press Save to try the files again, or open it.` : message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const locked = busy || !!createdId;
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {canAddToNote ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ModeButton title="New note" on={mode === 'new'} onPress={() => setMode('new')} disabled={locked} />
            <ModeButton title="Add to a note" on={mode === 'existing'} onPress={() => setMode('existing')} disabled={locked} />
          </View>
        ) : null}

        <Text style={[styles.title, { color: c.text }]}>Space</Text>
        <SpaceChips
          spaces={spaces.data}
          error={spaces.error}
          onRetry={spaces.reload}
          value={space}
          onChange={(id) => {
            setSpace(id);
            setNoteId(null);
          }}
          disabled={locked}
        />

        {mode === 'new' ? (
          <>
            <TextInput
              style={input}
              placeholder="Title"
              placeholderTextColor={c.muted}
              maxLength={TITLE_MAX}
              value={title}
              onChangeText={setTitle}
              editable={!locked}
            />
            <TextInput
              style={[input, { minHeight: 120, textAlignVertical: 'top' }]}
              placeholder="Note (optional)"
              placeholderTextColor={c.muted}
              multiline
              maxLength={40000}
              value={body}
              onChangeText={setBody}
              editable={!locked}
            />
            <Muted>Passwords and other secrets belong in the vault, not in notes.</Muted>
          </>
        ) : space ? (
          <NotePicker space={space} value={noteId} onChange={setNoteId} disabled={busy} />
        ) : (
          <Muted>Choose a space to see its notes.</Muted>
        )}
        {mode === 'existing' && hasText ? <Muted>The shared text is not added to the note; put what matters in a caption.</Muted> : null}

        {shared.files.length ? (
          <>
            <Text style={[styles.title, { color: c.text }]}>Photos and files</Text>
            {preparing ? <Loading /> : <AttachmentPicker files={files} onChange={setFiles} disabled={busy} />}
            {problems.map((p) => (
              <Text key={p} style={{ color: c.danger, fontSize: 15 }}>
                {p}
              </Text>
            ))}
          </>
        ) : null}

        {error ? (
          <Card>
            <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text>
            {createdId ? (
              <Button
                title="Open the note"
                kind="plain"
                onPress={() => {
                  router.replace({ pathname: '/item/[id]', params: { id: createdId } });
                  onDone();
                }}
              />
            ) : null}
          </Card>
        ) : null}
        {status ? <Muted>{status}</Muted> : null}
        <Button
          title={busy ? 'Saving…' : files.length ? `Save with ${files.length} file${files.length > 1 ? 's' : ''}` : 'Save'}
          onPress={save}
          disabled={busy || preparing}
        />
        <Button title="Cancel" kind="plain" onPress={onCancel} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModeButton({ title, on, onPress, disabled }: { title: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Button title={title} kind={on ? 'primary' : 'plain'} onPress={onPress} disabled={disabled} />
    </View>
  );
}

/** The most recently updated notes of a space, to pick one (filter by title). */
function NotePicker({ space, value, onChange, disabled }: { space: string; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const c = useColors();
  const { wilma } = useAuth();
  const notes = useLoad(`space:${space}`, () => wilma.search({ space, limit: 50 }));
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const shown = (notes.data ?? []).filter((n) => !f || n.title.toLowerCase().includes(f));
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
        placeholder="Filter by title"
        placeholderTextColor={c.muted}
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
      />
      {notes.error ? <ErrorBox message={notes.error} onRetry={notes.reload} /> : null}
      {notes.loading && !notes.data ? <Loading /> : null}
      {notes.data && !shown.length ? <Muted>{f ? 'No note with that title.' : 'No notes in this space yet.'}</Muted> : null}
      {shown.map((n) => {
        const on = n.id === value;
        return (
          <Pressable
            key={n.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            disabled={disabled}
            onPress={() => onChange(n.id)}
            style={[styles.card, { borderColor: on ? c.accent : c.line, backgroundColor: c.card, borderWidth: on ? 2 : 1 }]}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {n.title}
            </Text>
            {n.space ? <Muted>{n.space}</Muted> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
