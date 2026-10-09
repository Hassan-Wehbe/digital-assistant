// Welcome, on Home, the first time an account made in the app signs in on this phone
// (docs/signup-plan.md step 2, Q5): what Wilma does, her name, and the vault; all skippable.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { deviceWelcome } from '@/lib/deviceStorage';
import { isAppSignup } from '@/lib/signup';
import { Button, Card, Muted, space, styles, useColors } from './ui';

export function WelcomeCard() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const appSignup = isAppSignup(session?.user.user_metadata);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userId || !appSignup) return;
    void deviceWelcome.seen(userId).then((seen) => setShow(!seen)).catch(() => {});
  }, [userId, appSignup]);

  if (!show || !userId) return null;
  const close = () => {
    setShow(false);
    void deviceWelcome.markSeen(userId).catch(() => {});
  };
  return (
    <Card style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>Welcome to Wilma</Text>
      <Muted>Tell me anything worth keeping (notes, recipes, designs, places) and ask for it later, in your own words.</Muted>
      <Muted>Passwords and PINs go in the 🔒 Vault, locked with a passphrase only you know. I never see them.</Muted>
      <Muted>{'Want another name for me? Say “call yourself …” in the chat.'}</Muted>
      <View style={{ gap: space.s }}>
        <Button
          title="Set up your vault"
          onPress={() => {
            close();
            router.push('/vault/setup');
          }}
        />
        <Button title="Later" kind="plain" onPress={close} />
      </View>
    </Card>
  );
}
