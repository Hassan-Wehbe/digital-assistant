// Date night and Family day (planners step 3, docs/planners-plan.md; design D40; the mockups'
// "Date night" and "Family day" screens): one screen, two kinds (?kind=date or family).
//
// Date night: Kind (Dinner · Lunch · Coffee · Drinks · Something to do, owner 2026-10-19), When (any
// of the next seven days or a picked one, and a start time for that kind), Budget ($ · $$ · $$$),
// Mood (A favourite · Somewhere new). Family day: Day (as When), Who (adults and the children's
// ages, from Settings → Household when set; the names never leave the phone, Q4), Kind (Outdoors ·
// Indoors · Either). Fit around my calendar (on: the day's busy times, read on the phone as My day
// does, are planned around and never become steps; off: the calendar is not read). Then Plan it:
// the outing route (lib/outing.ts) makes one plan from the user's own saved places and the
// weather, with one AI request (Pro; counted, Q7).
//
// The plan card: its steps with times and drives, the weather, Add to calendar (one event with
// the steps in its notes, Q6; only on the tap), Open in Maps, the alternative ("Use this one"), and
// Another idea (a new plan without the places just shown). The plan lives only in this screen's
// memory (Mapbox's terms, as My day).
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { OutingPlanCard } from '@/components/OutingPlanCard';
import { Chips } from '@/components/PlaceFields';
import { ProCard, useProPlan } from '@/components/ProCard';
import { Button, Muted, space, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceCalendar, phoneTimeZone, readAgenda, timeText } from '@/lib/calendar';
import { loadChoice } from '@/lib/calendarSettings';
import { phoneGeocode, placeEvents, withKeys } from '@/lib/dayAgenda';
import { todayAndTomorrow } from '@/lib/dayView';
import { deviceDayMemory, deviceSettingsStore } from '@/lib/deviceStorage';
import { listMembers, type HouseholdDb } from '@/lib/household';
import { deviceGeocoder } from '@/lib/location';
import {
  avoidOf, clock, EMPTY_TEXT, nextDays, nextWeekday, occasionOf, OCCASIONS, PROBLEM_TEXT, whoFrom,
  type Occasion, type OutingBody, type OutingKind, type OutingPlan,
} from '@/lib/outing';
import { needsPro } from '@/lib/pro';
import { supabase } from '@/lib/supabase';
import { localParts, shortDay } from '@/lib/tasks';
import { WilmaError } from '@/lib/wilma';

type Shown =
  | { step: 'choose' }
  | { step: 'planning' }
  | { step: 'plan'; plan: OutingPlan }
  | { step: 'empty'; text: string }
  | { step: 'problem'; text: string };

