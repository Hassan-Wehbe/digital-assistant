// 🌅 Your morning, on Home (day planner step 4, step 3; lib/morningBrief.ts): made the first time
// Wilma is opened after the briefing time, then "Open My day" or "Hide for today". Its plan also
// schedules that day's leave-by alerts (when they are on). The summary is kept in memory only
// (until Wilma is closed); made earlier today and no longer in memory, it offers to make it again.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { loadBriefing } from '@/lib/briefingSettings';
import { deviceCalendar, phoneTimeZone, readAgenda, timeText } from '@/lib/calendar';
import { loadChoice } from '@/lib/calendarSettings';
import { phoneGeocode } from '@/lib/dayAgenda';
import { todayAndTomorrow } from '@/lib/dayView';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { deviceDayMemory, deviceSettingsStore } from '@/lib/deviceStorage';
import { deviceGeocoder } from '@/lib/location';
import { loadMarks, makeMorning, MORNING_PROBLEM, morningStep, saveMarks, type MorningStep } from '@/lib/morningBrief';
import { scheduleForPlan } from '@/lib/notifications';
import { needsPro } from '@/lib/pro';

import { useProPlan } from './ProCard';
import { Button, Card, Muted, space, styles, useColors } from './ui';

type Shown =
  | { step: 'none' }
  | { step: 'making' }
  | { step: 'made_earlier' }
  | { step: 'summary'; summary: string }
  | { step: 'problem'; text: string };

// This morning's summary, while Wilma stays open (never written anywhere).
let kept: { userId: string; date: string; summary: string } | null = null;

/** `refresh` changes on Home's pull to refresh: the card is made again when it is showing. */
export function MorningCard({ refresh }: { refresh: number }) {
  const c = useColors();
  const { session, day } = useAuth();
  const userId = session?.user.id ?? '';
  const pro = useProPlan();
  const [shown, setShown] = useState<Shown>({ step: 'none' });
  const busy = useRef(false);
  // Whether the card is showing, for pull to refresh (made again only then).
  const showing = useRef(false);
  useEffect(() => {
    showing.current = shown.step !== 'none';
  }, [shown.step]);

  /** Looks again at the settings and the time; makes the briefing when it is due (or `again`). */
  const check = useCallback(
    async (again: boolean) => {
      if (!userId || pro === undefined || needsPro(pro) || busy.current) return;
      const now = new Date();
      const today = todayAndTomorrow(now).today;
      const settings = await loadBriefing(deviceSettingsStore, userId);
      const marks = await loadMarks(deviceSettingsStore, userId);
      const step: MorningStep = morningStep(settings, marks, now);
      if (step === 'hidden') return setShown({ step: 'none' });
      if (!again && kept?.userId === userId && kept.date === today) return setShown({ step: 'summary', summary: kept.summary });
      if (step === 'made_earlier' && !again) return setShown({ step: 'made_earlier' });

      busy.current = true;
      setShown({ step: 'making' });
      const out = await makeMorning(
        {
          calendarChoice: () => loadChoice(deviceSettingsStore, userId),
          readAgenda: (choice, date, zone) => readAgenda(deviceCalendar, choice, date, date, zone),
          memory: () => deviceDayMemory.load(userId, today),
          geocode: phoneGeocode(deviceGeocoder),
          plan: (body) => day.plan(body),
          timeZone: phoneTimeZone(),
        },
        now,
        timeText(now),
      );
      busy.current = false;
      if ('plan' in out) {
        // Made: not again automatically today (a problem is tried again on the next open).
        await saveMarks(deviceSettingsStore, userId, { ...marks, made: today });
        kept = { userId, date: today, summary: out.summary };
        setShown({ step: 'summary', summary: out.summary });
        void scheduleForPlan(deviceNotifier, userId, out.plan, settings, new Date());
      } else if (out.problem === 'pro') {
        setShown({ step: 'none' });
      } else {
        setShown({ step: 'problem', text: MORNING_PROBLEM[out.problem] });
      }
    },
    [userId, pro, day],
  );

  // On opening Home, on pull to refresh (made again), and when Wilma comes back to the front.
  const pulls = useRef(refresh);
  useEffect(() => {
    const again = pulls.current !== refresh;
    pulls.current = refresh;
    void Promise.resolve().then(() => check(again && showing.current));
  }, [check, refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check(false);
    });
    return () => sub.remove();
  }, [check]);

  if (shown.step === 'none') return null;
  const hide = () => {
    setShown({ step: 'none' });
    void loadMarks(deviceSettingsStore, userId).then((m) =>
      saveMarks(deviceSettingsStore, userId, { ...m, hidden: todayAndTomorrow(new Date()).today }),
    );
  };

  return (
    <Card style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>🌅 Your morning</Text>
      {shown.step === 'making' ? <Muted>Making your morning…</Muted> : null}
      {shown.step === 'summary' ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{shown.summary}</Text> : null}
      {shown.step === 'made_earlier' ? <Muted>Made earlier today.</Muted> : null}
      {shown.step === 'problem' ? <Muted>{shown.text}</Muted> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s, flexWrap: 'wrap' }}>
        <Button title="Hide for today" kind="plain" onPress={hide} />
        {shown.step === 'made_earlier' ? <Button title="Show it again" kind="plain" onPress={() => void check(true)} /> : null}
        <Button title="Open My day ›" onPress={() => router.push('/day')} />
      </View>
    </Card>
  );
}
