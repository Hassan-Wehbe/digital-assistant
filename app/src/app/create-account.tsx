// Create account with an invite code (docs/signup-plan.md step 2). The server checks the code,
// 18+ and the terms before any account exists; then a confirmation email, then sign in.
import { router } from 'expo-router';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PassphraseInput } from '@/components/PassphraseInput';
import { Button, Card, KeyboardScreen, Muted, styles, useColors } from '@/components/ui';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import { createAccount, loadSignupMode, PRIVACY_URL, TERMS_URL, type SignupMode } from '@/lib/signup';
import { supabase } from '@/lib/supabase';

export default function CreateAccount() {
  const c = useColors();
  const emailRef = useRef<TextInput>(null);
  const [mode, setMode] = useState<SignupMode>('invite');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    void loadSignupMode((fn) => supabase.rpc(fn)).then(setMode);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const problem = await createAccount(
      { signUp: (args) => supabase.auth.signUp(args), isConnectionError: isAuthRetryableFetchError },
      { code, email, password, again, agreed },
      mode,
    );
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setPassword('');
    setAgain('');
    setSentTo(email.trim().toLowerCase());
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  const link = (title: string, url: string) => (
    <Text style={{ color: c.accent }} accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => {})}>
      {title}
    </Text>
  );

  if (sentTo) {
    return (
      <ScrollView contentContainerStyle={[styles.list, { paddingTop: 24 }]}>
        <Card style={{ gap: 12 }}>
          <Text style={[styles.title, { color: c.text }]}>Check your email</Text>
          <Muted>
            {`If ${sentTo} is new to Wilma, a confirmation email is on its way. Tap its link, then come back here and sign in. No email after a few minutes? Look in spam.`}
          </Muted>
          <Button title="Go to sign in" onPress={() => router.replace({ pathname: '/sign-in', params: { email: sentTo } })} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={[styles.list, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <Text style={[styles.title, { color: c.text }]}>Create your Wilma account</Text>
          <Muted>
            {mode === 'invite'
              ? 'Wilma is in testing: you need the invite code you were given.'
              : 'Use an email you can open on this phone.'}
          </Muted>
          {mode === 'invite' ? (
            <TextInput
              style={input}
              placeholder="Invite code (WILMA-…)"
              placeholderTextColor={c.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              submitBehavior="submit"
              value={code}
              onChangeText={setCode}
              editable={!busy}
            />
          ) : null}
          <TextInput
            ref={emailRef}
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
          <PassphraseInput value={password} onChangeText={setPassword} placeholder={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`} disabled={busy} />
          <PassphraseInput value={again} onChangeText={setAgain} placeholder="The password again" disabled={busy} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            onPress={() => setAgreed((a) => !a)}
            disabled={busy}
            style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
          >
            <Text style={{ fontSize: 22, color: agreed ? c.accent : c.muted }}>{agreed ? '☑' : '☐'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 15 }}>
                {'I am 18 or older and agree to the '}
                {link('Privacy policy', PRIVACY_URL)}
                {' and '}
                {link('Testing terms', TERMS_URL)}
                {'.'}
              </Text>
            </View>
          </Pressable>
          {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
          <Button title={busy ? 'Creating…' : 'Create account'} onPress={submit} disabled={busy} />
        </Card>
      </ScrollView>
    </KeyboardScreen>
  );
}