export default function Outing() {
  const c = useColors();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind: OutingKind = params.kind === 'family' ? 'family' : 'date';
  const { session, outing, signOut } = useAuth();
  const userId = session?.user.id ?? '';
  const pro = useProPlan();
  const [today] = useState(() => todayAndTomorrow(new Date()).today);
  const thisYear = Number(today.slice(0, 4));

  // The choices (kept while the screen is open).
  const firstDay = kind === 'date' ? nextWeekday(today, 5) : nextWeekday(today, 6);
  const [day, setDay] = useState(firstDay);
  const [occasion, setOccasion] = useState<Occasion>('dinner');
  const [time, setTime] = useState('19:00');
  const [fitCalendar, setFitCalendar] = useState(true);
  const [budget, setBudget] = useState<1 | 2 | 3>(2);
  const [mood, setMood] = useState<'favourite' | 'new'>('favourite');
  const [setting, setSetting] = useState<'outdoor' | 'indoor' | 'either'>('either');
  const household = useLoad(`household:${userId}`, () => listMembers(supabase as unknown as HouseholdDb).catch(() => []));
  const [who, setWho] = useState<{ adults: number; child_ages: number[] } | null>(null);
  const shownWho = who ?? (household.data?.length ? whoFrom(household.data, thisYear) : { adults: 2, child_ages: [] });
  const [newAge, setNewAge] = useState('');

  const [shown, setShown] = useState<Shown>({ step: 'choose' });
  const [calendarNote, setCalendarNote] = useState<string | null>(null);

  if (pro !== undefined && needsPro(pro)) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: space.l }}>
        <Stack.Screen options={{ title: kind === 'date' ? 'Plan a date' : 'Family day' }} />
        <ProCard onNotNow={() => router.back()} />
      </View>
    );
  }

  /** The day's calendar, read on the phone as My day does; none when it is off or not to be fitted. */
  const dayEvents = async (): Promise<Record<string, unknown>[]> => {
    if (!fitCalendar) {
      setCalendarNote(null);
      return [];
    }
    const choice = await loadChoice(deviceSettingsStore, userId);
    const read = await readAgenda(deviceCalendar, choice, day, day, phoneTimeZone());
    if ('problem' in read) {
      setCalendarNote('Your calendar isn’t read (Settings → Calendars), so the plan can’t fit around it.');
      return [];
    }
    setCalendarNote(null);
    const memory = await deviceDayMemory.load(userId, today);
    const placed = await placeEvents(withKeys(read.agenda.events), memory, phoneGeocode(deviceGeocoder));
    return placed.events.map((e) => ({ ...e }));
  };

  const plan = async (avoid?: string[]) => {
    setShown({ step: 'planning' });
    try {
      const events = await dayEvents();
      const body: OutingBody = {
        mode: 'outing', kind, date: day, tz: phoneTimeZone() ?? 'UTC', now: timeText(new Date()), events,
        ...(kind === 'date'
          ? { occasion, start: time, budget, mood }
          : { setting, who: { adults: shownWho.adults, child_ages: shownWho.child_ages } }),
        ...(avoid?.length ? { avoid } : {}),
      };
      const out = await outing.plan(body);
      if ('plan' in out) setShown({ step: 'plan', plan: out.plan });
      else if ('empty' in out) setShown({ step: 'empty', text: EMPTY_TEXT[out.empty] });
      else if (out.problem === 'pro_required') router.replace('/pro');
      else setShown({ step: 'problem', text: PROBLEM_TEXT[out.problem] });
    } catch (e) {
      if (e instanceof WilmaError && e.signedOut) return void signOut();
      setShown({ step: 'problem', text: PROBLEM_TEXT.connection });
    }
  };

  const pickDay = () =>
    DateTimePickerAndroid.open({
      mode: 'date',
      value: new Date(`${day}T12:00:00`),
      minimumDate: new Date(`${today}T00:00:00`),
      onValueChange: (_e, picked) => picked && setDay(localParts(picked).day),
    });

  const label = (t: string) => <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{t}</Text>;
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card, width: 80 }];
  const dayChoices = nextDays(today);
  const dayLabel = (d: string) => {
    const s = shortDay(d, today);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const choices = (
    <View style={{ gap: space.s }}>
      {kind === 'date' ? (
        <>
          {label('KIND')}
          <Chips
            options={OCCASIONS.map((o) => ({ value: o.value, label: o.label }))}
            selected={(v) => v === occasion}
            onPress={(o) => {
              setOccasion(o);
              setTime(occasionOf(o).start);
            }}
          />
        </>
      ) : null}
      {label(kind === 'date' ? 'WHEN' : 'DAY')}
      <Chips
        options={[...dayChoices.map((d) => ({ value: d, label: dayLabel(d) })), ...(dayChoices.includes(day) ? [] : [{ value: day, label: dayLabel(day) }])]}
        selected={(v) => v === day}
        onPress={setDay}
      />
      {Platform.OS === 'android' ? <TextLink title="📅 Pick a later day" onPress={pickDay} /> : null}
      {kind === 'date' ? (
        <>
          <Chips options={occasionOf(occasion).times.map((t) => ({ value: t, label: clock(t) }))} selected={(v) => v === time} onPress={setTime} />
          {label('BUDGET')}
          <Chips options={[{ value: 1 as const, label: '$' }, { value: 2 as const, label: '$$' }, { value: 3 as const, label: '$$$' }]} selected={(v) => v === budget} onPress={setBudget} />
          {label('MOOD')}
          <Chips options={[{ value: 'favourite' as const, label: 'A favourite' }, { value: 'new' as const, label: 'Somewhere new' }]} selected={(v) => v === mood} onPress={setMood} />
        </>
      ) : (
        <>
          {label('WHO')}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ color: c.text, fontSize: 15 }}>{`Adults: ${shownWho.adults}`}</Text>
            <TextLink title="−" accessibilityLabel="One adult fewer" onPress={() => setWho({ ...shownWho, adults: Math.max(0, shownWho.adults - 1) })} />
            <TextLink title="＋" accessibilityLabel="One adult more" onPress={() => setWho({ ...shownWho, adults: Math.min(10, shownWho.adults + 1) })} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
            <Text style={{ color: c.text, fontSize: 15 }}>Kids’ ages:</Text>
            {shownWho.child_ages.map((a, i) => (
              <TextLink
                key={`${i}-${a}`}
                title={`${a} ✕`}
                accessibilityLabel={`Take out the child aged ${a}`}
                onPress={() => setWho({ ...shownWho, child_ages: shownWho.child_ages.filter((_, j) => j !== i) })}
              />
            ))}
            {shownWho.child_ages.length < 10 ? (
              <>
                <TextInput style={input} placeholder="age" placeholderTextColor={c.muted} keyboardType="number-pad" maxLength={2} value={newAge} onChangeText={(t) => setNewAge(t.replace(/\D/g, ''))} accessibilityLabel="A child's age" />
                <TextLink
                  title="Add"
                  onPress={() => {
                    const n = Number(newAge);
                    if (newAge && n <= 17) setWho({ ...shownWho, child_ages: [...shownWho.child_ages, n] });
                    setNewAge('');
                  }}
                />
              </>
            ) : null}
          </View>
          <Muted>{household.data?.length ? 'From Settings → Household. Change it for this plan here.' : 'Set your household once in Settings → Household.'} Only ages are used, never names.</Muted>
          {label('KIND')}
          <Chips
            options={[{ value: 'outdoor' as const, label: 'Outdoors' }, { value: 'indoor' as const, label: 'Indoors' }, { value: 'either' as const, label: 'Either' }]}
            selected={(v) => v === setting}
            onPress={setSetting}
          />
        </>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>Fit around my calendar</Text>
        <Switch value={fitCalendar} onValueChange={setFitCalendar} accessibilityLabel="Fit around my calendar" />
      </View>
      <Muted>{fitCalendar ? 'Your events are left as they are: Wilma plans in the free time around them.' : 'Your calendar is not read for this plan.'}</Muted>
      <Button title={shown.step === 'planning' ? 'Planning…' : 'Plan it'} disabled={shown.step === 'planning'} onPress={() => void plan()} />
      <Muted>From your saved places, with drive times from home and the weather. Uses one AI request.</Muted>
    </View>
  );

  const card = (p: OutingPlan) => (
    <View style={{ gap: space.m }}>
      <OutingPlanCard key={avoidOf(p).join() + p.title} plan={p} today={today} />
      <Button title="Another idea" kind="plain" onPress={() => void plan(avoidOf(p))} />
      <TextLink title="Change the choices" onPress={() => setShown({ step: 'choose' })} />
      <Muted>Not saved anywhere: add it to your calendar to keep it.</Muted>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: kind === 'date' ? 'Plan a date' : 'Family day' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.m }]} keyboardShouldPersistTaps="handled">
        {shown.step === 'plan' ? card(shown.plan) : choices}
        {calendarNote ? <Muted>{calendarNote}</Muted> : null}
        {shown.step === 'empty' || shown.step === 'problem' ? <Text style={{ color: shown.step === 'problem' ? c.danger : c.text, fontSize: 15 }}>{shown.text}</Text> : null}
      </ScrollView>
    </>
  );
}
