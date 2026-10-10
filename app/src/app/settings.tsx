// Settings (docs/ui-review.md, plan step 2): what used to fill the bottom of the home screen.
// Memory on or off and what Wilma remembered (memory step 3).
// This month's AI allowance in full (D28), distances in miles or km (places Q14), the phone's
// Theme (light, dark or the phone's), the
// calendars Wilma may read (day planner step 1, app/calendars.tsx), the morning briefing and
// leave-by alerts (day planner step 4, app/briefing.tsx), the account,
// the recycle bin, deleting the account (D29, app/delete-account.tsx), sign out, the version.
import * as Application from 'expo-application';
import { router } from 'expo-router';
import { useState } from 'react';
import { Appearance, Platform, ScrollView, Text } from 'react-native';

import { UsageMeter } from '@/components/UsageMeter';
import { Button, Card, GroupList, GroupRow, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { briefingSummary, loadBriefing } from '@/lib/briefingSettings';
import { loadChoice } from '@/lib/calendarSettings';
import { versionLabel } from '@/lib/config';
import { deviceSettingsStore } from '@/lib/deviceStorage';
import { loadMemoryOn, type MemoryDb, memoriesSpace, saveMemoryOn } from '@/lib/memory';
import { useOpenSpace } from '@/lib/openSpace';
import { supabase } from '@/lib/supabase';
import { applyTheme, loadTheme, saveTheme, THEME_CHOICES, type ThemeChoice } from '@/lib/themeSetting';
import { type DistanceUnit, loadDistanceUnit, saveDistanceUnit, UNIT_CHOICES, type UnitsDb } from '@/lib/units';
import { loadAllowance, usageSummary } from '@/lib/usage';

export default function Settings() {
  const c = useColors();
  const { session, signOut, wilma } = useAuth();
  const openSpace = useOpenSpace();
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
  const briefing = useLoad(`briefing:${userId}`, () => loadBriefing(deviceSettingsStore, userId));
  useReloadOnReturn(briefing.reload);

  const savedTheme = useLoad('theme', () => loadTheme(deviceSettingsStore));
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  const [themeNote, setThemeNote] = useState<string | null>(null);
  const shownTheme = theme ?? savedTheme.data;
  const pickTheme = async (t: ThemeChoice) => {
    if (t === shownTheme) return;
    setTheme(t);
    applyTheme(Appearance, t);
    setThemeNote((await saveTheme(deviceSettingsStore, t)) ? null : "That wasn't saved on this phone, so it lasts until Wilma restarts.");
  };

  const memoryDb = supabase as unknown as MemoryDb;
  const memory = useLoad(`memory:${userId}`, () => loadMemoryOn(memoryDb, userId));
  const [memoryPicked, setMemoryPicked] = useState<boolean | null>(null);
  const [memoryNote, setMemoryNote] = useState<string | null>(null);
  const memoryOn = memoryPicked ?? memory.data;
  const pickMemory = async (on: boolean) => {
    if (on === memoryOn || !userId) return;
    setMemoryPicked(on);
    setMemoryNote(null);
    if (await saveMemoryOn(memoryDb, userId, on)) {
      memory.reload();
    } else {
      setMemoryPicked(null);
      setMemoryNote("That wasn't saved. Check your connection and try again.");
    }
  };
  const seeMemories = async () => {
    setMemoryNote(null);
    try {
      const found = memoriesSpace(await wilma.listSpaces());
      if (found) openSpace(found);
      else setMemoryNote('Your Memories space cannot be found right now.');
    } catch {
      setMemoryNote('Your memories cannot be read right now. Check your connection and try again.');
    }
  };

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

      {Platform.OS !== 'web' && (
        <>
          {heading('Theme')}
          <GroupList>
            {THEME_CHOICES.map((choice, i) => (
              <GroupRow
                key={choice.theme}
                first={i === 0}
                title={choice.title}
                checked={shownTheme === choice.theme}
                onPress={shownTheme ? () => void pickTheme(choice.theme) : undefined}
              />
            ))}
          </GroupList>
          <Muted>{themeNote ?? 'Kept on this phone. "Same as the phone" follows its dark mode.'}</Muted>
        </>
      )}

      {heading('Memory')}
      <GroupList>
        <GroupRow first title="On" checked={memoryOn === true} onPress={typeof memoryOn === 'boolean' ? () => void pickMemory(true) : undefined} />
        <GroupRow title="Off" checked={memoryOn === false} onPress={typeof memoryOn === 'boolean' ? () => void pickMemory(false) : undefined} />
        <GroupRow title="🧠 See what I remembered" onPress={() => void seeMemories()} />
      </GroupList>
      <Muted>
        {memoryNote ??
          (typeof memoryOn === 'boolean'
            ? 'With memory on, Wilma keeps lasting facts you mention and shows each under her reply, with Undo. Never passwords; health, money and other private topics only when you say “remember”. Turning it off keeps what she remembered.'
            : memory.loading
              ? 'Reading your setting…'
              : 'Your setting cannot be read right now.')}
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
        <GroupRow
          title="Morning briefing"
          subtitle={briefing.data ? briefingSummary(briefing.data) : undefined}
          onPress={() => router.push('/briefing')}
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
