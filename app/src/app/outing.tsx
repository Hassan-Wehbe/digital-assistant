// Date night and Family day (planners step 3, docs/planners-plan.md; design D40; the mockups'
// "Date night" and "Family day" screens): one screen, two kinds (?kind=date or family).
//
// Date night: When (this Friday or Saturday, 7 pm, or another day and time), Budget ($ · $$ · $$$),
// Mood (A favourite · Somewhere new). Family day: Day (Saturday, Sunday or another), Who (adults and
// the children's ages, from Settings → Household when set; the names never leave the phone, Q4),
// Kind (Outdoors · Indoors · Either). Then Plan it: the outing route (lib/outing.ts) makes one
// plan from the user's own saved places, around the day's calendar (read on the phone, as My day
// does) and the weather, with one AI request (Pro; counted, Q7).
//
// The plan card: its steps with times and drives, the weather, Add to calendar (one event with
// the steps in its notes, Q6; only on the tap), Open in Maps, the alternative ("Use this one"), and
// Another idea (a new plan without the places just shown). The plan lives only in this screen's
// memory (Mapbox's terms, as My day).
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/PlaceFields';
import { ProCard, useProPlan } from '@/components/ProCard';
import { Badge, Button, Card, Muted, space, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addEvent, defaultTarget, deviceCalendar, phoneTimeZone, readAgenda, timeText } from '@/lib/calendar';
import { loadChoice } from '@/lib/calendarSettings';
import { phoneGeocode, placeEvents, withKeys } from '@/lib/dayAgenda';
import { todayAndTomorrow } from '@/lib/dayView';
import { deviceDayMemory, deviceSettingsStore } from '@/lib/deviceStorage';
import { listMembers, type HouseholdDb } from '@/lib/household';
import { deviceGeocoder } from '@/lib/location';
import {
  avoidOf, clock, EMPTY_TEXT, nextWeekday, planEvent, PROBLEM_TEXT, rainLine, stepDetail, withAlternative, whoFrom,
  type OutingBody, type OutingKind, type OutingPlan,
} from '@/lib/outing';
import { mapsLink } from '@/lib/places';
import { needsPro } from '@/lib/pro';
import { supabase } from '@/lib/supabase';
import { localParts, shortDay } from '@/lib/tasks';
import { WilmaError } from '@/lib/wilma';

type Shown =
  | { step: 'choose' }
  | { step: 'planning' }
  | { step: 'plan'; plan: OutingPlan; added?: string; addProblem?: string }
  | { step: 'empty'; text: string }
  | { step: 'problem'; text: string };

