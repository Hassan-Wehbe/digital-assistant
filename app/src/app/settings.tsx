// Settings (docs/ui-review.md, plan step 2): what used to fill the bottom of the home screen.
// This month's AI allowance in full (D28), distances in miles or km (places Q14), the phone's
// calendars Wilma may read (day planner step 1, app/calendars.tsx), the account,
// the recycle bin, deleting the account (D29, app/delete-account.tsx), sign out, the version.
import * as Application from 'expo-application';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { UsageMeter } from '@/components/UsageMeter';
import { Button, Card, GroupList, GroupRow, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { loadChoice } from '@/lib/calendarSettings';
import { versionLabel } from '@/lib/config';
import { deviceSettingsStore } from '@/lib/deviceStorage';
import { supabase } from '@/lib/supabase';
import { type DistanceUnit, loadDistanceUnit, saveDistanceUnit, UNIT_CHOICES, type UnitsDb } from '@/lib/units';
import { loadAllowance, usageSummary } from '@/lib/usage';

export default function Settings() {
  const c = useColors();
  const { session, signOut } = useAuth();
  const usage = useLoad(`usage:${session?.user.id ?? ''}`, async () => {
    const a = await loadAllowance((fn) => supabase.rpc(fn));
    return a ? usageSummary(a) : null;
  });
  useReloadOnReturn(usage.reload);
  const userId = session?.user.id ?? '';
  const db = supabase as unknown as UnitsDb;
  const stored = useLoad(`unit:${userId}`, () => loadDistanceUnit(db, userId));
  // The choice just tapped, shown at once; dropped again if the save fails.
  const [picked, setPicked] = useState<DistanceUnit | null>(null);
  const [unitNote, setUnitNote] = useState<string | null>(null);
  const unit = picked ?? stored.data;
  const calendar = useLoad(`calendars:${userId}`, () => loadChoice(deviceSettingsStore, userId));
  useReloadOnReturn(calendar.reload);

  const pickUnit = async (u: DistanceUnit) => {
    if (u === unit || !userId) return;
    setPicked(u);
    setUnitNote(null);
    if (await saveDistanceUnit(db, userId, u)) {
      stored.reload();
    } else {
      setPicked(null);
      setUnitNote("That wasn't saved. Check your connection and try again.");
    }
  };

  const heading = (title: string) => <Text style={[styles.title, { color: c.text }]}>{title}</Text>;

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
      {heading('This month')}
      <Card>
        {/* Hidden when the allowance cannot be read (offline): never a reason to block anything. */}
        {usage.data ? <UsageMeter usage={usage.data} /> : <Muted>{usage.loading ? 'Reading your allowance…' : 'Your allowance cannot be read right now.'}</Muted>}
        <Muted>Finding a space or a password by its name never counts.</Muted>
      </Card>

      {heading('Distances')}
      <GroupList>
        {UNIT_CHOICES.map((choice, i) => (
          <GroupRow
            key={choice.unit}
            first={i === 0}
            title={choice.title}
            checked={unit === choice.unit}
            onPress={unit ? () => void pickUnit(choice.unit) : undefined}
          />
        ))}
      </GroupList>
      <Muted>
        {unit
          ? (unitNote ?? 'How Wilma gives distances to your places. "Nearby" means within 10 miles (16 km).')
          : stored.loading
            ? 'Reading your setting…'
            : 'Your setting cannot be read right now.'}
      </Muted>

      {heading('Calendar')}
      <GroupList>
        <GroupRow
          first
          title="Calendars"
          subtitle={
            !calendar.data
              ? undefined
              : calendar.data.on
                ? `On: Wilma may read ${calendar.data.ticked.length} calendar${calendar.data.ticked.length === 1 ? '' : 's'}`
                : 'Off'
          }
          onPress={() => router.push('/calendars')}
        />
      </GroupList>

      {heading('Account')}
      <GroupList>
        <GroupRow first title="Signed in as" subtitle={session?.user.email ?? 'you'} />
        <GroupRow title="Change sign-in password" onPress={() => router.push('/account')} />
        <GroupRow title="Recycle bin" subtitle="Deleted notes" onPress={() => router.push('/bin')} />
        <GroupRow title="Delete account" subtitle="Everything in it, for good" onPress={() => router.push('/delete-account')} />
      </GroupList>

      <Button title="Sign out" kind="danger" onPress={signOut} />
      <Muted>{versionLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion)}</Muted>
    </ScrollView>
  );
}
