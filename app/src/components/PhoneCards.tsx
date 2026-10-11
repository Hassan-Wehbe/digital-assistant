// Alarm, reminder and calendar cards in the chat (docs/alarms-calendar-plan.md steps 2 and 3,
// design D31). Nothing happens until the user taps (owner: a card to confirm, on everything):
//
//   ⏰ alarm      Set in Clock → the Clock's own set-alarm screen, filled in; then Open Clock
//   ⏰ alarms     Open Clock (alarms are seen, changed and cancelled there; Wilma cannot)
//   🔔 reminder   Set reminder → a Wilma notification at that time; then Cancel
//   🔔 reminders  this phone's matching reminders, each with Cancel (matched here: the model never
//                 sees them)
//   📅 event      title, day, start, end and place editable, the calendar shown and changeable;
//                 Add to calendar → one new event (calendar.ts addEvent); then Added · Open in
//                 Calendar. Never changed or deleted afterwards (Q6).
//
// Reminders are kept only in this phone's notification schedule, for this account; signing out
// cancels them (notifications.ts forgetOtherAccounts).
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Text, TextInput, View } from 'react-native';

import { ChatCard, ChatCardDone, ChatCardText } from '@/components/ChatCard';
import { Chips } from '@/components/PlaceFields';
import { Button, Muted, space, styles, TextLink, useColors, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  ADD_FAILED, addEvent, type CalendarChoice, defaultTarget, deviceCalendar, listCalendars, NO_PERMISSION, openEvent, type PhoneCalendar,
  phoneTimeZone, readAgenda, writableCalendars,
} from '@/lib/calendar';
import { loadChoice } from '@/lib/calendarSettings';
import type { Entry, EventAdded } from '@/lib/chatThread';
import { clockAvailable, openAlarms, openSetAlarm } from '@/lib/deviceClock';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { deviceSettingsStore } from '@/lib/deviceStorage';
import { cancelReminder, listReminders, setReminder } from '@/lib/notifications';
import {
  alarmCardText, type EventCardData, eventCardText, eventProblem, MAX_EVENT_PLACE, MAX_EVENT_TITLE, matchReminders, moveEnd,
  moveStart, moveToDay, overlapLine, reminderCardText, reminderNote, reminderProblem, type ReminderRow, reminderWhen,
} from '@/lib/phoneActions';
import { localParts } from '@/lib/tasks';

const NO_CLOCK = 'Your phone’s Clock app didn’t open. Set it there yourself.';
const ANDROID_ONLY = 'Alarms open your phone’s Clock app; that works on Android only.';
const DENIED = 'Wilma isn’t allowed to show notifications. Turn them on in your phone’s Settings → Apps → Wilma → Notifications, then try again.';

export function AlarmCard({ entry }: { entry: Extract<Entry, { kind: 'alarm' }> }) {
  const c = useColors();
  const [state, setState] = useState<'ready' | 'opening' | 'opened' | 'failed'>('ready');
  if (!clockAvailable) return <ChatCardDone icon="⏰" text={ANDROID_ONLY} />;
  const words = alarmCardText(entry, new Date());
  const set = async () => {
    setState('opening');
    setState((await openSetAlarm(entry)) ? 'opened' : 'failed');
  };
  if (state === 'opened') {
    return (
      <ChatCard icon="⏰" actions={<Button title="Open Clock" kind="plain" onPress={() => void openAlarms()} />}>
        <ChatCardText>{`${words.title}: save it in your Clock. To change or cancel it later, open the Clock.`}</ChatCardText>
      </ChatCard>
    );
  }
  return (
    <ChatCard icon="⏰" actions={<Button title={state === 'opening' ? 'Opening the Clock…' : 'Set in Clock'} onPress={() => void set()} disabled={state === 'opening'} />}>
      <ChatCardText>{words.title}</ChatCardText>
      {words.detail ? <Muted>{words.detail}</Muted> : null}
      {state === 'failed' ? <Text style={{ color: c.warn, fontSize: 15 }}>{NO_CLOCK}</Text> : null}
    </ChatCard>
  );
}

export function AlarmsCard() {
  if (!clockAvailable) return <ChatCardDone icon="⏰" text={ANDROID_ONLY} />;
  return (
    <ChatCard icon="⏰" actions={<Button title="Open Clock" onPress={() => void openAlarms()} />}>
      <ChatCardText>Your alarms are in your phone’s Clock app; change or cancel them there.</ChatCardText>
    </ChatCard>
  );
}

