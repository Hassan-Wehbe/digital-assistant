// My day (day planner step 2, step 4; docs/phase6-day-planner-step2-plan.md and the mockups'
// screens 2, 3 and 5): today's (or tomorrow's) calendar, drives with leave-by times, rain and
// weather alerts, overlaps with Take both, free time and tasks, from the planner on the server
// ({"mode":"day"}: no model call, no AI request; Pro only).
//
// The plan lives only in this screen's memory: Mapbox's terms do not allow keeping Directions
// results, so it is never saved on the phone, and leaving the screen drops it. Above the fair-use
// limit, "the last plan" is the one still on screen. What is kept on the phone (dayChoices.ts) is
// the user's own: Take both and Not driving per day, and their answers for event places.
// With Settings → Morning briefing on, each new plan also schedules that day's leave-by alerts and
// the morning's summary as notifications on the phone (notifications.ts, day planner step 4).
//
// Event places are found on the phone (dayAgenda.ts): the user's answer for that title, else the
// phone's geocoder on the location text, only when the location permission is already given.
// Titles never go to Mapbox or the Weather Service (the server sends them only points and times).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { AddTaskSheet, type NewDayTask, type SheetStep } from '@/components/AddTaskSheet';
import { DayEventDetail } from '@/components/DayEventDetail';
import { PlacePicker } from '@/components/PlacePicker';
import { ProCard, useProPlan } from '@/components/ProCard';
import { Badge, Button, Card, Loading, Muted, space, styles, TextLink, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceCalendar, phoneTimeZone, readAgenda, timeText } from '@/lib/calendar';
import { loadBriefing } from '@/lib/briefingSettings';
import { loadChoice } from '@/lib/calendarSettings';
import { CALENDAR_TEXT } from '@/lib/chatThread';
import { dayBody, phoneGeocode, placeEvents, withKeys, type DayEvent } from '@/lib/dayAgenda';
import {
  answerPlace, choicesFor, EMPTY_MEMORY, forgetPlace, isDropOff, rememberFound, resetChoices, separate, takeBoth, textKey, toggleDropOff, toggleNotDriving,
  type DayMemory, type EventPlace,
} from '@/lib/dayChoices';
import type { DayEventRow, DayPlan, DayRow, NotPlacedTask, TaskOption } from '@/lib/dayPlan';
import {
  alertText, clock, dayChips, dayNotes, dayTitle, directionsLink, driveText, eventLine, freeText, minutesText, overlapText,
  leftOpenHeading, leftOpenWhen, rainText, rowTime, splitNotPlaced, titles, todayAndTomorrow,
} from '@/lib/dayView';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { deviceDayMemory, deviceSettingsStore } from '@/lib/deviceStorage';
import { saveHome, type PickedSpot } from '@/lib/homePlace';
import { findCredential } from '@/lib/credentials';
import { deviceGeocoder } from '@/lib/location';
import { LOOKS_LIKE_SECRET, editError } from '@/lib/noteEdit';
import { scheduleForPlan } from '@/lib/notifications';
import { needsPro } from '@/lib/pro';
import { addDays, addToDay, EMPTY_TASK, plannedAt, shortDay, taskMetadata, type TaskDayEnd, type TaskMetadata, withTime } from '@/lib/tasks';
import { WilmaError } from '@/lib/wilma';

type Screen =
  | { step: 'loading' }
  | { step: 'pro' }
  | { step: 'calendar'; problem: 'off' | 'permission' | 'failed' }
  | { step: 'error'; message: string }
  | { step: 'limit'; limit?: number }
  | { step: 'plan' };

const CONNECTION = 'Could not make the plan just now. Check your connection and try again.';

