// A Date night or Family day plan (D40, docs/planners-plan.md steps 3 and 4): the plan card on the
// Date night / Family day screen (app/outing.tsx) and in the chat (plan_outing). Its steps with
// times and drives, the weather, Add to calendar (one event with the steps in its notes, Q6; only on
// the tap, through the same checks and calendar as the 📅 card), Open in Maps, the alternative
// (Use this one), and the busy times it went around (the calendar's events are never steps). The plan is only in memory: the chat never saves it (chatStore keeps no outing).
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Badge, Button, Card, Muted, space, styles, TextLink, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addEvent, defaultTarget, deviceCalendar } from '@/lib/calendar';
import { loadChoice } from '@/lib/calendarSettings';
import { deviceSettingsStore } from '@/lib/deviceStorage';
import { aroundLine, clock, planEvent, rainLine, stepDetail, withAlternative, type OutingPlan } from '@/lib/outing';
import { mapsLink } from '@/lib/places';
import { shortDay } from '@/lib/tasks';

export function OutingPlanCard({ plan: first, today }: { plan: OutingPlan; today: string }) {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [plan, setPlan] = useState(first);
  const [added, setAdded] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addToCalendar = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const choice = await loadChoice(deviceSettingsStore, userId);
      const target = defaultTarget(await deviceCalendar.calendars().catch(() => []), choice);
      if (!target) return setProblem('Turn on Use my calendar in Settings → Calendars and tick a calendar Wilma may add to.');
      const out = await addEvent(deviceCalendar, choice, target.id, planEvent(plan), new Date());
      if ('added' in out) setAdded(`Added to ${out.added.calendar}.`);
      else setProblem(out.problem);
    } finally {
      setBusy(false);
    }
  };

  const firstPlace = plan.steps.find((s) => s.place)?.place;
  const maps = firstPlace ? firstPlace.maps_url ?? mapsLink({ lat: firstPlace.lat, lng: firstPlace.lng }) : null;
  const weather = rainLine(plan);
  const around = aroundLine(plan);
  return (
    <View style={{ gap: space.m }}>
      <Card style={{ gap: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text style={[styles.title, { color: c.text, flex: 1 }]}>{plan.title}</Text>
          <Badge text="BEST FIT" />
        </View>
        <Muted>{shortDay(plan.date, today)}</Muted>
        {plan.leave_at ? <Text style={{ color: c.muted, fontSize: 14 }}>{`${clock(plan.leave_at)}  Leave ${plan.from}`}</Text> : null}
        {plan.steps.map((s, i) => (
          <View key={`${i}-${s.start}`} style={{ flexDirection: 'row', gap: space.m }}>
            <Text style={{ width: 64, color: c.accent, fontSize: 14, fontWeight: '600' }}>{clock(s.start)}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{s.place?.title ?? 'Home'}</Text>
              {stepDetail(s) ? <Muted>{stepDetail(s)}</Muted> : null}
              {s.line ? <Text style={{ color: c.text, fontSize: 14 }}>{s.line}</Text> : null}
            </View>
          </View>
        ))}
        {plan.back_home_min !== undefined ? <Muted>{`Home again: ${plan.back_home_min} min drive`}</Muted> : null}
        {weather ? <Text style={{ color: c.rain, fontSize: 13 }}>{weather}</Text> : null}
        {around ? <Muted>{around}</Muted> : null}
        {added ? <Text style={{ color: c.good, fontSize: 14 }}>{`✓ ${added}`}</Text> : null}
        {problem ? <Text style={{ color: c.danger, fontSize: 14 }}>{problem}</Text> : null}
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          {!added ? <Button title={busy ? 'Adding…' : 'Add to calendar'} disabled={busy} onPress={() => void addToCalendar()} /> : null}
          {maps ? <Button title="Open in Maps" kind="plain" onPress={() => void Linking.openURL(maps).catch(() => {})} /> : null}
        </View>
        {plan.credits.length ? <Muted>{plan.credits.join(' · ')}</Muted> : null}
      </Card>
      {plan.alternative ? (
        <Card style={{ gap: space.xs }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{plan.kind === 'date' ? 'Somewhere else' : 'Another place'}</Text>
          <Text style={{ color: c.text, fontSize: 14 }}>{`${plan.alternative.place.title}${plan.alternative.minutes !== undefined ? ` · ${plan.alternative.minutes} min` : ''}`}</Text>
          {plan.alternative.line ? <Muted>{plan.alternative.line}</Muted> : null}
          <TextLink
            title="Use this one"
            onPress={() => {
              setPlan(withAlternative(plan));
              setAdded(null);
            }}
          />
        </Card>
      ) : null}
    </View>
  );
}
