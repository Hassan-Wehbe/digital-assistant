// Settings (docs/ui-review.md, plan step 2): what used to fill the bottom of the home screen.
// This month's AI allowance in full (D28), the account, the recycle bin, sign out, the version.
// Later: miles or km (places Q14) and deleting the account (D29).
import * as Application from 'expo-application';
import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { UsageMeter } from '@/components/UsageMeter';
import { Button, Card, GroupList, GroupRow, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { versionLabel } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { loadAllowance, usageSummary } from '@/lib/usage';

export default function Settings() {
  const c = useColors();
  const { session, signOut } = useAuth();
  const usage = useLoad(`usage:${session?.user.id ?? ''}`, async () => {
    const a = await loadAllowance((fn) => supabase.rpc(fn));
    return a ? usageSummary(a) : null;
  });
  useReloadOnReturn(usage.reload);

  const heading = (title: string) => <Text style={[styles.title, { color: c.text }]}>{title}</Text>;

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
      {heading('This month')}
      <Card>
        {/* Hidden when the allowance cannot be read (offline): never a reason to block anything. */}
        {usage.data ? <UsageMeter usage={usage.data} /> : <Muted>{usage.loading ? 'Reading your allowance…' : 'Your allowance cannot be read right now.'}</Muted>}
        <Muted>Finding a space or a password by its name never counts.</Muted>
      </Card>

      {heading('Account')}
      <GroupList>
        <GroupRow first title="Signed in as" subtitle={session?.user.email ?? 'you'} />
        <GroupRow title="Change sign-in password" onPress={() => router.push('/account')} />
        <GroupRow title="Recycle bin" subtitle="Deleted notes" onPress={() => router.push('/bin')} />
      </GroupList>

      <Button title="Sign out" kind="danger" onPress={signOut} />
      <Muted>{versionLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion)}</Muted>
    </ScrollView>
  );
}
