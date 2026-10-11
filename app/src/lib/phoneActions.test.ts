// Alarms and reminders from the chat (D31, docs/alarms-calendar-plan.md step 2): the card words,
// the Clock's set-alarm screen filled in, reminders as notifications (set only on the tap, one per
// card, refused when they look like a password, listed and cancelled per account, cancelled on
// sign-out), "cancel my reminder to call Sam" matched on the phone, and the cards read from the
// stream and from a saved chat.
import { describe, expect, it } from '@jest/globals';

import { chatReducer, initialChat } from './chatThread';
import { toChatEvent } from './chatStream';
import type { DayNote } from './dayAlerts';
import { cancelReminder, forgetOtherAccounts, listReminders, setReminder, type Notifier, type Permission, type Scheduled } from './notifications';
import {
  alarmCardText, alarmIntent, daysText, fromLocal, matchReminders, reminderCardText, reminderNote, reminderProblem, toAlarmData,
  toReminderData,
} from './phoneActions';

/** 2026-10-10, a Saturday, 9:00 am on this phone. */
const NOW = new Date(2026, 9, 10, 9, 0);

function phone(permission: Permission = 'granted', grantOnAsk = permission === 'granted') {
  const list = new Map<string, Scheduled>();
  const asked: number[] = [];
  const n: Notifier = {
    permission: async () => permission,
    ask: async () => {
      asked.push(1);
      return grantOnAsk;
    },
    schedule: async (note: DayNote, userId: string) => {
      list.set(note.id, { id: note.id, userId, at: note.at.getTime(), body: note.body });
    },
    cancel: async (id) => {
      list.delete(id);
    },
    scheduled: async () => [...list.values()],
  };
  return { n, list, asked };
}

