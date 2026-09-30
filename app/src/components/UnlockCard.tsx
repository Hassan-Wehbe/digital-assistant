// Unlock the vault: fingerprint when this phone keeps a key for it, else the passphrase.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';

import { useVault } from '@/lib/vault';

import { Button, Card, Muted, styles, useColors } from './ui';

export function UnlockCard() {
  const c = useColors();
  const vault = useVault();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showPassphrase, setShowPassphrase] = useState(!vault.fingerprint);
  const asked = useRef(false);

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

  const withFingerprint = () =>
    run(async () => {
      try {
        await vault.unlockWithFingerprint();
      } catch (e) {
        setShowPassphrase(true);
        throw e;
      }
    });

  const withPassphrase = () =>
    run(async () => {
      if (!passphrase) throw new Error('Enter your vault passphrase.');
      const { fingerprintNote } = await vault.unlockWithPassphrase(passphrase);
      setPassphrase('');
      setNote(fingerprintNote);
    });

  // Offer the fingerprint right away, once.
  useEffect(() => {
    if (vault.fingerprint && !asked.current) {
      asked.current = true;
      withFingerprint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.fingerprint]);

  return (
    <Card style={{ gap: 12 }}>
      <Text style={[styles.title, { color: c.text }]}>🔒 The vault is locked</Text>
      {vault.fingerprint ? <Button title={busy ? 'Unlocking…' : 'Unlock with fingerprint'} onPress={withFingerprint} disabled={busy} /> : null}
      {showPassphrase ? (
        <>
          <Muted>Your vault passphrase (not your sign-in password). It stays on this phone.</Muted>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
            placeholder="Vault passphrase"
            placeholderTextColor={c.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            value={passphrase}
            onChangeText={setPassphrase}
            onSubmitEditing={withPassphrase}
            editable={!busy}
          />
          <Button title={busy ? 'Unlocking (a few seconds)…' : 'Unlock'} kind={vault.fingerprint ? 'plain' : 'primary'} onPress={withPassphrase} disabled={busy} />
        </>
      ) : (
        <Button title="Use the passphrase instead" kind="plain" onPress={() => setShowPassphrase(true)} disabled={busy} />
      )}
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      {note ? <Muted>{note}</Muted> : null}
      {showPassphrase ? (
        <Button
          title="Forgot your passphrase?"
          kind="plain"
          onPress={() => router.push({ pathname: '/vault/passphrase', params: { mode: 'recover' } })}
          disabled={busy}
        />
      ) : null}
    </Card>
  );
}
