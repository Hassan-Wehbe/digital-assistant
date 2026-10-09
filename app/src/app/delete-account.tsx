// Delete account (docs/signup-plan.md step 3, Q6): says what goes, asks for the password and for
// DELETE typed, then deletes everything at once (no grace period) and signs out.
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { PassphraseInput } from '@/components/PassphraseInput';
import { Button, Card, KeyboardScreen, Muted, styles, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { CONFIRM_WORD, deleteAccount } from '@/lib/deleteAccount';
import { supabase } from '@/lib/supabase';

export default function DeleteAccount() {
  const c = useColors();
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const problem = await deleteAccount(
      {
        token: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
        fetch: (url, init) => fetch(url, init),
        signOutLocally: async () => {
          await supabase.auth.signOut({ scope: 'local' });
        },
      },
      password,
      typed,
    );
    // On success the session is gone and the sign-in screen replaces this one.
    setBusy(false);
    if (problem) setError(problem);
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 8 }}>
          <Text style={[styles.title, { color: c.text }]}>Delete your account</Text>
          <Muted>
            {`This deletes ${session?.user.email ?? 'your account'} and everything in it, straight away: your spaces, notes and their earlier versions, tasks, places, photos and files, your vault and its secrets, and your usage. It cannot be undone, and nobody, not even Wilma's team, can bring it back.`}
          </Muted>
          <Muted>Want to keep something? Copy it out first.</Muted>
        </Card>
        <PassphraseInput value={password} onChangeText={setPassword} placeholder="Your sign-in password" disabled={busy} />
        <TextInput
          style={input}
          placeholder={`Type ${CONFIRM_WORD} to confirm`}
          placeholderTextColor={c.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          value={typed}
          onChangeText={setTyped}
          editable={!busy}
        />
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <Button
          title={busy ? 'Deleting…' : 'Delete my account'}
          kind="danger"
          onPress={submit}
          disabled={busy || typed.trim() !== CONFIRM_WORD || !password}
        />
      </ScrollView>
    </KeyboardScreen>
  );
}