describe('alarm cards', () => {
  it('say the next time the alarm rings, or its days with a line to tick them in the Clock', () => {
    expect(alarmCardText({ time: '06:30' }, NOW).title).toBe('Alarm 6:30 am · tomorrow');
    expect(alarmCardText({ time: '17:45', label: 'Gym' }, NOW).title).toBe('Alarm 5:45 pm · today · Gym');
    const weekdays = alarmCardText({ time: '05:45', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, NOW);
    expect(weekdays.title).toBe('Alarm 5:45 am · Mon–Fri');
    expect(weekdays.detail).toMatch(/tick Mon–Fri/);
    expect(daysText(['sun', 'sat'])).toBe('Sat, Sun');
    expect(daysText(['mon', 'wed'])).toBe('Mon, Wed');
  });

  it('open the Clock’s own set-alarm screen with whole-number hour and minutes, shown to the user', () => {
    expect(alarmIntent({ time: '06:05', label: 'Gym' })).toEqual({
      action: 'android.intent.action.SET_ALARM',
      extra: {
        'android.intent.extra.alarm.HOUR': 6,
        'android.intent.extra.alarm.MINUTES': 5,
        'android.intent.extra.alarm.SKIP_UI': false,
        'android.intent.extra.alarm.MESSAGE': 'Gym',
      },
    });
  });
});

describe('reminders', () => {
  const r = { at: '2026-10-10T17:00', text: 'Call Sam' };

  it('read as a time and the words, on this phone’s clock', () => {
    expect(reminderCardText(r, NOW)).toBe('5:00 pm today: Call Sam');
    expect(reminderCardText({ at: '2026-10-11T09:00', text: 'Pay the nanny' }, NOW)).toBe('9:00 am tomorrow: Pay the nanny');
    expect(fromLocal('2026-02-30T09:00')).toBeNull();
  });

  it('are not set when the time passed or the words look like a password (they show on the lock screen)', () => {
    expect(reminderProblem(r, NOW)).toBeNull();
    expect(reminderProblem({ ...r, at: '2026-10-10T08:00' }, NOW)).toMatch(/passed/);
    expect(reminderProblem({ ...r, text: 'the garage code is 4831' }, NOW)).toMatch(/Vault/);
  });

  it('are set only with permission, asked once on the tap; one per card, whatever is tapped again', async () => {
    const p = phone('undetermined', true);
    const note = reminderNote(r, 'c12')!;
    expect(note.id).toBe('wilma.2026-10-10.reminder.c12');
    expect(note.channel).toBe('reminders');
    expect(await setReminder(p.n, 'alice', note)).toBe('set');
    expect(p.asked.length).toBe(1);
    expect(await setReminder(p.n, 'alice', note)).toBe('set');
    expect(p.list.size).toBe(1);
    expect(await setReminder(phone('denied').n, 'alice', note)).toBe('denied');
  });

  it('are listed per account, soonest first, with their words, and cancelled one by one', async () => {
    const p = phone();
    await setReminder(p.n, 'alice', reminderNote({ at: '2026-10-11T09:00', text: 'Pay the nanny' }, 'c2')!);
    await setReminder(p.n, 'alice', reminderNote(r, 'c1')!);
    await setReminder(p.n, 'bob', reminderNote(r, 'c9')!);
    p.list.set('wilma.2026-10-10.leave.0', { id: 'wilma.2026-10-10.leave.0', userId: 'alice', at: 1 });
    const mine = await listReminders(p.n, 'alice');
    expect(mine.map((x) => x.text)).toEqual(['Call Sam', 'Pay the nanny']);
    expect(await cancelReminder(p.n, mine[0].id)).toBe(true);
    expect((await listReminders(p.n, 'alice')).map((x) => x.text)).toEqual(['Pay the nanny']);
    expect(await cancelReminder(p.n, 'wilma.2026-10-10.leave.0')).toBe(false); // only reminders here
  });

  it('are cancelled when another account signs in or on sign-out', async () => {
    const p = phone();
    await setReminder(p.n, 'alice', reminderNote(r, 'c1')!);
    await forgetOtherAccounts(p.n, 'bob');
    expect(p.list.size).toBe(0);
  });

  it('"cancel my reminder to call Sam" finds the ones holding every word, still ahead, soonest first', () => {
    const at = (h: number) => new Date(2026, 9, 10, h, 0).getTime();
    const rows = [
      { id: 'a', at: at(17), text: 'Call Sam back' },
      { id: 'b', at: at(12), text: 'Call the bank' },
      { id: 'c', at: at(8), text: 'Call Sam' }, // already shown
      { id: 'd', at: at(10), text: 'call sam about the car' },
    ];
    expect(matchReminders(rows, 'my reminder to call Sam', NOW).map((x) => x.id)).toEqual(['d', 'a']);
    expect(matchReminders(rows, undefined, NOW).map((x) => x.id)).toEqual(['d', 'b', 'a']);
    expect(matchReminders(rows, 'dentist', NOW)).toEqual([]);
  });
});

describe('the cards in the chat', () => {
  it('are read field by field from the stream; anything malformed is dropped', () => {
    expect(toChatEvent({ type: 'alarm', time: '06:30', days: ['mon', 'nope'], label: 'Gym', extra: 'x' })).toEqual({
      type: 'alarm', time: '06:30', days: ['mon'], label: 'Gym',
    });
    expect(toChatEvent({ type: 'alarm', time: '6:30' })).toBeNull();
    expect(toChatEvent({ type: 'reminder', at: '2026-10-10T17:00', text: 'Call Sam' })).toEqual({ type: 'reminder', at: '2026-10-10T17:00', text: 'Call Sam' });
    expect(toChatEvent({ type: 'reminder', at: 'tomorrow', text: 'x' })).toBeNull();
    expect(toChatEvent({ type: 'show_alarms' })).toEqual({ type: 'show_alarms' });
    expect(toChatEvent({ type: 'find_reminders', about: 'call Sam' })).toEqual({ type: 'find_reminders', about: 'call Sam' });
    expect(toAlarmData({ time: '25:00' })).toBeNull();
    expect(toReminderData({ at: '2026-10-10T17:00', text: '   ' })).toBeNull();
  });

  it('become cards in the conversation, under Wilma’s answer', () => {
    let s = chatReducer(initialChat(), { type: 'send', text: 'wake me at 6:30 and remind me at 5 to call Sam' });
    for (const event of [
      { type: 'text', text: 'Tap the cards to confirm.' },
      { type: 'alarm', time: '06:30' },
      { type: 'reminder', at: '2026-10-10T17:00', text: 'Call Sam' },
      { type: 'show_alarms' },
      { type: 'find_reminders' },
      { type: 'done', counted: true },
    ]) s = chatReducer(s, { type: 'event', event: toChatEvent(event)! });
    expect(s.entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'alarm', 'reminder', 'alarms', 'reminders']);
  });
});
