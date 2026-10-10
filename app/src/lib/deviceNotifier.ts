// The phone's notifications for Wilma (notifications.ts): local notifications only, through
// expo-notifications, on one Android channel "Day plan". No push token is ever asked for. Android
// may hold one back a few minutes while the phone sleeps (no exact-alarm permission; the plan's
// "Timing"). The web build has none.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Notifier, Permission } from './notifications';

const CHANNEL = 'day-plan';

// Shown while Wilma is open too (a leave-by alert matters then as well).
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

let channelReady: Promise<unknown> | null = null;
const channel = () =>
  (channelReady ??= Platform.OS === 'android'
    ? Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Day plan', importance: Notifications.AndroidImportance.DEFAULT })
    : Promise.resolve());

const asPermission = (status: string): Permission => (status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');

const phone: Notifier = {
  async permission() {
    return asPermission((await Notifications.getPermissionsAsync()).status);
  },
  async ask() {
    await channel(); // Android 13+ asks only once a channel exists.
    return (await Notifications.requestPermissionsAsync()).status === 'granted';
  },
  async schedule(note, userId) {
    await channel();
    await Notifications.scheduleNotificationAsync({
      identifier: note.id,
      content: { title: note.title, body: note.body, data: { url: note.url, userId, at: note.at.getTime() } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: note.at, channelId: CHANNEL },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
  async scheduled() {
    return (await Notifications.getAllScheduledNotificationsAsync()).map((r) => {
      const data = (r.content.data ?? {}) as Record<string, unknown>;
      return {
        id: r.identifier,
        ...(typeof data.userId === 'string' ? { userId: data.userId } : {}),
        ...(typeof data.at === 'number' ? { at: data.at } : {}),
      };
    });
  },
};

const none: Notifier = {
  permission: async () => 'denied',
  ask: async () => false,
  schedule: async () => {},
  cancel: async () => {},
  scheduled: async () => [],
};

export const deviceNotifier: Notifier = Platform.OS === 'web' ? none : phone;

/** Calls `open` with the data of a tapped Wilma notification (also the one that started the app). */
export function onNotificationTap(open: (data: unknown) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) {
        open(r.notification.request.content.data);
        void Notifications.clearLastNotificationResponseAsync();
      }
    })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
  return () => sub.remove();
}
