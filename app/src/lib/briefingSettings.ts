// Settings → Morning briefing (day planner step 4, docs/phase6-day-planner-step4-plan.md): every
// part is its own setting (owner, 2026-10-10). Kept on this phone only, per account, like the
// calendar choice (calendarSettings.ts); never sent to the server. Everything starts off.
import type { SettingsStore } from './calendarSettings';

/** Off; built in Wilma only (no notification); built in Wilma and sent as a notification. */
export type BriefingMode = 'off' | 'app' | 'notify';

export const LEADS = [5, 10, 15, 20] as const;
export type Lead = (typeof LEADS)[number];

export interface BriefingSettings {
  briefing: BriefingMode;
  /** The phone's local time, "07:00". */
  time: string;
  leaveAlerts: boolean;
  /** Minutes before the leave-by time. */
  lead: Lead;
}

export const BRIEFING_OFF: BriefingSettings = { briefing: 'off', time: '07:00', leaveAlerts: false, lead: 10 };

export const MODE_CHOICES: { mode: BriefingMode; title: string }[] = [
  { mode: 'off', title: 'Off' },
  { mode: 'app', title: 'In Wilma only' },
  { mode: 'notify', title: 'In Wilma and as a notification' },
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const key = (userId: string) => `wilma.briefing.v1.${userId}`;

/** The settings read back, checked field by field: anything odd falls back to its default. */
export function parseBriefing(raw: string | null): BriefingSettings {
  if (!raw) return BRIEFING_OFF;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return BRIEFING_OFF;
    const r = v as Record<string, unknown>;
    return {
      briefing: MODE_CHOICES.some((m) => m.mode === r.briefing) ? (r.briefing as BriefingMode) : 'off',
      time: typeof r.time === 'string' && TIME.test(r.time) ? r.time : BRIEFING_OFF.time,
      leaveAlerts: r.leaveAlerts === true,
      lead: (LEADS as readonly unknown[]).includes(r.lead) ? (r.lead as Lead) : BRIEFING_OFF.lead,
    };
  } catch {
    return BRIEFING_OFF;
  }
}

export async function loadBriefing(store: SettingsStore, userId: string): Promise<BriefingSettings> {
  if (!userId) return BRIEFING_OFF;
  try {
    return parseBriefing(await store.get(key(userId)));
  } catch {
    return BRIEFING_OFF;
  }
}

/** Saves the settings; false when the phone could not write them. */
export async function saveBriefing(store: SettingsStore, userId: string, s: BriefingSettings): Promise<boolean> {
  if (!userId) return false;
  try {
    await store.set(key(userId), JSON.stringify(parseBriefing(JSON.stringify(s))));
    return true;
  } catch {
    return false;
  }
}

/** True when a setting sends notifications (only then does Android's permission matter). */
export const sendsNotifications = (s: BriefingSettings) => s.briefing === 'notify' || s.leaveAlerts;

/** "07:00" → "7:00 am". */
export function timeText(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The line under Settings → Morning briefing. */
export function briefingSummary(s: BriefingSettings): string {
  const parts: string[] = [];
  if (s.briefing === 'app') parts.push(`In Wilma at ${timeText(s.time)}`);
  if (s.briefing === 'notify') parts.push(`At ${timeText(s.time)}, with a notification`);
  if (s.leaveAlerts) parts.push(`leave-by alerts ${s.lead} min before`);
  if (!parts.length) return 'Off';
  const line = parts.join('; ');
  return line[0].toUpperCase() + line.slice(1);
}
