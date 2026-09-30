// Save a new secret, or type a new value for an existing one (params id, name, type).
// The value is sealed on the phone to the vault's public key; Wilma only gets the name,
// kind and website (save_secret / update_secret) and the database only the ciphertext.
// A new secret can be saved while the vault is locked; a new value needs it unlocked.
// Screenshots and the app-switcher preview are blocked while this screen is open.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { SecretFieldsForm } from '@/components/SecretFieldsForm';
import { SpaceChips } from '@/components/SpaceChips';
import { UnlockCard } from '@/components/UnlockCard';
import { Button, Card, confirm, Muted, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useVault } from '@/lib/vault';
import { SECRET_FIELDS, TYPE_LABELS } from '@/lib/vaultCrypto';
import { sameName } from '@/lib/vaultFlow';

const TYPES = Object.keys(SECRET_FIELDS);

export default function EnterSecret() {
  usePreventScreenCapture();
  const c = useColors();
  const { wilma } = useAuth();
  const vault = useVault();
  const params = useLocalSearchParams<{ id?: string; name?: string; type?: string }>();
  const changing = !!params.id;
  // Restricted spaces are left out: the vault list never shows their secrets.
  const spaces = useLoad('spaces', async () => (await wilma.listSpaces()).filter((s) => !s.restricted));
  const [space, setSpace] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [type, setType] = useState(params.type ?? 'login');
  const [url, setUrl] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (changing) {
        await vault.changeValue({ id: params.id!, type }, values);
        setValues({});
        setDone(true);
        return;
      }
      const target = spaces.data?.find((s) => s.id === space);
      if (!target) throw new Error('Choose a space.');
      const twins = name.trim() ? sameName(await wilma.findSecrets({ query: name.trim() }), name, target.path) : [];
      if (
        twins.length &&
        !(await confirm(
          'That name is taken',
          `"${twins[0].name}" is already in ${target.path}. To change its value, open it and choose "Change the value". Save a second one anyway?`,
          'Save another',
        ))
      ) {
        return;
      }
      const saved = await vault.save({ space: target.id, name, secret_type: type, url }, values);
      setValues({});
      router.replace({ pathname: '/vault/[id]', params: { id: saved.id, name: saved.name, type, space: target.path, url: url.trim() } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  const needsUnlock = changing && vault.status !== 'unlocked';
  return (
    <>
      <Stack.Screen options={{ title: changing ? 'New value' : 'Save a secret' }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {changing ? (
            <Card>
              <Text style={[styles.title, { color: c.text }]}>{params.name}</Text>
              <Muted>{`${TYPE_LABELS[type] ?? type} · the new value replaces the old one.`}</Muted>
            </Card>
          ) : (
            <>
              <Text style={[styles.title, { color: c.text }]}>Space</Text>
              <SpaceChips spaces={spaces.data} error={spaces.error} onRetry={spaces.reload} value={space} onChange={setSpace} disabled={busy} />
              <TextInput
                style={input}
                placeholder="Name, e.g. Home Wi-Fi"
                placeholderTextColor={c.muted}
                maxLength={200}
                value={name}
                onChangeText={setName}
                editable={!busy}
              />
              <Text style={[styles.title, { color: c.text }]}>Kind</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TYPES.map((t) => {
                  const on = t === type;
                  return (
                    <Pressable
                      key={t}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      disabled={busy}
                      onPress={() => setType(t)}
                      style={{
                        borderWidth: 1,
                        borderRadius: 16,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderColor: on ? c.accent : c.line,
                        backgroundColor: on ? c.accent : c.card,
                      }}>
                      <Text style={{ color: on ? '#ffffff' : c.text }}>{TYPE_LABELS[t]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={input}
                placeholder="Website (optional)"
                placeholderTextColor={c.muted}
                maxLength={2000}
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!busy}
              />
            </>
          )}

          {done ? (
            <Card>
              <Text style={[styles.title, { color: c.text }]}>New value saved</Text>
              <Muted>{"The old value is gone. The change is recorded in your vault's access log."}</Muted>
              <Button title="Done" onPress={() => router.back()} />
            </Card>
          ) : needsUnlock ? (
            <UnlockCard />
          ) : (
            <>
              <SecretFieldsForm type={type} values={values} onChange={setValues} disabled={busy} />
              <Muted>
                The value is encrypted on this phone before it is sent. Wilma never sees it
                {changing ? '' : ", and you don't need to unlock the vault to save"}.
              </Muted>
              {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
              <Button title={busy ? 'Encrypting and saving…' : changing ? 'Save the new value' : 'Save'} onPress={save} disabled={busy} />
            </>
          )}
          {!changing && spaces.data ? <Muted>Restricted spaces are not listed here; ask Wilma in the Claude app to save to one.</Muted> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
