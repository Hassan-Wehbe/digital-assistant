// A new vault passphrase, as the web recover page does it: with the current passphrase
// (mode "change") or, when it is forgotten, with the recovery key (mode "recover").
// Only the newly wrapped key is stored (rewrap_vault_passphrase); the secrets, the
// recovery key and the fingerprint unlock stay as they are.
// Screenshots and the app-switcher preview are blocked while this screen is open.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { PassphraseInput } from '@/components/PassphraseInput';
import { Button, Card, KeyboardScreen, Muted, styles, useColors } from '@/components/ui';
import { useVault } from '@/lib/vault';
import { MIN_PASSPHRASE_LENGTH } from '@/lib/vaultCrypto';

export default function VaultPassphrase() {
  usePreventScreenCapture();
  const c = useColors();
  const vault = useVault();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const recovering = mode === 'recover';
  const [proof, setProof] = useState('');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!proof) throw new Error(recovering ? 'Enter your recovery key.' : 'Enter your current passphrase.');
      if (recovering) await vault.recover(proof, pass1, pass2);
      else await vault.changePassphrase(proof, pass1, pass2);
      setProof('');
      setPass1('');
      setPass2('');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title = recovering ? 'Forgot your passphrase?' : 'Change the vault passphrase';
  return (
    <>
      <Stack.Screen options={{ title }} />
      <KeyboardScreen>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {done ? (
            <Card>
              <Text style={[styles.title, { color: c.text }]}>New passphrase saved</Text>
              <Muted>
                The vault is unlocked. From now on, unlock it with the new passphrase (or your fingerprint). Your recovery key has not changed.
              </Muted>
              <Button title="Done" onPress={() => router.back()} />
            </Card>
          ) : vault.status === 'not_set_up' ? (
            <Card>
              <Text style={[styles.title, { color: c.text }]}>Your vault is not set up yet</Text>
              <Button title="Set up the vault" onPress={() => router.replace('/vault/setup')} />
            </Card>
          ) : (
            <>
              <Card>
                <Text style={[styles.title, { color: c.text }]}>{title}</Text>
                <Muted>
                  {recovering
                    ? 'Enter the recovery key you wrote down when you set up the vault, then choose a new passphrase. Your passwords stay as they are.'
                    : `Enter your current passphrase, then the new one twice (at least ${MIN_PASSPHRASE_LENGTH} characters). Your passwords and your recovery key stay as they are.`}
                </Muted>
              </Card>
              <PassphraseInput
                value={proof}
                onChangeText={setProof}
                placeholder={recovering ? 'Recovery key' : 'Current passphrase'}
                disabled={busy}
              />
              <PassphraseInput value={pass1} onChangeText={setPass1} placeholder="New passphrase" disabled={busy} />
              <PassphraseInput value={pass2} onChangeText={setPass2} placeholder="The new passphrase again" disabled={busy} onSubmitEditing={save} />
              <Button title={busy ? 'Saving (a few seconds)…' : 'Save the new passphrase'} onPress={save} disabled={busy} />
              {recovering ? null : (
                <Button title="Forgot it? Use the recovery key" kind="plain" onPress={() => router.setParams({ mode: 'recover' })} disabled={busy} />
              )}
            </>
          )}
          {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        </ScrollView>
      </KeyboardScreen>
    </>
  );
}