export default function MyDay() {
  const c = useColors();
  const { session, day, wilma, signOut } = useAuth();
  const userId = session?.user.id ?? '';
  const pro = useProPlan();
  const params = useLocalSearchParams<{ date?: string }>();
  const [days] = useState(() => todayAndTomorrow(new Date()));
  const [date, setDate] = useState(params.date === days.tomorrow ? days.tomorrow : days.today);

  const [screen, setScreen] = useState<Screen>({ step: 'loading' });
  // In memory only (see the top of the file).
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ key: string; title: string; location: string } | null>(null);
  const [homeOpen, setHomeOpen] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState<DayMemory>(EMPTY_MEMORY);
  // ＋ Add / Find a time: the sheet, the task it is for, and what was just put in the day.
  const [sheet, setSheet] = useState<SheetStep | null>(null);
  const [sheetTask, setSheetTask] = useState<{ id: string; title: string; metadata: TaskMetadata } | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // Left open (D35): the task a button is working on, and what went wrong.
  const [leftBusy, setLeftBusy] = useState<string | null>(null);
  const [leftError, setLeftError] = useState<string | null>(null);

  // The day's events as read (with keys), their places, and the zone: reused when only a choice changes.
  const raw = useRef<DayEvent[] | null>(null);
  const [placed, setPlaced] = useState<DayEvent[]>([]);
  const zone = useRef<string | null>(null);
  const mem = useRef<DayMemory>(EMPTY_MEMORY);
  const request = useRef(0);
  const alive = useRef(true);
  // signOut changes with each token refresh; through a ref, so a refresh never asks for a new plan.
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);
  const shown = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const keepMemory = useCallback(
    (m: DayMemory) => {
      mem.current = m;
      setMemory(m);
      if (userId) void deviceDayMemory.save(userId, m).catch(() => {});
    },
    [userId],
  );

  /** Reads the calendar (when asked, or not read yet), finds places, and asks for the plan. */
  const load = useCallback(
    async (reread: boolean, optionsFor?: string): Promise<DayPlan | null> => {
      if (!userId) return null;
      const mine = ++request.current;
      const current = () => alive.current && mine === request.current;
      setBusy(true);
      setNote(null);
      try {
        if (!raw.current || reread) {
          mem.current = await deviceDayMemory.load(userId, days.today);
          setMemory(mem.current);
          const read = await readAgenda(deviceCalendar, await loadChoice(deviceSettingsStore, userId), date, date, phoneTimeZone());
          if (!current()) return null;
          if ('problem' in read) {
            raw.current = null;
            setPlan(null);
            setScreen({ step: 'calendar', problem: read.problem === 'bad_days' ? 'failed' : read.problem });
            return null;
          }
          raw.current = withKeys(read.agenda.events);
          zone.current = read.agenda.time_zone;
        }
        const out = await placeEvents(raw.current, mem.current, phoneGeocode(deviceGeocoder));
        if (!current()) return null;
        setPlaced(out.events);
        if (Object.keys(out.found).length) keepMemory(rememberFound(mem.current, out.found));

        const got = await day.plan(dayBody(date, zone.current ?? phoneTimeZone() ?? 'UTC', timeText(new Date()), out.events, mem.current, optionsFor));
        if (!current()) return null;
        if ('plan' in got) {
          setPlan(got.plan);
          // Leave-by alerts and the morning's summary from this plan (Settings → Morning briefing).
          void loadBriefing(deviceSettingsStore, userId).then((b) => scheduleForPlan(deviceNotifier, userId, got.plan, b, new Date()));
          shown.current = true;
          setUpdatedAt(clock(timeText(new Date())));
          setScreen({ step: 'plan' });
          return got.plan;
        } else if (got.problem === 'pro_required') {
          setPlan(null);
          setScreen({ step: 'pro' });
        } else if (got.problem === 'fair_use') {
          // The plan still on screen stays (it is never saved, so there is no other "last plan").
          if (shown.current) setNote(`${limitText(got.limit)} This is the plan from earlier; it is not updated until tomorrow.`);
          else setScreen({ step: 'limit', limit: got.limit });
        } else if (shown.current) setNote(CONNECTION);
        else setScreen({ step: 'error', message: CONNECTION });
      } catch (e) {
        if (e instanceof WilmaError && e.signedOut) {
          void signOutRef.current();
          return null;
        }
        if (current()) {
          if (shown.current) setNote(CONNECTION);
          else setScreen({ step: 'error', message: CONNECTION });
        }
      } finally {
        if (current()) setBusy(false);
      }
      return null;
    },
    [userId, date, day, days.today, keepMemory],
  );

  // Without Pro (the server says free) the Pro card shows and nothing is asked.
  const showPro = needsPro(pro) || screen.step === 'pro';
  useEffect(() => {
    if (pro === undefined || needsPro(pro)) return;
    // Started from a callback, so the screen's state changes after this render, not inside it.
    void Promise.resolve().then(() => load(true));
  }, [pro, load]);

  // A choice or an answer changed: kept on the phone, then the plan again (same calendar read).
  const change = useCallback(
    (m: DayMemory) => {
      keepMemory(m);
      void load(false);
    },
    [keepMemory, load],
  );

  const answer = (title: string, a: EventPlace) => {
    setAsking(null);
    change(answerPlace(memory, title, a));
  };

  const pickHome = async (spot: PickedSpot) => {
    setHomeError(null);
    setBusy(true);
    const out = await saveHome(
      {
        listSpaces: wilma.listSpaces,
        createSpace: wilma.createSpace,
        search: wilma.search,
        saveItem: wilma.saveItem,
        updateItem: wilma.updateItem,
      },
      { lat: spot.lat, lng: spot.lng, ...(spot.address ? { address: spot.address } : {}) },
      plan?.home.label,
    );
    if (!alive.current) return;
    if ('error' in out) {
      setBusy(false);
      setHomeError(out.error);
      return;
    }
    setHomeOpen(false);
    void load(false);
  };

  // ---- ＋ Add and Find a time ----

  const closeSheet = () => {
    setSheet(null);
    setSheetTask(null);
    setSheetError(null);
  };

  /** Asks the planner where this task fits, and shows its suggestions. */
  const findTime = async (task: { id: string; title: string; metadata: TaskMetadata }) => {
    setSheetTask(task);
    setSheetBusy(true);
    setSheetError(null);
    const p = await load(false, task.id);
    if (!alive.current) return;
    setSheetBusy(false);
    const o = p?.options?.task_id === task.id ? p.options : null;
    if (o) setSheet({ step: 'options', title: task.title, options: o.options, ...(o.note ? { note: o.note } : {}) });
    else setSheetError('Could not find a time just now. Try again.');
  };

  /** ＋ Add → Find a time: saved as a task due this day first (the server checks it), then its options. */
  const addAndFind = async (t: NewDayTask) => {
    const fields = taskMetadata({
      ...EMPTY_TASK,
      title: t.title,
      duration: t.duration,
      dueOn: date,
      ...(t.place?.id ? { place: { id: t.place.id, title: t.place.label } } : t.place ? { address: t.place.address ?? t.place.label } : {}),
    });
    if ('error' in fields) return setSheetError(fields.error);
    if (findCredential(t.title)) return setSheetError(LOOKS_LIKE_SECRET);
    setSheetBusy(true);
    setSheetError(null);
    try {
      const saved = await wilma.saveTask({ title: t.title.trim(), metadata: fields.metadata });
      await findTime({ id: saved.id, title: t.title.trim(), metadata: fields.metadata });
    } catch (e) {
      setSheetBusy(false);
      setSheetError(editError(e instanceof Error ? e.message : String(e)));
    }
  };

  /** "Not placed yet" → Find a time: its fields as saved, then its options. */
  const findTimeFor = async (id: string, title: string) => {
    setSheet({ step: 'form' });
    setSheetBusy(true);
    try {
      const item = await wilma.getItem(id);
      await findTime({ id, title, metadata: (item.metadata ?? {}) as unknown as TaskMetadata });
    } catch (e) {
      setSheetBusy(false);
      setSheetError(e instanceof Error ? e.message : 'Could not open the task.');
    }
  };

  /** A suggestion picked: the task is put at that time (planned_at, the user's choice), then the plan again. */
  const pickOption = async (o: TaskOption, dayEnd: TaskDayEnd | null) => {
    const at = plannedAt(o.start);
    if (!sheetTask || !at) return;
    setSheetBusy(true);
    try {
      await wilma.updateItem(sheetTask.id, { metadata: withTime(sheetTask.metadata, at, dayEnd) });
      const moved = o.leave_at && o.was_leave_at ? ` Leave at ${clock(o.leave_at)} instead of ${clock(o.was_leave_at)}.` : '';
      setAdded(`✓ ${sheetTask.title} at ${clock(o.start)}.${moved}`);
      closeSheet();
      void load(false);
    } catch (e) {
      setSheetError(editError(e instanceof Error ? e.message : String(e)));
    } finally {
      setSheetBusy(false);
    }
  };

  /**
   * Left open on an earlier day, with no end-of-day choice (D35): answered here, without opening the
   * task. Add to today: due this day without its old time, to find a time for. Done. Remove: to the
   * Recycle bin (it can be restored). Then the plan again.
   */
  const answerLeftOpen = async (task: NotPlacedTask, answer: 'add' | 'done' | 'remove') => {
    setLeftBusy(task.id);
    setLeftError(null);
    try {
      if (answer === 'add') {
        const item = await wilma.getItem(task.id);
        await wilma.updateItem(task.id, { metadata: addToDay((item.metadata ?? {}) as Partial<TaskMetadata>, date) });
        setAdded(`✓ ${task.title} is in ${date === days.today ? 'today' : shortDay(date, days.today)}’s list. Find a time below.`);
      } else if (answer === 'done') {
        await wilma.taskDone(task.id, true, days.today);
        setAdded(`✓ ${task.title}: done.`);
      } else {
        await wilma.deleteItem(task.id);
        setAdded(`${task.title}: removed. It’s in the Recycle bin if you need it back.`);
      }
      void load(false);
    } catch (e) {
      setLeftError(editError(e instanceof Error ? e.message : String(e)));
    } finally {
      setLeftBusy(null);
    }
  };

  /** Not today: a task due this day moves to the next one; it stays in Tasks either way. */
  const notToday = async () => {
    const task = sheetTask;
    if (!task) return closeSheet();
    setSheetBusy(true);
    try {
      if (task.metadata.due_on && task.metadata.due_on <= date && !task.metadata.repeat) {
        await wilma.updateItem(task.id, { metadata: { ...task.metadata, due_on: addDays(date, 1) } });
      }
      closeSheet();
      void load(false);
    } catch (e) {
      setSheetError(editError(e instanceof Error ? e.message : String(e)));
    } finally {
      setSheetBusy(false);
    }
  };

  const t = plan ? titles(plan) : new Map<string, string>();
  const choices = choicesFor(memory, date);
  const notDriving = new Set(choices.not_driving ?? []);
  const placedBy = (key: string) => placed.find((e) => e.key === key);

  const openDirections = (r: DayEventRow) => {
    const e = placedBy(r.key);
    const to = e?.point ?? r.place ?? e?.location;
    if (to) void Linking.openURL(directionsLink(to)).catch(() => {});
  };

  // ---- Pieces ----

  const placeAsk = (r: DayEventRow) =>
    asking?.key === r.key ? (
      <PlacePicker
        title={`Where is “${r.title}”?`}
        intro="Your answer is remembered for this event name, so you are asked once."
        startText={asking.location}
        onPick={(spot) => answer(r.title, { lat: spot.lat, lng: spot.lng, label: spot.label })}
        onCancel={() => setAsking(null)}
        extra={<Button title="Not a trip" kind="plain" onPress={() => answer(r.title, { not_a_trip: true })} />}
      />
    ) : null;

  const ask = (r: DayEventRow) => setAsking({ key: r.key, title: r.title, location: placedBy(r.key)?.location ?? r.place ?? '' });

  const eventCard = (r: DayEventRow) => (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${r.private ? 'Busy' : r.title}, details`}
        disabled={r.private}
        onPress={() => setDetail(r.key)}
        style={({ pressed }) => [box(c.card, c.line), pressed && { opacity: 0.6 }]}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{r.private ? 'Busy' : r.title}</Text>
        <Text style={{ color: c.muted, fontSize: 13 }}>{eventLine(r, t)}</Text>
        {r.by_name_only ? <Text style={{ color: c.warn, fontSize: 13 }}>{`📍 found by name: ${r.place} · Is this right?`}</Text> : null}
        {r.together_with?.length ? (
          <TextLink title="Undo one trip" onPress={() => change(separate(memory, date, r.key))} />
        ) : null}
      </Pressable>
      {r.needs_place && asking?.key !== r.key ? (
        <View style={[box(c.warnBg, c.warn), { gap: space.s }]}>
          <Text style={{ color: c.text, fontSize: 14 }}>📍 Where is this? The calendar event’s place was not found, so there is no drive time yet.</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
            <Button title="Not a trip" kind="plain" onPress={() => answer(r.title, { not_a_trip: true })} />
            <Button title="Pick a place" onPress={() => ask(r)} />
          </View>
        </View>
      ) : null}
      {r.by_name_only && asking?.key !== r.key ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
          <Button title="Pick another" kind="plain" onPress={() => ask(r)} />
          <Button
            title="Yes, that’s it"
            kind="plain"
            onPress={() => {
              const p = placedBy(r.key)?.point;
              if (p) answer(r.title, { lat: p.lat, lng: p.lng, label: r.place ?? r.title });
            }}
          />
        </View>
      ) : null}
      {placeAsk(r)}
    </View>
  );

  const row = (r: DayRow, i: number): ReactNode => {
    let body: ReactNode = null;
    switch (r.kind) {
      case 'event':
        body = eventCard(r);
        break;
      case 'drive': {
        const d = driveText(r, t);
        body = (
          <View style={box(c.tint)}>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{d.title}</Text>
            {d.detail ? <Text style={{ color: c.text, fontSize: 13 }}>{d.detail}</Text> : null}
            {d.warn ? <Text style={{ color: c.warn, fontSize: 13 }}>{d.warn}</Text> : null}
          </View>
        );
        break;
      }
      case 'rain':
        body = <Text style={[box(c.rainBg), { color: c.rain, fontSize: 13 }]}>{rainText(r)}</Text>;
        break;
      case 'alert':
        body = <Text style={[box(c.warnBg, c.warn), { color: c.warn, fontSize: 13 }]}>{alertText(r)}</Text>;
        break;
      case 'overlap': {
        const o = overlapText(r, t);
        const id = r.keys.join('+');
        body = (
          <View style={[box(c.card, c.warn), { gap: space.s }]}>
            <Text style={{ color: c.warn, fontSize: 14, fontWeight: '600' }}>{o.title}</Text>
            <Text style={{ color: c.text, fontSize: 13 }}>{o.detail}</Text>
            {o.takeBoth && !kept.has(id) ? (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
                <Button title="Keep as is" kind="plain" onPress={() => setKept(new Set(kept).add(id))} />
                <Button title="Take both" onPress={() => change(takeBoth(memory, date, r.keys))} />
              </View>
            ) : null}
          </View>
        );
        break;
      }
      case 'free':
        body = <Text style={[box(undefined, c.line, true), { color: c.muted, fontSize: 13 }]}>{freeText(r)}</Text>;
        break;
      case 'task':
        body = (
          <View style={box(c.card, c.line, true)}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{`☐ ${r.title}`}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{[`${minutesText(minutesBetween(r.start, r.end))}`, r.place].filter(Boolean).join(' · ')}</Text>
          </View>
        );
        break;
    }
    return (
      <View key={`${r.kind}-${i}`} style={{ flexDirection: 'row', gap: space.s }}>
        <Text style={{ width: 62, textAlign: 'right', paddingTop: 8, color: c.muted, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
          {rowTime(r)}
        </Text>
        <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
      </View>
    );
  };

  const homeCard = plan && (!plan.home.set || homeOpen) ? (
    <View style={{ gap: space.s }}>
      <PlacePicker
        title="Where do you leave from?"
        intro="Wilma times your drives from home. It’s saved as a place called Home, and you can change it later."
        allowHere
        onPick={(spot) => void pickHome(spot)}
        onCancel={plan.home.set ? () => setHomeOpen(false) : undefined}
      />
      {homeError ? <Text style={{ color: c.danger, fontSize: 15 }}>{homeError}</Text> : null}
      {!plan.home.set ? <Muted>Until then, the day shows without drive times.</Muted> : null}
    </View>
  ) : null;


  // ---- The screen ----

  let content: ReactNode;
  if (showPro) content = <ProCard onNotNow={() => router.back()} />;
  else if (screen.step === 'loading') content = <Loading />;
  else if (screen.step === 'calendar') {
    content = (
      <Card>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>
          {screen.problem === 'failed' ? CALENDAR_TEXT.failed : 'My day plans from your phone’s calendar. Turn on Use my calendar in Settings → Calendars.'}
        </Text>
        {screen.problem !== 'failed' ? <Button title="Open Settings → Calendars" kind="plain" onPress={() => router.push('/calendars')} /> : null}
      </Card>
    );
  } else if (screen.step === 'error') content = <Card><Text style={{ color: c.text, fontSize: 16 }}>{screen.message}</Text><Button title="Try again" kind="plain" onPress={() => void load(true)} /></Card>;
  else if (screen.step === 'limit') {
    content = <Card><Text style={{ color: c.text, fontSize: 16 }}>{`${limitText(screen.limit)} My day plans again tomorrow.`}</Text></Card>;
  } else if (plan && detail) {
    const ev = plan.rows.find((r): r is DayEventRow => r.kind === 'event' && r.key === detail);
    content = (
      <DayEventDetail
        plan={plan}
        eventKey={detail}
        notDriving={notDriving.has(detail)}
        dropOff={!!ev && isDropOff(memory, ev.title)}
        answered={!!ev && !!memory.places[textKey(ev.title)]}
        canDirections={!!(ev?.place || placedBy(detail)?.location)}
        checkedAt={updatedAt}
        picker={ev ? placeAsk(ev) : null}
        onBack={() => setDetail(null)}
        onToggleDriving={() => change(toggleNotDriving(memory, date, detail))}
        onToggleDropOff={() => ev && change(toggleDropOff(memory, ev.title))}
        onDirections={() => ev && openDirections(ev)}
        onChangePlace={() => ev && ask(ev)}
        onForget={() => ev && change(forgetPlace(memory, ev.title))}
      />
    );
  }
  else if (plan) {
    const chips = dayChips(plan);
    const { leftOpen, notPlaced } = splitNotPlaced(plan);
    content = (
      <View style={{ gap: space.m }}>
        {homeCard}
        {sheet ? (
          <AddTaskSheet
            sheet={sheet}
            titles={t}
            busy={sheetBusy}
            error={sheetError}
            onFind={(task) => void addAndFind(task)}
            onPick={(o, dayEnd) => void pickOption(o, dayEnd)}
            onNotToday={() => void notToday()}
            onClose={closeSheet}
            dayEnd={sheetTask?.metadata.repeat ? undefined : sheetTask?.metadata.day_end ?? null}
          />
        ) : (
          <Button title="＋ Add" kind="plain" onPress={() => setSheet({ step: 'form' })} />
        )}
        {added ? <Text style={[box(c.goodBg, c.good), { color: c.good, fontSize: 14 }]}>{added}</Text> : null}
        {leftOpen.length ? (
          <View style={[box(c.card, c.line, true), { gap: space.s }]}>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{leftOpenHeading(leftOpen, date)}</Text>
            {leftOpen.map((task) => (
              <View key={task.id} style={{ gap: 2 }}>
                <Text style={{ color: c.text, fontSize: 14 }}>{`☐ ${task.title} · ${leftOpenWhen(task, date)}`}</Text>
                {leftBusy === task.id ? (
                  <Muted>Saving…</Muted>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m }}>
                    <TextLink title={date === days.today ? 'Add to today' : `Add to ${shortDay(date, days.today)}`} onPress={() => void answerLeftOpen(task, 'add')} />
                    <TextLink title="Done" onPress={() => void answerLeftOpen(task, 'done')} />
                    {/* A repeating task is never removed from here: that would end every later time too. */}
                    {!task.repeat ? <TextLink title="Remove" onPress={() => void answerLeftOpen(task, 'remove')} /> : null}
                  </View>
                )}
              </View>
            ))}
            {leftError ? <Text style={{ color: c.danger, fontSize: 14 }}>{leftError}</Text> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {chips.map((ch) => (
            <Text key={ch.text} style={chipStyle(c, ch.tone)}>{ch.text}</Text>
          ))}
          {plan.all_day.map((e) => (
            <Text key={e.key} style={chipStyle(c, 'plain')}>{`All day: ${e.title}`}</Text>
          ))}
        </View>
        {note ? <Text style={{ color: c.warn, fontSize: 14 }}>{note}</Text> : null}
        {plan.rows.length ? plan.rows.map(row) : <Muted>Nothing on your calendar this day.</Muted>}
        {notPlaced.length ? (
          <View style={[box(c.card, c.line, true), { gap: space.xs }]}>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>Not placed yet</Text>
            {notPlaced.map((task) => (
              <View key={task.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>
                  {`☐ ${task.title}${task.duration_min ? ` · ${minutesText(task.duration_min)}` : ''}${task.overdue ? ' · overdue' : ''}`}
                </Text>
                {!sheet ? <TextLink title="Find a time" onPress={() => void findTimeFor(task.id, task.title)} /> : null}
              </View>
            ))}
          </View>
        ) : null}
        {dayNotes(plan).map((n) => (
          <Muted key={n}>{n}</Muted>
        ))}
        {plan.credits.length ? <Muted>{plan.credits.join(' · ')}</Muted> : null}
        <Muted>{`The plan is a suggestion: your calendar is not changed.${updatedAt ? ` Updated ${updatedAt}.` : ''}`}</Muted>
        <View style={{ gap: space.s }}>
          {plan.home.set && !homeOpen ? <TextLink title={`🏠 ${plan.home.label ?? 'Home'} · Change`} onPress={() => setHomeOpen(true)} /> : null}
          {choices.together || choices.not_driving ? <TextLink title="↺ Start over (undo today’s choices)" onPress={() => change(resetChoices(memory, date))} /> : null}
        </View>
      </View>
    );
  } else content = <Loading />;

  const switchDay = (d: string) => {
    if (d === date) return;
    setDetail(null);
    setAsking(null);
    setAdded(null);
    closeSheet();
    setPlan(null);
    shown.current = false;
    raw.current = null;
    setScreen({ step: 'loading' });
    setDate(d);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: dayTitle(date) }} />
      {!showPro ? (
        <View style={{ flexDirection: 'row', gap: space.s, padding: space.m, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
          {[{ d: days.today, label: 'Today' }, { d: days.tomorrow, label: 'Tomorrow' }].map(({ d, label }) => (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ checked: d === date }}
              onPress={() => switchDay(d)}
              style={{ borderRadius: 999, paddingVertical: space.xs, paddingHorizontal: space.m, backgroundColor: d === date ? c.accent : c.tint }}>
              <Text style={{ color: d === date ? '#ffffff' : c.accent, fontSize: 14, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          {busy && screen.step === 'plan' ? <Muted>Updating…</Muted> : null}
          {pro === 'pro' ? <Badge text="PRO" /> : null}
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.list, { gap: space.s }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => !showPro && void load(true)} />}>
        {content}
      </ScrollView>
    </View>
  );
}

/** Above the fair-use limit (30 plans a day, Q11). */
function limitText(limit?: number): string {
  return limit ? `Today’s ${limit} day plans are used up.` : 'Today’s day plans are used up.';
}

function box(bg?: string, border?: string, dashed?: boolean) {
  return {
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 2,
    ...(bg ? { backgroundColor: bg } : {}),
    ...(border ? { borderWidth: 1, borderColor: border, borderStyle: dashed ? ('dashed' as const) : ('solid' as const) } : {}),
  };
}

function chipStyle(c: ReturnType<typeof useColors>, tone: 'plain' | 'rain' | 'warn' | 'good') {
  const [fg, bg] = tone === 'rain' ? [c.rain, c.rainBg] : tone === 'warn' ? [c.warn, c.warnBg] : tone === 'good' ? [c.good, c.goodBg] : [c.accent, c.tint];
  return { color: fg, backgroundColor: bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, fontSize: 12, overflow: 'hidden' as const };
}


function minutesBetween(start: string, end: string): number {
  const a = Date.parse(`${start}:00Z`);
  const b = Date.parse(`${end}:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 60_000) : 0;
}
