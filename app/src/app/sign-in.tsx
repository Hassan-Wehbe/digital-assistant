// Sign in with the same email and password as the vault pages and the Claude connector.
import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { Button, Card, KeyboardScreen, Muted, styles, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useShare } from '@/lib/shareIntake';

export default function SignIn() {
  const c = useColors();
  const { signIn } = useAuth();
  const { pending } = useShare();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const problem = await signIn(email, password);
    setBusy(false);
    if (problem) setError(problem);
    else setPassword('');
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    // The form sits at the top so the keyboard never covers it; 'padding' also on Android,
    // where the app draws edge to edge and the window is not resized for the keyboard.
    <KeyboardScreen>
      <ScrollView contentContainerStyle={[styles.list, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <Text style={[styles.title, { color: c.text, fontSize: 22 }]}>{"Hi, I'm Wilma."}</Text>
          <Muted>Sign in with the account you use for Wilma in the Claude app.</Muted>
          {pending ? <Muted>Sign in first; then you can save what you shared.</Muted> : null}
          <TextInput
            style={input}
            placeholder="Email"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
          />
          <TextInput
            ref={passwordRef}
            style={input}
            returnKeyType="go"
            placeholder="Password"
            placeholderTextColor={c.muted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            editable={!busy}
          />
          {error && <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text>}
          <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy} />
        </Card>
      </ScrollView>
    </KeyboardScreen>
  );
}
