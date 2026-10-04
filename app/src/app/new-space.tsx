// Create a space (create_space), optionally inside another one (param `parent`: its id).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { SpaceChips } from '@/components/SpaceChips';
import { Button, KeyboardScreen, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { newSpace, SPACE_DESCRIPTION_MAX, SPACE_NAME_MAX } from '@/lib/spaces';

export default function NewSpace() {
  const c = useColors();
  const { wilma } = useAuth();
  const params = useLocalSearchParams<{ parent?: string }>();
  // A new space can go inside any space the app can open (restricted ones cannot be opened yet).
  const spaces = useLoad('spaces', async () => (await wilma.listSpaces()).filter((s) => !s.restricted));
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | undefined>(params.parent);
  const [description, setDescription] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await wilma.createSpace(newSpace({ name, parent, description, restricted }));
      if (created.restricted) router.back();
      else router.replace({ pathname: '/space/[id]', params: { id: created.id, path: created.path } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <TextInput
          style={input}
          placeholder="Name, e.g. Recipes"
          placeholderTextColor={c.muted}
          maxLength={SPACE_NAME_MAX}
          value={name}
          onChangeText={setName}
          editable={!busy}
          autoFocus
        />
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

        <Text style={[styles.title, { color: c.text }]}>Inside another space? (optional)</Text>
        <SpaceChips
          spaces={spaces.data}
          error={spaces.error}
          onRetry={spaces.reload}
          value={parent}
          onChange={(id) => setParent((p) => (p === id ? undefined : id))}
          disabled={busy}
        />
        <Muted>{parent ? 'Tap the chosen space again to put it at the top level instead.' : 'None chosen: it goes at the top level.'}</Muted>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Switch value={restricted} onValueChange={setRestricted} disabled={busy} />
          <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>Restricted</Text>
        </View>
        <Muted>
          {restricted
            ? 'A restricted space never appears in any search, and the app cannot open it yet (nor delete it). Only for things that must stay out of sight.'
            : 'Leave this off for everyday spaces: their notes can be searched.'}
        </Muted>

        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <Button title={busy ? 'Creating…' : 'Create space'} onPress={save} disabled={busy} />
      </ScrollView>
    </KeyboardScreen>
  );
}
