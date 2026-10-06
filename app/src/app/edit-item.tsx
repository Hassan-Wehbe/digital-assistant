// Edit a note's title and text. Saving keeps the previous version in the note's history (the
// server does that first) and refuses anything that looks like a password (CLAUDE.md rules 7, 9).
// A place's fields are edited here too, and a note can become a place (places.ts).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { PlaceFields } from '@/components/PlaceFields';
import { Button, ErrorBox, KeyboardScreen, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { editError, MAX_BODY, MAX_TITLE, noteChanges } from '@/lib/noteEdit';
import { hasVisits, isPlace, placeForm, placeMetadata, placeOf, samePlace, type PlaceForm } from '@/lib/places';
import type { Item } from '@/lib/wilma';

export default function EditItem() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { wilma } = useAuth();
  const { data: item, error: loadError, reload } = useLoad(`item:${id}`, () => wilma.getItem(id));
  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 16 }}>
        {loadError ? <ErrorBox message={loadError} onRetry={reload} /> : <Loading />}
      </View>
    );
  }
  return <EditForm item={item} />;
}

/** The fields start from the note as it was loaded. */
function EditForm({ item }: { item: Item }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body_markdown ?? '');
  const wasPlace = isPlace(item.item_type);
  const base = placeOf(item);
  const [asPlace, setAsPlace] = useState(wasPlace);
  const [place, setPlace] = useState<PlaceForm>(() => placeForm(base));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const out = noteChanges({ title: item.title, body: item.body_markdown }, { title, body });
    if ('error' in out) return setError(out.error);
    if (asPlace) {
      const fields = placeMetadata(place, base);
      if ('error' in fields) return setError(fields.error);
      if (!wasPlace) out.changes.item_type = 'place';
      if (!wasPlace || !samePlace(fields.metadata, base)) out.changes.metadata = fields.metadata;
    }
    if (!Object.keys(out.changes).length) return router.back();
    setBusy(true);
    setError(null);
    try {
      await wilma.updateItem(item.id, out.changes);
      router.back();
    } catch (e) {
      setError(editError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Title</Text>
        <TextInput
          style={input}
          placeholder="Title"
          placeholderTextColor={c.muted}
          maxLength={MAX_TITLE}
          value={title}
          onChangeText={setTitle}
          editable={!busy}
        />
        {asPlace ? (
          <>
            <Text style={[styles.title, { color: c.text }]}>📍 Place</Text>
            <PlaceFields value={place} onChange={setPlace} disabled={busy} hasVisits={hasVisits(base)} />
            {!wasPlace ? <Button title="Keep it a plain note" kind="plain" onPress={() => setAsPlace(false)} disabled={busy} /> : null}
          </>
        ) : (
          <Button title="📍 Make this a place" kind="plain" onPress={() => setAsPlace(true)} disabled={busy} />
        )}
        <Text style={[styles.title, { color: c.text }]}>Note</Text>
        <TextInput
          style={[input, { minHeight: 200, textAlignVertical: 'top' }]}
          placeholder="Note (optional)"
          placeholderTextColor={c.muted}
          multiline
          maxLength={MAX_BODY}
          value={body}
          onChangeText={setBody}
          editable={!busy}
        />
        <Muted>The previous version is kept in the note’s history. Passwords and other secrets belong in the vault, not in notes.</Muted>
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
        <Button title="Cancel" kind="plain" onPress={() => router.back()} disabled={busy} />
      </ScrollView>
    </KeyboardScreen>
  );
}
