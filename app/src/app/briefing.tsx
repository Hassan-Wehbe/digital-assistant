// Settings → Morning briefing (day planner step 4, docs/phase6-day-planner-step4-plan.md): every
// part is its own setting (owner, 2026-10-10). The briefing: off, in Wilma only (no notification),
// or in Wilma and as a notification, at a time; leave-by alerts on their own, some minutes before.
// Kept on this phone per account (briefingSettings.ts). Android's notification permission is asked
// only when a setting that sends one is turned on. Pro: Free accounts see the Pro card.
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Text } from 'react-native';

import { ProCard, useProPlan } from '@/components/ProCard';
import { Button, Card, GroupList, GroupRow, Muted, space, styles, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  LEADS, loadBriefing, MODE_CHOICES, saveBriefing, sendsNotifications, timeText, type BriefingSettings,
} from '@/lib/briefingSettings';
import { deviceNotifier } from '@/lib/deviceNotifier';
import { deviceSettingsStore } from '@/lib/deviceStorage';
import { applyBriefing } from '@/lib/notifications';
import { needsPro } from '@/lib/pro';

const NOT_SAVED = "That wasn't saved on this phone. Try again.";
const NO_PERMISSION = 'Notifications are off for Wilma. Allow them in your phone’s settings, then choose again.';

const MODE_TEXT: Record<BriefingSettings['briefing'], string> = {
  off: 'No briefing.',
  app: 'The first time you open Wilma after this time, Home shows Your morning, made then: what’s on, when to leave, rain. No notification.',
  notify:
    'The same in Wilma, and a notification at this time. If you planned the day the evening before (My day → Tomorrow), it says what’s on.',
};

const two = (n: number) => String(n).padStart(2, '0');

export default function Briefing() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const pro = useProPlan();
  const saved = useLoad(`briefing:${userId}`, () => loadBriefing(deviceSettingsStore, userId));
  // What was just changed on this screen, shown at once (the saved settings are read once).
  const [changed, setChanged] = useState<BriefingSettings | null>(null);
  const s = changed ?? saved.data;
  const allowed = useLoad(`notify-permission:${userId}:${changed ? sendsNotifications(changed) : ''}`, () => deviceNotifier.permission());
  const [problem, setProblem] = useState<string | null>(null);

  const heading = (title: string) => <Text style={[styles.title, { color: c.text }]}>{title}</Text>;
  const page = (children: React.ReactNode) => (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]}>
      {children}
    </ScrollView>
  );

  if (Platform.OS === 'web') return page(<Muted>The morning briefing works in the Wilma app on your phone.</Muted>);
  if (needsPro(pro)) return page(<ProCard />);
  if (!s) return page(<Muted>Reading your settings…</Muted>);

  const update = async (next: BriefingSettings) => {
    setProblem(null);
    // Asked only when something that sends a notification is turned on.
    const turnsOn = (next.briefing === 'notify' && s.briefing !== 'notify') || (next.leaveAlerts && !s.leaveAlerts);
    if (turnsOn && (await deviceNotifier.permission()) !== 'granted' && !(await deviceNotifier.ask())) {
      setProblem(NO_PERMISSION);
      return;
    }
    if (!(await saveBriefing(deviceSettingsStore, userId, next))) {
      setProblem(NOT_SAVED);
      return;
    }
    setChanged(next);
    void applyBriefing(deviceNotifier, userId, next, new Date());
  };

  const pickTime = () => {
    const [h, m] = s.time.split(':').map(Number);
    DateTimePickerAndroid.open({
      mode: 'time',
      value: new Date(2000, 0, 1, h, m),
      onValueChange: (_event, date) => {
        if (date) void update({ ...s, time: `${two(date.getHours())}:${two(date.getMinutes())}` });
      },
    });
  };

  // Turned on earlier, then notifications were switched off in the phone's settings.
  const blocked = sendsNotifications(s) && allowed.data === 'denied';
  const shownProblem = problem ?? (blocked ? 'Notifications are off for Wilma in your phone’s settings, so none come.' : null);

  return page(
    <>
      <Card>
        <Text style={[styles.body, { color: c.text }]}>Wilma can brief you each morning and tell you when to leave.</Text>
        <Muted>
          Made on this phone from your plan, the same way as My day: your calendar is read when you open My day or, with
          the briefing on, when you open Wilma in the morning. Nothing new is kept on Wilma’s servers.
        </Muted>
      </Card>

      {heading('Morning briefing')}
      <GroupList>
        {MODE_CHOICES.map((choice, i) => (
          <GroupRow
            key={choice.mode}
            first={i === 0}
            title={choice.title}
            checked={s.briefing === choice.mode}
            onPress={() => void update({ ...s, briefing: choice.mode })}
          />
        ))}
      </GroupList>
      {s.briefing !== 'off' ? (
        <GroupList>
          <GroupRow first title="Briefing time" subtitle={timeText(s.time)} onPress={pickTime} />
        </GroupList>
      ) : null}
      <Muted>{MODE_TEXT[s.briefing]}</Muted>

      {heading('Leave-by alerts')}
      <GroupList>
        <GroupRow first title="Off" checked={!s.leaveAlerts} onPress={() => void update({ ...s, leaveAlerts: false })} />
        <GroupRow title="On" checked={s.leaveAlerts} onPress={() => void update({ ...s, leaveAlerts: true })} />
      </GroupList>
      {s.leaveAlerts ? (
        <>
          {heading('Alert me')}
          <GroupList>
            {LEADS.map((lead, i) => (
              <GroupRow
                key={lead}
                first={i === 0}
                title={`${lead} minutes before`}
                checked={s.lead === lead}
                onPress={() => void update({ ...s, lead })}
              />
            ))}
          </GroupList>
        </>
      ) : null}
      <Muted>
        A notification before each drive in your plan, e.g. “Leave by 8:10 am for Swim”. Alerts come for days planned on
        this phone (My day, or the morning briefing). Android may send one a few minutes late while the phone sleeps; the
        alert always says the leave-by time.
      </Muted>

      {shownProblem ? (
        <Card>
          <Text style={{ color: c.danger, fontSize: 15 }}>{shownProblem}</Text>
          {shownProblem !== NOT_SAVED ? (
            <Button title="Open phone settings" kind="plain" onPress={() => void Linking.openSettings().catch(() => {})} />
          ) : null}
        </Card>
      ) : null}
    </>,
  );
}