export function ReminderCard({ entry }: { entry: Extract<Entry, { kind: 'reminder' }> }) {
  const c = useColors();
  const userId = useAuth().session?.user.id ?? null;
  const note = reminderNote(entry, `c${entry.id}`);
  const [state, setState] = useState<'checking' | 'ready' | 'busy' | 'set' | 'cancelled'>(userId && note ? 'checking' : 'ready');
  const [error, setError] = useState<string | null>(null);

  // Already set from this card (the chat was reopened): show it as set.
  useEffect(() => {
    let live = true;
    if (!userId || !note) return;
    listReminders(deviceNotifier, userId)
      .then((rows) => live && setState(rows.some((r) => r.id === note.id) ? 'set' : 'ready'))
      .catch(() => live && setState('ready'));
    return () => {
      live = false;
    };
  }, [userId, note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = reminderCardText(entry, new Date());
  if (state === 'cancelled') return <ChatCardDone icon="🔔" text={`Cancelled: ${words}`} />;
  if (state === 'set') {
    return (
      <ChatCard icon="🔔" actions={<TextLink title="Cancel reminder" onPress={() => void cancel()} />}>
        <ChatCardText>{`Reminder set: ${words}`}</ChatCardText>
      </ChatCard>
    );
  }
  const problem = reminderProblem(entry, new Date());
  if (problem && state === 'ready') return <ChatCardDone icon="🔔" text={`${words}. ${problem}`} />;

  async function set() {
    if (!userId || !note) return;
    setState('busy');
    setError(null);
    const out = await setReminder(deviceNotifier, userId, note);
    if (out === 'set') setState('set');
    else {
      setState('ready');
      setError(out === 'denied' ? DENIED : 'The reminder could not be set. Try again.');
    }
  }
  async function cancel() {
    if (note && (await cancelReminder(deviceNotifier, note.id))) setState('cancelled');
  }

  return (
    <ChatCard
      icon="🔔"
      actions={<Button title={state === 'busy' ? 'Setting…' : 'Set reminder'} onPress={() => void set()} disabled={state !== 'ready' || !userId} />}>
      <ChatCardText>{words}</ChatCardText>
      <Muted>A Wilma notification on this phone at that time.</Muted>
      {error ? <Text style={{ color: c.warn, fontSize: 15 }}>{error}</Text> : null}
    </ChatCard>
  );
}

/** "Cancel my reminder to call Sam" / "what reminders do I have?": this phone's reminders, matched here. */
export function RemindersCard({ entry }: { entry: Extract<Entry, { kind: 'reminders' }> }) {
  const userId = useAuth().session?.user.id ?? null;
  const [rows, setRows] = useState<ReminderRow[] | null>(userId ? null : []);
  const [gone, setGone] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    if (!userId) return;
    listReminders(deviceNotifier, userId)
      .then((all) => live && setRows(matchReminders(all, entry.about, new Date())))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [userId, entry.about]);

  if (rows === null) return <ChatCardDone icon="🔔" text="Looking at your reminders…" />;
  const now = new Date();
  const left = rows.filter((r) => !gone.has(r.id));
  const cancel = async (id: string) => {
    if (await cancelReminder(deviceNotifier, id)) setGone(new Set([...gone, id]));
  };
  return (
    <ChatCard icon="🔔" actions={<TextLink title="All reminders" onPress={() => router.push('/reminders')} />}>
      {!rows.length ? (
        <ChatCardText>{entry.about ? `No reminder about “${entry.about}” on this phone.` : 'No reminders set on this phone.'}</ChatCardText>
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map((r) => (
            <View key={r.id} style={{ gap: 2 }}>
              <ChatCardText>{`${reminderWhen(r.at, now)}: ${r.text}`}</ChatCardText>
              {gone.has(r.id) ? <Muted>Cancelled</Muted> : <TextLink title="Cancel" onPress={() => void cancel(r.id)} />}
            </View>
          ))}
          {!left.length && rows.length ? <Muted>All cancelled.</Muted> : null}
        </View>
      )}
    </ChatCard>
  );
}

// ---- 📅 Calendar entry -------------------------------------------------------------------------

const CALENDAR_ANDROID_ONLY = 'Adding to your calendar works in the Android app only.';
const NO_WRITABLE = 'None of the calendars ticked in Settings → Calendars lets apps add events. Tick one there.';

