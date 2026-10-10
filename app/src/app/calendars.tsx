// Settings → Calendars (day planner step 1, docs/phase6-day-planner-step1-plan.md): "Use my
// calendar" asks for the calendar permission only when tapped, then lists the phone's calendars,
// all ticked (Q2); the user unticks what Wilma must not read. Turn off at any time. Which calendars
// are ticked is kept on this phone only (calendarSettings.ts); no event is read on this screen.
import { useState } from 'react';
import { Linking, ScrollView, Text } from 'react-native';

import { Button, Card, GroupList, GroupRow, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceCalendar, listCalendars, NO_PERMISSION, turnOn, type CalendarChoice, type PhoneCalendar } from '@/lib/calendar';
import { loadChoice, OFF, saveChoice, toggleCalendar } from '@/lib/calendarSettings';
import { deviceSettingsStore } from '@/lib/deviceStorage';

const NOT_SAVED = "That wasn't saved on this phone. Try again.";

export default function Calendars() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const saved = useLoad(`calendars:${userId}`, () => loadChoice(deviceSettingsStore, userId));
  // What was just changed on this screen, shown at once (the saved choice is read once).
  const [changed, setChanged] = useState<CalendarChoice | null>(null);
  const choice = changed ?? saved.data;
  // The phone's calendars, read when the choice is on (turning on lists them itself).
  const listed = useLoad(`calendar-list:${userId}:${saved.data?.on === true}`, async () =>
    saved.data?.on ? listCalendars(deviceCalendar) : null,
  );
  // Back from the phone's settings (the permission allowed there): read them again.
  useReloadOnReturn(listed.reload);
  const [fresh, setFresh] = useState<PhoneCalendar[] | null>(null);
  const calendars = choice?.on ? (fresh ?? (listed.data && 'calendars' in listed.data ? listed.data.calendars : null)) : null;
  const [problem, setProblem] = useState<string | null>(null);
  const shownProblem = problem ?? (choice?.on && listed.data && 'error' in listed.data ? listed.data.error : null);
  const [busy, setBusy] = useState(false);

  const save = async (next: CalendarChoice) => {
    if (await saveChoice(deviceSettingsStore, userId, next)) {
      setChanged(next);
      setProblem(null);
      return true;
    }
    setProblem(NOT_SAVED);
    return false;
  };

  const switchOn = async () => {
    setBusy(true);
    setProblem(null);
    const out = await turnOn(deviceCalendar);
    setBusy(false);
    if ('error' in out) return setProblem(out.error);
    if (await save(out.choice)) setFresh(out.calendars);
  };

  const switchOff = async () => {
    if (await save(OFF)) setFresh(null);
  };

  const heading = (title: string) => <Text style={[styles.title, { color: c.text }]}>{title}</Text>;

  if (!choice) return <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list}><Muted>Reading your setting…</Muted></ScrollView>;

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
      <Card>
        <Text style={[styles.body, { color: c.text }]}>
          Ask Wilma “what’s on my day?” or “am I free Friday at 3?”, and she answers from your phone’s calendar.
        </Text>
        <Muted>
          Wilma reads the calendars you choose, only when you ask about your day (or, with the morning briefing on, when it is made), and sends the titles, times and places
          needed for that answer to her AI provider. Never descriptions, attendees or meeting links; private events only
          as “Busy”. Nothing is stored, and your calendar is never changed.
        </Muted>
      </Card>

      {choice.on ? (
        <>
          {heading('Calendars Wilma may read')}
          {calendars ? (
            calendars.length ? (
              <GroupList>
                {calendars.map((cal, i) => (
                  <GroupRow
                    key={cal.id}
                    first={i === 0}
                    title={cal.title}
                    subtitle={cal.account ?? undefined}
                    checked={choice.ticked.includes(cal.id)}
                    onPress={() => void save(toggleCalendar(choice, cal.id))}
                  />
                ))}
              </GroupList>
            ) : (
              <Muted>There are no calendars on this phone.</Muted>
            )
          ) : shownProblem ? null : (
            <Muted>Reading your calendars…</Muted>
          )}
          {calendars && choice.ticked.length === 0 ? <Muted>No calendar is ticked, so Wilma reads none.</Muted> : null}
          <Muted>Don’t see a calendar? Add the account in your phone’s settings.</Muted>
          <Button title="Turn off" kind="plain" onPress={() => void switchOff()} />
        </>
      ) : (
        <Button title={busy ? 'Asking your phone…' : 'Use my calendar'} onPress={() => void switchOn()} disabled={busy} />
      )}

      {shownProblem ? (
        <Card>
          <Text style={{ color: c.danger, fontSize: 15 }}>{shownProblem}</Text>
          {shownProblem === NO_PERMISSION ? <Button title="Open phone settings" kind="plain" onPress={() => void Linking.openSettings().catch(() => {})} /> : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}
