// Edit a space: its name and description (update_space). Whether it is restricted, and where it
// sits, are not changed here. Notes and sub-spaces stay in it.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { Button, ErrorBox, KeyboardScreen, Loading, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { SPACE_DESCRIPTION_MAX, SPACE_NAME_MAX, spaceChanges, spaceName } from '@/lib/spaces';
import type { Space } from '@/lib/wilma';

export default function EditSpace() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { wilma } = useAuth();
  const { data: space, error, reload } = useLoad(`space-info:${id}`, async () => {
    const found = (await wilma.listSpaces()).find((s) => s.id === id);
    if (!found) throw new Error('This space no longer exists.');
    return found;
  });
  if (!space) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 16 }}>
        {error ? <ErrorBox message={error} onRetry={reload} /> : <Loading />}
      </View>
    );
  }
  return <EditSpaceForm space={space} />;
}

/** The fields start from the space as it was loaded. */
function EditSpaceForm({ space }: { space: Space }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [name, setName] = useState(spaceName(space.path));
  const [description, setDescription] = useState(space.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const out = spaceChanges(space, { name, description });
    if ('error' in out) return setError(out.error);
    if (!Object.keys(out.changes).length) return router.back();
    setBusy(true);
    setError(null);
    try {
      const saved = await wilma.updateSpace(space.id, out.changes);
      // Back to the space, under its new name.
      router.dismissTo({ pathname: '/space/[id]', params: { id: space.id, path: saved.path } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/^Not saved: the \w+ looks like it contains/.test(message)
        ? 'This looks like it holds a password or another secret, so it was not saved. Keep it in the Vault instead.'
        : message.replace(/^Could not change the space "[^"]*": /, ''));
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Name</Text>
        <TextInput
          style={input}
          placeholder="Name"
          placeholderTextColor={c.muted}
          maxLength={SPACE_NAME_MAX}
          value={name}
          onChangeText={setName}
          editable={!busy}
        />
        <Text style={[styles.title, { color: c.text }]}>Description</Text>
        <TextInput
          style={[input, { minHeight: 80, textAlignVertical: 'top' }]}
          placeholder="What goes in it (optional)"
          placeholderTextColor={c.muted}
          multiline
          maxLength={SPACE_DESCRIPTION_MAX}
          value={description}
          onChangeText={setDescription}
          editable={!busy}
        />
        <Muted>Notes and spaces inside stay where they are. Passwords and codes belong in the Vault, not here.</Muted>
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
        <Button title="Cancel" kind="plain" onPress={() => router.back()} disabled={busy} />
      </ScrollView>
    </KeyboardScreen>
  );
}
