// The one-time age question on Home (docs/age-plan.md step 3, D44, Q6) for accounts made before the
// month and year of birth were asked at sign-up. Until it is answered, drinks are mocktails only.
// Not now hides it until the app is opened again; Settings → Account asks the same. The month and
// year go to the server once (set_birth_month), which keeps only the result; nothing is kept here.
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BirthMonthFields } from '@/components/BirthMonthFields';
import { setAgeStatus, useAge } from '@/components/useAge';
import { giveBirthMonth } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button, Card, Muted, space, styles, useColors } from './ui';

/** Not now: until the app is opened again. */
let notNow = false;

export function AgeCard() {
  const { status } = useAge();
  const [hidden, setHidden] = useState(notNow);
  if (!status || status.asked || hidden) return null;
  return (
    <AgeQuestion
      onDone={() => setHidden(true)}
      onNotNow={() => {
        notNow = true;
        setHidden(true);
      }}
    />
  );
}

/** The question itself: on Home's card and in Settings → Account. */
export function AgeQuestion({ onDone, onNotNow }: { onDone?: () => void; onNotNow?: () => void }) {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [month, setMonth] = useState<number | null>(null);
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setNote(null);
    const out = await giveBirthMonth((fn, args) => supabase.rpc(fn, args), month, year, new Date());
    setBusy(false);
    if ('error' in out) return setNote(out.error);
    setMonth(null);
    setYear('');
    setAgeStatus(userId, out.status);
    onDone?.();
  };
  return (
    <Card style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>🎂 What’s your month and year of birth?</Text>
      <Muted>Wilma uses it for age-limited parts like cocktails. It’s asked once and can’t be changed in the app.</Muted>
      <BirthMonthFields month={month} year={year} onMonth={setMonth} onYear={setYear} disabled={busy} />
      {note ? <Text style={{ color: c.danger, fontSize: 15 }}>{note}</Text> : null}
      <View style={{ gap: space.s }}>
        <Button title={busy ? 'Saving…' : 'Save'} onPress={() => void save()} disabled={busy} />
        {onNotNow ? <Button title="Not now" kind="plain" onPress={onNotNow} disabled={busy} /> : null}
      </View>
    </Card>
  );
}
