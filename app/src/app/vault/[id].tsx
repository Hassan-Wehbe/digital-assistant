// One secret: reveal it (decrypted on the phone), values hidden until Show, everything
// hidden again after 30 seconds; copied values leave the clipboard after 30 seconds.
// Screenshots and the app-switcher preview are blocked while this screen is open.
import { Stack, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { UnlockCard } from '@/components/UnlockCard';
import { Button, Card, Muted, styles, useColors } from '@/components/ui';
import { copySecret } from '@/lib/secretClipboard';
import { useVault } from '@/lib/vault';
import { displayRows, TYPE_LABELS } from '@/lib/vaultCrypto';
import { SHOW_MS, type Revealed } from '@/lib/vaultFlow';

const DOTS = '•'.repeat(12);

export default function SecretScreen() {
  usePreventScreenCapture();
  const c = useColors();
  const vault = useVault();
  const { id, name, type, space, url } = useLocalSearchParams<{ id: string; name?: string; type?: string; space?: string; url?: string }>();
  const [revealed, setShown] = useState<Revealed | null>(null);
  // Nothing stays on screen once the vault locks.
  const shown = vault.status === 'unlocked' ? revealed : null;
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const hideAt = useRef(0);

  const hide = () => {
    setShown(null);
    setVisible({});
    setLeft(0);
  };

  // Count down, then hide (and drop the values once the vault has locked).
  useEffect(() => {
    if (!revealed) return;
    const t = setInterval(() => {
      const s = Math.ceil((hideAt.current - Date.now()) / 1000);
      if (s <= 0 || vault.status !== 'unlocked') hide();
      else setLeft(s);
    }, 500);
    return () => clearInterval(t);
  }, [revealed, vault.status]);

  const reveal = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await vault.reveal(id);
      hideAt.current = Date.now() + SHOW_MS;
      setLeft(Math.ceil(SHOW_MS / 1000));
      setShown(r);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await copySecret(value);
      setMessage({ text: `Copied. The clipboard is cleared in ${SHOW_MS / 1000} s.` });
    } catch {
      setMessage({ text: 'Copy did not work; use Show and type it by hand.', error: true });
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: shown?.name ?? name ?? 'Secret' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={[styles.title, { color: c.text }]}>{shown?.name ?? name}</Text>
          <Muted>{[TYPE_LABELS[type ?? ''] ?? type, space].filter(Boolean).join(' · ')}</Muted>
          {shown?.url || url ? <Muted>{shown?.url ?? url}</Muted> : null}
        </Card>

        {vault.status === 'locked' ? <UnlockCard /> : null}

        {vault.status === 'unlocked' && !shown ? (
          <>
            <Button title={busy ? 'Decrypting…' : 'Reveal'} onPress={reveal} disabled={busy} />
            <Muted>{"Each reveal is recorded in your vault's access log."}</Muted>
          </>
        ) : null}

        {shown ? (
          <>
            {displayRows(shown.type, shown.fields).map((row) => {
              const on = !row.masked || visible[row.key];
              return (
                <Card key={row.key}>
                  <Muted>{row.label}</Muted>
                  <Text selectable={false} style={{ color: c.text, fontSize: 17, fontFamily: 'monospace' }}>
                    {on ? row.value : DOTS}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    {row.masked ? (
                      <Pressable accessibilityRole="button" onPress={() => setVisible((v) => ({ ...v, [row.key]: !v[row.key] }))}>
                        <Text style={{ color: c.accent, fontSize: 15 }}>{on ? 'Hide' : 'Show'}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" onPress={() => copy(row.value)}>
                      <Text style={{ color: c.accent, fontSize: 15 }}>Copy</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })}
            <Muted>Hides in {left} s.</Muted>
            <Button title="Hide now" kind="plain" onPress={hide} />
          </>
        ) : null}

        {message ? <Text style={{ color: message.error ? c.danger : c.muted, fontSize: 15 }}>{message.text}</Text> : null}
      </ScrollView>
    </>
  );
}
