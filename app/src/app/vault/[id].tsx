// One secret: reveal it (decrypted on the phone), values hidden until Show, everything
// hidden again after 30 seconds; copied values leave the clipboard after 30 seconds.
// Screenshots and the app-switcher preview are blocked while this screen is open.
// Unlocked, the secret can also get a new value (vault/enter), a new name or website, or
// be deleted for good (after a confirm dialog).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { UnlockCard } from '@/components/UnlockCard';
import { Button, Card, confirm, Muted, styles, useColors } from '@/components/ui';
import { copySecret } from '@/lib/secretClipboard';
import { useVault } from '@/lib/vault';
import { displayRows, TYPE_LABELS } from '@/lib/vaultCrypto';
import { detailsChange, SHOW_MS, type Revealed } from '@/lib/vaultFlow';

const DOTS = '•'.repeat(12);

export default function SecretScreen() {
  usePreventScreenCapture();
  const c = useColors();
  const vault = useVault();
  const params = useLocalSearchParams<{ id: string; name?: string; type?: string; space?: string; url?: string }>();
  const { id, type, space } = params;
  // Name and website as last known here (the list's, then after a rename).
  const [meta, setMeta] = useState({ name: params.name ?? '', url: params.url || null });
  const { name, url } = meta;
  const [editing, setEditing] = useState<{ name: string; url: string } | null>(null);
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

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await f();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = () =>
    run(async () => {
      if (!editing) return;
      const change = detailsChange(meta, editing);
      if (change) {
        await vault.updateDetails(id, change);
        setMeta({ name: change.name ?? meta.name, url: change.url === undefined ? meta.url : change.url || null });
        setMessage({ text: 'Saved.' });
      }
      setEditing(null);
    });

  const remove = async () => {
    if (!(await confirm(`Delete "${name}"?`, 'It is deleted for good and cannot be recovered. Your access log keeps a note that it existed.', 'Delete'))) {
      return;
    }
    await run(async () => {
      await vault.remove(id);
      router.back();
    });
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
      <Stack.Screen options={{ title: shown?.name || name || 'Secret' }} />
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

        {vault.status === 'unlocked' && !shown ? (
          editing ? (
            <Card>
              <Muted>Name</Muted>
              <TextInput
                style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
                value={editing.name}
                onChangeText={(t) => setEditing({ ...editing, name: t })}
                maxLength={200}
                editable={!busy}
              />
              <Muted>Website (leave empty to remove it)</Muted>
              <TextInput
                style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
                value={editing.url}
                onChangeText={(t) => setEditing({ ...editing, url: t })}
                maxLength={2000}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!busy}
              />
              <Button title={busy ? 'Saving…' : 'Save'} onPress={saveDetails} disabled={busy} />
              <Button title="Cancel" kind="plain" onPress={() => setEditing(null)} disabled={busy} />
            </Card>
          ) : (
            <Card>
              <Text style={[styles.title, { color: c.text }]}>Change</Text>
              <Button
                title="Change the value"
                kind="plain"
                disabled={busy}
                onPress={() => router.push({ pathname: '/vault/enter', params: { id, name, type: type ?? '' } })}
              />
              <Button title="Rename or change the website" kind="plain" disabled={busy} onPress={() => setEditing({ name, url: url ?? '' })} />
              <Button title={busy ? 'Deleting…' : 'Delete'} kind="danger" disabled={busy} onPress={remove} />
            </Card>
          )
        ) : null}

        {message ? <Text style={{ color: message.error ? c.danger : c.muted, fontSize: 15 }}>{message.text}</Text> : null}
      </ScrollView>
    </>
  );
}
