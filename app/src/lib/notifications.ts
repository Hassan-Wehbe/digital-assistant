// Scheduling Wilma's notifications on this phone (day planner step 4,
// docs/phase6-day-planner-step4-plan.md, Q1: the phone schedules them; no server push). The phone's
// notification system sits behind `Notifier` (deviceNotifier.ts), so tests need no phone.
//
// Every Wilma notification has an id "wilma.<date>.<kind>[.<n>]" and carries the account it was
// made for: on sign-out (and when another account signs in) every other account's are cancelled.
import type { BriefingSettings } from './briefingSettings';
import { mornings, type DayNote } from './dayAlerts';

export type Permission = 'granted' | 'denied' | 'undetermined';

/** A notification already scheduled: its id, and what it carries. */
export interface Scheduled {
  id: string;
  userId?: string;
  /** When it fires, in ms (as scheduled). */
  at?: number;
}

export interface Notifier {
  permission(): Promise<Permission>;
  /** Asks Android (13+) once; true when allowed. */
  ask(): Promise<boolean>;
  schedule(note: DayNote, userId: string): Promise<void>;
  cancel(id: string): Promise<void>;
  scheduled(): Promise<Scheduled[]>;
}

const PREFIX = 'wilma.';
const isOurs = (id: string) => id.startsWith(PREFIX);
const kindOf = (id: string) => id.split('.')[2];

/** Cancels the given notifications; a failure on one does not stop the rest. */
async function cancelAll(n: Notifier, ids: string[]): Promise<void> {
  for (const id of ids) await n.cancel(id).catch(() => {});
}

/**
 * Keeps the morning greetings in step with the settings: the next mornings at the briefing time
 * are scheduled, others (old time, turned off) cancelled. A morning already scheduled at the right
 * time is left alone (step 2 replaces one with that day's summary). False when it failed.
 */
export async function syncMornings(n: Notifier, userId: string, s: BriefingSettings, now: Date): Promise<boolean> {
  try {
    const wanted = new Map(mornings(s, now).map((m) => [m.id, m]));
    const existing = (await n.scheduled()).filter((x) => isOurs(x.id) && kindOf(x.id) === 'morning');
    const keep = new Set<string>();
    for (const x of existing) {
      const want = wanted.get(x.id);
      if (want && x.userId === userId && x.at === want.at.getTime()) keep.add(x.id);
    }
    await cancelAll(n, existing.filter((x) => !keep.has(x.id)).map((x) => x.id));
    if (wanted.size && (await n.permission()) !== 'granted') return false;
    for (const [id, note] of wanted) if (!keep.has(id)) await n.schedule(note, userId);
    return true;
  } catch {
    return false;
  }
}

/** Cancels every leave-by alert (the setting was turned off). */
export async function cancelLeaveAlerts(n: Notifier): Promise<void> {
  try {
    const ids = (await n.scheduled()).map((x) => x.id).filter((id) => isOurs(id) && kindOf(id) === 'leave');
    await cancelAll(n, ids);
  } catch {
    // Nothing to do: the next plan replaces them anyway.
  }
}

/** After a settings change or on app start: alerts off → cancelled; mornings kept in step. */
export async function applyBriefing(n: Notifier, userId: string, s: BriefingSettings, now: Date): Promise<boolean> {
  if (!s.leaveAlerts) await cancelLeaveAlerts(n);
  return syncMornings(n, userId, s, now);
}

/**
 * Cancels every Wilma notification not made for `keep` (signed out: null, so all of them). Another
 * account on this phone never sees them.
 */
export async function forgetOtherAccounts(n: Notifier, keep: string | null): Promise<void> {
  try {
    const ids = (await n.scheduled()).filter((x) => isOurs(x.id) && (keep === null || x.userId !== keep)).map((x) => x.id);
    await cancelAll(n, ids);
  } catch {
    // Unreadable: nothing more can be done here; they show "tap to see your day" at most.
  }
}

/** Where a tapped notification may go: only My day, for a plain date. Anything else opens home. */
export function tapTarget(data: unknown, userId: string | null): string {
  if (typeof data !== 'object' || data === null) return '/';
  const { url, userId: owner } = data as Record<string, unknown>;
  if (!userId || owner !== userId || typeof url !== 'string') return '/';
  return /^\/day(\?date=\d{4}-\d{2}-\d{2})?$/.test(url) ? url : '/';
}
