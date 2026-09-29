// Sign in with the same email and password as the vault pages and the Claude connector.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';

import { Button, Card, Muted, styles, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const c = useColors();
  const { signIn } = useAuth();
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.list, { flexGrow: 1, justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <Text style={[styles.title, { color: c.text, fontSize: 22 }]}>{"Hi, I'm Wilma."}</Text>
          <Muted>Sign in with the account you use for Wilma in the Claude app.</Muted>
          <TextInput
            style={input}
            placeholder="Email"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
          />
          <TextInput
            style={input}
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
    </KeyboardAvoidingView>
  );
}
