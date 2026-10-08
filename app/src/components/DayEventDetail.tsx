// One event in My day (mockups screen 3): the sum behind its leave-by time, the hourly chance of
// rain at its place, Not driving and Directions. Every number comes from the planner (dayView.ts
// eventDetail); the plan stays in the My day screen's memory.
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import type { DayPlan } from '@/lib/dayPlan';
import { clock, eventDetail, eventLine, titles } from '@/lib/dayView';

import { Button, Card, Muted, space, styles, TextLink, useColors } from './ui';

export function DayEventDetail({
  plan,
  eventKey,
  notDriving,
  answered,
  canDirections,
  checkedAt,
  picker,
  onBack,
  onToggleDriving,
  onDirections,
  onChangePlace,
  onForget,
}: {
  plan: DayPlan;
  eventKey: string;
  notDriving: boolean;
  /** The user answered "where is this?" for this title (Forget my answer shows). */
  answered: boolean;
  canDirections: boolean;
  checkedAt: string | null;
  /** The place picker, when "Change the place" is open. */
  picker: ReactNode;
  onBack: () => void;
  onToggleDriving: () => void;
  onDirections: () => void;
  onChangePlace: () => void;
  onForget: () => void;
}) {
  const c = useColors();
  const d = eventDetail(plan, eventKey, notDriving);
  if (!d) return <TextLink title="‹ My day" onPress={onBack} />;
  const e = d.event;
  const row = (label: string, value: string, first = false, strong = false) => (
    <View
      key={label}
      style={{ flexDirection: 'row', justifyContent: 'space-between', padding: space.m, ...(first ? {} : { borderTopWidth: 1, borderTopColor: c.line }) }}>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: strong ? '700' : '400' }}>{label}</Text>
      <Text style={{ color: strong ? c.accent : c.text, fontSize: 15, fontWeight: strong ? '700' : '400' }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ gap: space.m }}>
      <TextLink title="‹ My day" onPress={onBack} />
      <Card>
        <Text style={[styles.title, { color: c.text }]}>{e.title}</Text>
        <Muted>{eventLine(e, titles(plan))}</Muted>
        {e.place ? <Text style={{ color: c.text, fontSize: 15 }}>{`📍 ${e.place}${e.by_name_only ? ' (found by name)' : ''}`}</Text> : null}
      </Card>
      {d.drive ? (
        <View style={{ borderWidth: 1, borderRadius: 12, borderColor: c.line, backgroundColor: c.card }}>
          {row(`Drive from ${d.drive.from}`, `${d.drive.minutes} min`, true)}
          {d.drive.typical !== undefined ? row('Usually at this time', `${d.drive.typical} min`) : null}
          {d.drive.buffer ? row('Park and walk in', `${d.drive.buffer} min`) : null}
          {row('Leave by', clock(d.drive.leaveAt), false, true)}
        </View>
      ) : d.notDriving ? (
        <Muted>You are not driving to this one today.</Muted>
      ) : d.noDrive ? (
        <Muted>{d.noDrive}</Muted>
      ) : null}
      {d.rain.length ? (
        <View style={{ gap: space.s }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>RAIN CHANCE THERE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {d.rain.map((h) => (
              <View
                key={h.hour}
                style={{ minWidth: 64, alignItems: 'center', borderWidth: 1, borderRadius: 8, padding: space.xs, borderColor: h.high ? c.rain : c.line, backgroundColor: c.card }}>
                <Text style={{ color: h.high ? c.rain : c.text, fontSize: 12 }}>{h.hour}</Text>
                <Text style={{ color: h.high ? c.rain : c.text, fontSize: 13, fontWeight: h.high ? '700' : '400' }}>{`${h.pct}%`}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {plan.credits.length ? <Muted>{`${plan.credits.join('. ')}.${checkedAt ? ` Checked at ${checkedAt}.` : ''}`}</Muted> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.s }}>
        {e.place || d.drive || d.notDriving ? <Button title={d.notDriving ? 'I’m driving' : 'Not driving'} kind="plain" onPress={onToggleDriving} /> : null}
        {canDirections ? <Button title="Directions" onPress={onDirections} /> : null}
      </View>
      <View style={{ gap: space.s }}>
        {picker ?? <TextLink title="📍 Change the place" onPress={onChangePlace} />}
        {answered ? <TextLink title="Forget my answer for this event" onPress={onForget} /> : null}
      </View>
    </View>
  );
}