const TIMES = ['18:00', '19:00', '20:00'];

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
  const [time, setTime] = useState('19:00');
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
        <Stack.Screen options={{ title: kind === 'date' ? 'Date night' : 'Family day' }} />
        <ProCard onNotNow={() => router.back()} />
      </View>
    );
  }

  /** The day's calendar, read on the phone as My day does; none when the calendar is off. */
  const dayEvents = async (): Promise<Record<string, unknown>[]> => {
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
          ? { start: time, budget, mood }
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

  const addToCalendar = async (p: OutingPlan) => {
    const choice = await loadChoice(deviceSettingsStore, userId);
    const target = defaultTarget(await deviceCalendar.calendars().catch(() => []), choice);
    if (!target) return setShown({ step: 'plan', plan: p, addProblem: 'Turn on Use my calendar in Settings → Calendars and tick a calendar Wilma may add to.' });
    const out = await addEvent(deviceCalendar, choice, target.id, planEvent(p), new Date());
    setShown('added' in out ? { step: 'plan', plan: p, added: `Added to ${out.added.calendar}.` } : { step: 'plan', plan: p, addProblem: out.problem });
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
  const dayChoices = (kind === 'date' ? [5, 6] : [6, 0]).map((d) => nextWeekday(today, d));

  const choices = (
    <View style={{ gap: space.s }}>
      {label(kind === 'date' ? 'WHEN' : 'DAY')}
      <Chips
        options={[...dayChoices.map((d) => ({ value: d, label: shortDay(d, today) })), ...(dayChoices.includes(day) ? [] : [{ value: day, label: shortDay(day, today) }])]}
        selected={(v) => v === day}
        onPress={setDay}
      />
      {Platform.OS === 'android' ? <TextLink title="📅 Pick another day" onPress={pickDay} /> : null}
      {kind === 'date' ? (
        <>
          <Chips options={TIMES.map((t) => ({ value: t, label: clock(t) }))} selected={(v) => v === time} onPress={setTime} />
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
      <Button title={shown.step === 'planning' ? 'Planning…' : 'Plan it'} disabled={shown.step === 'planning'} onPress={() => void plan()} />
      <Muted>From your saved places, with drive times from home and the weather. Uses one AI request.</Muted>
    </View>
  );

  const card = (p: OutingPlan, added?: string, addProblem?: string) => {
    const firstPlace = p.steps.find((s) => s.place)?.place;
    const maps = firstPlace ? firstPlace.maps_url ?? mapsLink({ lat: firstPlace.lat, lng: firstPlace.lng }) : null;
    const weather = rainLine(p);
    return (
      <View style={{ gap: space.m }}>
        <Card style={{ gap: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <Text style={[styles.title, { color: c.text, flex: 1 }]}>{p.title}</Text>
            <Badge text="BEST FIT" />
          </View>
          <Muted>{shortDay(p.date, today)}</Muted>
          {p.leave_at ? <Text style={{ color: c.muted, fontSize: 14 }}>{`${clock(p.leave_at)}  Leave ${p.from}`}</Text> : null}
          {p.steps.map((s, i) => (
            <View key={`${i}-${s.start}`} style={{ flexDirection: 'row', gap: space.m }}>
              <Text style={{ width: 64, color: c.accent, fontSize: 14, fontWeight: '600' }}>{clock(s.start)}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{s.place?.title ?? s.event?.title ?? 'Home'}</Text>
                {stepDetail(s) ? <Muted>{stepDetail(s)}</Muted> : null}
                {s.line ? <Text style={{ color: c.text, fontSize: 14 }}>{s.line}</Text> : null}
              </View>
            </View>
          ))}
          {p.back_home_min !== undefined ? <Muted>{`Home again: ${p.back_home_min} min drive`}</Muted> : null}
          {weather ? <Text style={{ color: c.rain, fontSize: 13 }}>{weather}</Text> : null}
          {added ? <Text style={{ color: c.good, fontSize: 14 }}>{`✓ ${added}`}</Text> : null}
          {addProblem ? <Text style={{ color: c.danger, fontSize: 14 }}>{addProblem}</Text> : null}
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            {!added ? <Button title="Add to calendar" onPress={() => void addToCalendar(p)} /> : null}
            {maps ? <Button title="Open in Maps" kind="plain" onPress={() => void Linking.openURL(maps).catch(() => {})} /> : null}
          </View>
          {p.credits.length ? <Muted>{p.credits.join(' · ')}</Muted> : null}
        </Card>
        {p.alternative ? (
          <Card style={{ gap: space.xs }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{kind === 'date' ? 'Somewhere else' : 'Another place'}</Text>
            <Text style={{ color: c.text, fontSize: 14 }}>{`${p.alternative.place.title}${p.alternative.minutes !== undefined ? ` · ${p.alternative.minutes} min` : ''}`}</Text>
            {p.alternative.line ? <Muted>{p.alternative.line}</Muted> : null}
            <TextLink title="Use this one" onPress={() => setShown({ step: 'plan', plan: withAlternative(p) })} />
          </Card>
        ) : null}
        <Button title="Another idea" kind="plain" onPress={() => void plan(avoidOf(p))} />
        <TextLink title="Change the choices" onPress={() => setShown({ step: 'choose' })} />
        <Muted>Not saved anywhere: add it to your calendar to keep it.</Muted>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: kind === 'date' ? 'Date night' : 'Family day' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.m }]} keyboardShouldPersistTaps="handled">
        {shown.step === 'plan' ? card(shown.plan, shown.added, shown.addProblem) : choices}
        {calendarNote ? <Muted>{calendarNote}</Muted> : null}
        {shown.step === 'empty' || shown.step === 'problem' ? <Text style={{ color: shown.step === 'problem' ? c.danger : c.text, fontSize: 15 }}>{shown.text}</Text> : null}
      </ScrollView>
    </>
  );
}
