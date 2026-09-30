// First-time vault setup, as the web setup page does it: choose the unlock passphrase,
// then write down the recovery key (shown once) and type it back; only then are the
// wrapped keys stored (setup_vault). The recovery key is never copied, logged or sent.
// Screenshots and the app-switcher preview are blocked while this screen is open.
import { router, Stack } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, TextInput } from 'react-native';

import { PassphraseInput } from '@/components/PassphraseInput';
import { Button, Card, Loading, Muted, styles, useColors } from '@/components/ui';
import { useVault } from '@/lib/vault';
import { MIN_PASSPHRASE_LENGTH } from '@/lib/vaultCrypto';

export default function VaultSetup() {
  usePreventScreenCapture();
  const c = useColors();
  const vault = useVault();
  const [step, setStep] = useState<'choose' | 'recovery' | 'done'>('choose');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving before the end drops the new keys; nothing was stored.
  const { cancelSetup } = vault;
  useEffect(() => cancelSetup, [cancelSetup]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = () =>
    run(async () => {
      setRecoveryKey(await vault.startSetup(pass1, pass2));
      setPass1('');
      setPass2('');
      setStep('recovery');
    });

  const confirmKey = () =>
    run(async () => {
      await vault.finishSetup(typed);
      setTyped('');
      setRecoveryKey('');
      setStep('done');
    });

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  let body;
  if (step === 'done') {
    body = (
      <Card>
        <Text style={[styles.title, { color: c.text }]}>Your vault is ready</Text>
        <Muted>It is unlocked now. Next time, unlock it with your passphrase; after that, the fingerprint works too.</Muted>
        <Button title="Done" onPress={() => router.back()} />
      </Card>
    );
  } else if (step === 'recovery') {
    body = (
      <>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Your recovery key</Text>
          <Muted>
            If you forget your passphrase, this key is the only way back into your vault. Nobody else can reset it, not even Wilma. Write it
            on paper or put it in a password manager, not in Wilma. It is shown only now.
          </Muted>
          <Text selectable={false} style={{ color: c.text, fontSize: 18, fontFamily: 'monospace', lineHeight: 28 }}>
            {recoveryKey}
          </Text>
        </Card>
        <Muted>To check you have it, type it here (capitals, spaces and dashes do not matter):</Muted>
        <TextInput
          style={[input, { fontFamily: 'monospace' }]}
          placeholder="Recovery key"
          placeholderTextColor={c.muted}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          keyboardType="visible-password"
          maxLength={100}
          editable={!busy}
        />
        <Button title={busy ? 'Saving your vault…' : 'Save my vault'} onPress={confirmKey} disabled={busy} />
      </>
    );
  } else if (vault.status === 'loading') {
    body = <Loading />;
  } else if (vault.status !== 'not_set_up') {
    body = (
      <Card>
        <Text style={[styles.title, { color: c.text }]}>Your vault is already set up</Text>
        <Muted>To choose a new passphrase, use &quot;Change the vault passphrase&quot; or &quot;Forgot your passphrase?&quot; on the vault screen.</Muted>
        <Button title="Back" kind="plain" onPress={() => router.back()} />
      </Card>
    );
  } else {
    body = (
      <>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Choose your vault passphrase</Text>
          <Muted>
            {`It unlocks your passwords and is different from your sign-in password. Use at least ${MIN_PASSPHRASE_LENGTH} characters; a few unrelated words work well. It never leaves this phone.`}
          </Muted>
        </Card>
        <PassphraseInput value={pass1} onChangeText={setPass1} placeholder="Vault passphrase" disabled={busy} />
        <PassphraseInput value={pass2} onChangeText={setPass2} placeholder="The same passphrase again" disabled={busy} onSubmitEditing={choose} />
        <Button title={busy ? 'Creating your keys (a few seconds)…' : 'Next'} onPress={choose} disabled={busy} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Set up the vault' }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {body}
          {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
