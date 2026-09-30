// Change the sign-in password (the one for signing in to Wilma, not the vault passphrase).
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text } from 'react-native';

import { PassphraseInput } from '@/components/PassphraseInput';
import { Button, Card, Muted, styles, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';

export default function Account() {
  const c = useColors();
  const { session, changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next, again);
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {done ? (
          <Card>
            <Text style={[styles.title, { color: c.text }]}>Password changed</Text>
            <Muted>Use the new password next time you sign in. Your vault passphrase has not changed.</Muted>
            <Button title="Done" onPress={() => router.back()} />
          </Card>
        ) : (
          <>
            <Card>
              <Text style={[styles.title, { color: c.text }]}>Change your sign-in password</Text>
              <Muted>
                {`For ${session?.user.email ?? 'your account'}. This is the password for signing in to Wilma, not your vault passphrase; keep the two different. Use at least ${MIN_PASSWORD_LENGTH} characters.`}
              </Muted>
            </Card>
            <PassphraseInput value={current} onChangeText={setCurrent} placeholder="Current password" disabled={busy} />
            <PassphraseInput value={next} onChangeText={setNext} placeholder="New password" disabled={busy} />
            <PassphraseInput value={again} onChangeText={setAgain} placeholder="The new password again" disabled={busy} onSubmitEditing={save} />
            {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
            <Button title={busy ? 'Saving…' : 'Change password'} onPress={save} disabled={busy} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
