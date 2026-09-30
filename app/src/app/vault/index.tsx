// The vault: your secrets by name (never their values), and the lock.
// Restricted spaces are never listed (find_secret leaves them out).
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';

import { UnlockCard } from '@/components/UnlockCard';
import { Button, Card, ErrorBox, Loading, Muted, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useVault } from '@/lib/vault';
import { TYPE_LABELS } from '@/lib/vaultCrypto';

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function VaultScreen() {
  const c = useColors();
  const { wilma } = useAuth();
  const vault = useVault();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const secrets = useLoad(`secrets:${query}`, () => wilma.findSecrets(query ? { query } : {}));
  useReloadOnReturn(secrets.reload);

  if (vault.status === 'loading') return <Loading />;
  if (vault.status === 'error') {
    return (
      <View style={[styles.list, { flex: 1, backgroundColor: c.background }]}>
        <ErrorBox message={vault.problem ?? 'The vault could not be opened.'} onRetry={vault.refresh} />
      </View>
    );
  }
  if (vault.status === 'not_set_up') {
    return (
      <View style={[styles.list, { flex: 1, backgroundColor: c.background }]}>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Your vault is not set up yet</Text>
          <Muted>Set it up once: you choose an unlock passphrase and write down a recovery key. It takes a minute.</Muted>
          <Button title="Set up the vault" onPress={() => router.push('/vault/setup')} />
          <Button title="I set it up on the web page" kind="plain" onPress={vault.refresh} />
        </Card>
      </View>
    );
  }

  const header = (
    <View style={{ gap: 12 }}>
      {vault.status === 'locked' ? (
        <UnlockCard />
      ) : (
        <Card>
          <Text style={[styles.title, { color: c.text }]}>🔓 Unlocked{vault.locksAt ? ` until ${time(vault.locksAt)}` : ''}</Text>
          <Muted>It locks by itself after 5 minutes, or when you are away from Wilma for a minute.</Muted>
          <Button title="Lock now" kind="plain" onPress={vault.lock} />
          <Button title="Change the vault passphrase" kind="plain" onPress={() => router.push({ pathname: '/vault/passphrase', params: { mode: 'change' } })} />
        </Card>
      )}
      <Button title="Save a new secret" onPress={() => router.push('/vault/enter')} />
      <TextInput
        style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
        placeholder="Find a secret by name or website"
        placeholderTextColor={c.muted}
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (!t.trim()) setQuery('');
        }}
        onSubmitEditing={() => setQuery(text.trim())}
        returnKeyType="search"
        autoCapitalize="none"
      />
      {secrets.error ? <ErrorBox message={secrets.error} onRetry={secrets.reload} /> : null}
    </View>
  );

  const footer = (
    <View style={{ gap: 8, marginTop: 16 }}>
      {vault.fingerprint ? <Button title="Stop using fingerprint for the vault" kind="plain" onPress={vault.forgetFingerprint} /> : null}
      <Muted>Open a secret to reveal it, give it a new value, rename it or delete it (unlock the vault first).</Muted>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.list}
      data={secrets.data ?? []}
      keyExtractor={(s) => s.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={secrets.loading ? <Loading /> : secrets.error ? null : <Muted>{query ? 'No secret matches.' : 'No secrets yet.'}</Muted>}
      renderItem={({ item: s }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/vault/[id]', params: { id: s.id, name: s.name, type: s.secret_type, space: s.space ?? '', url: s.url ?? '' } })
          }>
          <Card>
            <Text style={[styles.title, { color: c.text }]}>{s.name}</Text>
            <Muted>{[TYPE_LABELS[s.secret_type] ?? s.secret_type, s.space, s.url].filter(Boolean).join(' · ')}</Muted>
          </Card>
        </Pressable>
      )}
      refreshControl={<RefreshControl refreshing={secrets.loading && !!secrets.data} onRefresh={secrets.reload} />}
    />
  );
}
