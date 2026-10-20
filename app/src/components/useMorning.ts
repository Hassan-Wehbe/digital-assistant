// 🌅 Your morning (day planner step 4; lib/morningBrief.ts), a button on Home's Plan with Wilma row
// since recipes step 6 (owner, 2026-10-20): Home still makes it the first time Wilma is opened after
// the briefing time (its plan also schedules that day's leave-by alerts, when they are on), and the
// button says NEW until it is opened. The Your morning screen (app/morning.tsx) shows it, makes it
// again, or makes it now before the briefing time. The summary is kept in memory only (until Wilma
// is closed); made earlier today and no longer in memory, it offers to make it again.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { loadBriefing } from '@/lib/briefingSettings';
import { deviceCalendar, phoneTimeZone, readAgenda, timeText } from '@/lib/calendar';
import { loadChoice } from '@/lib/calendarSettings';
import { phoneGeocode } from '@/lib/dayAgenda';
import { todayAndTomorrow } from '@/lib/dayView';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { deviceDayMemory, deviceSettingsStore } from '@/lib/deviceStorage';
import { deviceGeocoder } from '@/lib/location';
import { loadMarks, makeMorning, MORNING_PROBLEM, morningStep, saveMarks } from '@/lib/morningBrief';
import { scheduleForPlan } from '@/lib/notifications';
import { needsPro } from '@/lib/pro';

import { useProPlan } from './ProCard';

export type MorningShown =
  | { step: 'none' }
  | { step: 'off' }
  | { step: 'early' }
  | { step: 'making' }
  | { step: 'made_earlier' }
  | { step: 'summary'; summary: string }
  | { step: 'problem'; text: string };

// This morning's summary while Wilma stays open (never written anywhere), whether it has been
// opened, and the one making in progress (Home and the screen never make it twice at once).
let kept: { userId: string; date: string; summary: string; seen: boolean } | null = null;
let making: Promise<void> | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/**
 * `auto`: Home's use, which makes the briefing when it is due (on opening, when `refresh` changes,
 * and when Wilma comes back to the front). The screen's use shows what there is, and makes it again
 * or now on a tap.
 */
export function useMorning({ auto, refresh = 0 }: { auto: boolean; refresh?: number }) {
  const { session, day } = useAuth();
  const userId = session?.user.id ?? '';
  const pro = useProPlan();
  const [shown, setShown] = useState<MorningShown>({ step: 'none' });

  const make = useCallback(async () => {
    const now = new Date();
    const today = todayAndTomorrow(now).today;
    const settings = await loadBriefing(deviceSettingsStore, userId);
    const marks = await loadMarks(deviceSettingsStore, userId);
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
    if ('plan' in out) {
      // Made: not again automatically today (a problem is tried again on the next open).
      await saveMarks(deviceSettingsStore, userId, { ...marks, made: today });
      kept = { userId, date: today, summary: out.summary, seen: !auto };
      setShown({ step: 'summary', summary: out.summary });
      void scheduleForPlan(deviceNotifier, userId, out.plan, settings, new Date());
    } else if (out.problem === 'pro') {
      setShown({ step: 'none' });
    } else {
      setShown({ step: 'problem', text: MORNING_PROBLEM[out.problem] });
    }
  }, [userId, day, auto]);

  /** Looks again at the settings and the time; makes the briefing when due, `again`, or `now`. */
  const check = useCallback(
    async (opts: { again?: boolean; now?: boolean } = {}) => {
      if (!userId || pro === undefined || needsPro(pro)) return;
      if (making) {
        setShown({ step: 'making' });
        await making;
      }
      const now = new Date();
      const today = todayAndTomorrow(now).today;
      const settings = await loadBriefing(deviceSettingsStore, userId);
      const step = morningStep(settings, await loadMarks(deviceSettingsStore, userId), now);
      const have = kept?.userId === userId && kept.date === today ? kept : null;
      if (!opts.again && have) {
        if (!auto && !have.seen) {
          have.seen = true;
          changed();
        }
        return setShown({ step: 'summary', summary: have.summary });
      }
      if (!opts.again && !opts.now) {
        if (settings.briefing === 'off') return setShown({ step: auto ? 'none' : 'off' });
        if (step === 'hidden') return setShown({ step: auto ? 'none' : 'early' });
        if (step === 'made_earlier') return setShown({ step: 'made_earlier' });
        if (!auto) return setShown({ step: 'early' });
      }
      making = make().finally(() => {
        making = null;
        changed();
      });
      await making;
    },
    [userId, pro, auto, make],
  );

  // Home: on opening, on pull to refresh and back to the front, made only when due. A pull no longer
  // makes it again (that is one plan, counted, and the card is no longer on Home to show it): the
  // screen's Make it again does.
  useEffect(() => {
    if (!auto) return;
    void Promise.resolve().then(() => check());
  }, [auto, check, refresh]);
  useEffect(() => {
    if (!auto) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => sub.remove();
  }, [auto, check]);
  // The screen: what there is, once.
  useEffect(() => {
    if (!auto) void Promise.resolve().then(() => check());
  }, [auto, check]);

  // NEW on Home's button while this morning's summary has not been opened.
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const today = todayAndTomorrow(new Date()).today;
  const unseen = !!kept && kept.userId === userId && kept.date === today && !kept.seen;

  return { shown, check, unseen };
}