/** What the card needs from Settings → Calendars and the phone, read when it is shown. */
type CalendarSetup =
  | { state: 'reading' }
  | { state: 'off' | 'permission' | 'failed' | 'none' }
  | { state: 'ready'; choice: CalendarChoice; calendars: PhoneCalendar[] };

/** The phone's own date or time picker, starting at `local` ("2026-10-14T15:00" or a day). */
function pick(mode: 'date' | 'time', local: string, onPick: (picked: { day: string; time: string }) => void) {
  const [y, mo, d] = local.slice(0, 10).split('-').map(Number);
  const [h, mi] = (local.slice(11) || '12:00').split(':').map(Number);
  DateTimePickerAndroid.open({
    mode,
    value: new Date(y, mo - 1, d, h, mi),
    onValueChange: (_event, date) => {
      if (date) onPick(localParts(date));
    },
  });
}

export function EventCard({
  entry,
  onAdded,
}: {
  entry: Extract<Entry, { kind: 'event' }>;
  /** Add to calendar worked: keep it in the thread (what was added, and where). */
  onAdded: (added: EventAdded, event: EventCardData) => void;
}) {
  const c = useColors();
  const userId = useAuth().session?.user.id ?? '';
  const [draft, setDraft] = useState<EventCardData>(() => ({
    title: entry.title,
    start: entry.start,
    end: entry.end,
    allDay: entry.allDay,
    ...(entry.location ? { location: entry.location } : {}),
  }));
  const [editing, setEditing] = useState(false);
  const [setup, setSetup] = useState<CalendarSetup>({ state: 'reading' });
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // The overlap line and the times it was worked out for (a changed time shows none until read again).
  const [overlap, setOverlap] = useState<{ times: string; line: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  // One write per tap, even if the button is tapped twice before the screen updates.
  const writing = useRef(false);
  const again = useCallback(() => setRound((n) => n + 1), []);
  // Back from Settings → Calendars or the phone's settings: read the setup again.
  useReloadOnReturn(again);

  const added = entry.added;
  const android = Platform.OS === 'android';

  useEffect(() => {
    let live = true;
    if (added || !android || !userId) return;
    (async (): Promise<CalendarSetup> => {
      const choice = await loadChoice(deviceSettingsStore, userId);
      if (!choice.on) return { state: 'off' };
      const out = await listCalendars(deviceCalendar);
      if ('error' in out) return { state: out.error === NO_PERMISSION ? 'permission' : 'failed' };
      return writableCalendars(out.calendars, choice).length ? { state: 'ready', choice, calendars: out.calendars } : { state: 'none' };
    })()
      .catch((): CalendarSetup => ({ state: 'failed' }))
      .then((next) => {
        if (!live) return;
        setSetup(next);
        if (next.state === 'ready') setCalendarId((id) => (id && writableCalendars(next.calendars, next.choice).some((x) => x.id === id) ? id : defaultTarget(next.calendars, next.choice)?.id ?? null));
      });
    return () => {
      live = false;
    };
  }, [added, android, userId, round]);

  // Q13: what is already in the ticked calendars then (read only with calendar reading on).
  const problem = eventProblem(draft, new Date());
  useEffect(() => {
    let live = true;
    if (added || setup.state !== 'ready' || draft.allDay || problem) return;
    const times = `${draft.start}|${draft.end}`;
    readAgenda(deviceCalendar, setup.choice, draft.start.slice(0, 10), draft.end.slice(0, 10), phoneTimeZone())
      .then((out) => live && 'agenda' in out && setOverlap({ times, line: overlapLine(draft, out.agenda.events) }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [added, setup, draft, problem]);

  if (added) {
    const words = eventCardText(entry, new Date());
    return (
      <ChatCard icon="📅" actions={<Button title="Open in Calendar" kind="plain" onPress={() => void openEvent(added.eventId)} />}>
        <ChatCardText>{`Added to ${added.calendar}: ${words.title}`}</ChatCardText>
        <Muted>{words.when}</Muted>
      </ChatCard>
    );
  }
  if (!android) return <ChatCardDone icon="📅" text={CALENDAR_ANDROID_ONLY} />;

  const words = eventCardText(draft, new Date());
  const usable = setup.state === 'ready' ? writableCalendars(setup.calendars, setup.choice) : [];
  const target = usable.find((x) => x.id === calendarId) ?? null;
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }];

  async function add() {
    if (writing.current || setup.state !== 'ready' || !target) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    // Settings → Calendars read again at the tap: a calendar unticked since is refused.
    const out = await loadChoice(deviceSettingsStore, userId).then(
      (choice) => addEvent(deviceCalendar, choice, target.id, draft, new Date()),
      () => ({ problem: ADD_FAILED }),
    );
    writing.current = false;
    setBusy(false);
    if ('added' in out) onAdded(out.added, draft);
    else setError(out.problem);
  }

  async function allow() {
    const p = await deviceCalendar.askPermission().catch(() => ({ granted: false, canAskAgain: false }));
    if (!p.granted) await Linking.openSettings().catch(() => {});
    again();
  }

  const setupLine =
    setup.state === 'reading' ? <Muted>Reading your calendars…</Muted>
    : setup.state === 'off' ? <Muted>To add events, turn on Use my calendar in Settings → Calendars.</Muted>
    : setup.state === 'permission' ? <Muted>Wilma needs your permission to use your calendar.</Muted>
    : setup.state === 'failed' ? <Muted>Your calendars could not be read just now.</Muted>
    : setup.state === 'none' ? <Muted>{NO_WRITABLE}</Muted>
    : null;

  const action =
    setup.state === 'off' || setup.state === 'none' ? <Button title="Settings → Calendars" kind="plain" onPress={() => router.push('/calendars')} />
    : setup.state === 'permission' ? <Button title="Allow calendar" kind="plain" onPress={() => void allow()} />
    : setup.state === 'failed' ? <Button title="Try again" kind="plain" onPress={again} />
    : (
      <Button
        title={busy ? 'Adding…' : 'Add to calendar'}
        onPress={() => void add()}
        disabled={busy || !!problem || !target || setup.state !== 'ready'}
      />
    );

  return (
    <ChatCard icon="📅" actions={action}>
      {editing ? (
        <View style={{ gap: space.s }}>
          <TextInput
            style={input}
            accessibilityLabel="Title"
            placeholder="Title"
            placeholderTextColor={c.muted}
            maxLength={MAX_EVENT_TITLE}
            value={draft.title}
            onChangeText={(title) => setDraft({ ...draft, title })}
            editable={!busy}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.m }}>
            <Text style={{ color: c.text, fontSize: 15, flexShrink: 1 }}>{words.when}</Text>
            <TextLink title="Day" onPress={() => pick('date', draft.start, (p) => setDraft(moveToDay(draft, p.day)))} />
            {!draft.allDay ? (
              <>
                <TextLink title="Start" onPress={() => pick('time', draft.start, (p) => setDraft(moveStart(draft, p.time)))} />
                <TextLink title="End" onPress={() => pick('time', draft.end, (p) => setDraft(moveEnd(draft, p.time)))} />
              </>
            ) : null}
          </View>
          <TextInput
            style={input}
            accessibilityLabel="Place"
            placeholder="Place (optional)"
            placeholderTextColor={c.muted}
            maxLength={MAX_EVENT_PLACE}
            value={draft.location ?? ''}
            onChangeText={(location) => setDraft({ ...draft, location })}
            editable={!busy}
          />
          <TextLink title="Done" onPress={() => setEditing(false)} />
        </View>
      ) : (
        <>
          <ChatCardText>{words.title}</ChatCardText>
          <Muted>{words.when}</Muted>
          {draft.location?.trim() ? <Muted>{`📍 ${draft.location.trim()}`}</Muted> : null}
          <TextLink title="Change details" onPress={() => setEditing(true)} />
        </>
      )}

      {setup.state === 'ready' ? (
        choosing ? (
          <Chips
            options={usable.map((x) => ({ value: x.id, label: x.title }))}
            selected={(v) => v === calendarId}
            onPress={(id) => {
              setCalendarId(id);
              setChoosing(false);
            }}
            disabled={busy}
          />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.m }}>
            <Muted>{target ? `Calendar: ${target.title}` : 'Pick a calendar'}</Muted>
            {usable.length > 1 || !target ? <TextLink title="Change" onPress={() => setChoosing(true)} /> : null}
          </View>
        )
      ) : (
        setupLine
      )}

      {overlap?.line && overlap.times === `${draft.start}|${draft.end}` && !draft.allDay ? <Muted>{overlap.line}</Muted> : null}
      {problem ? <Text style={{ color: c.warn, fontSize: 15 }}>{problem}</Text> : null}
      {error ? <Text style={{ color: c.warn, fontSize: 15 }}>{error}</Text> : null}
    </ChatCard>
  );
}
