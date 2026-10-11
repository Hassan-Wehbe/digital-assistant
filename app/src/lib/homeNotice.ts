// Noticing which home you are at (homes, design D36, docs/my-places-plan.md step 4).
//
// Only while planning (opening My day for today, or the chat's "plan my day"), only when the user
// turned on Settings → Homes → "Notice which home I'm at when I plan" (Q3, off until turned on;
// kept on this phone, per account), and only with two or more homes. The phone then reads its
// location ONCE, compares it here with the saved homes (within 150 m counts as "at"), and keeps the
// reading nowhere: it is not returned, stored or sent. Only the home the user then picks goes to
// the server, as its id (`start_from`).
//
// While planning, the location permission is only checked, never asked for: it is asked once, when
// the switch is turned on. Without it, or with location off, nothing is read and nothing is asked.
// At the default home, or away from every saved home, nothing is asked: the plan starts from the
// default (Q4).
import type { SettingsStore } from './calendarSettings';
import type { HomeRow } from './homePlace';
import type { LocationDeps } from './location';

/** Within this many metres of a saved home counts as being there (plan, small questions). */
export const AT_HOME_METRES = 150;
/** The reading must not hold up planning: after this long, nothing is asked. */
export const NOTICE_TIMEOUT_MS = 10_000;

const key = (userId: string) => `wilma.homeNotice.v1.${userId}`;

/** The switch; off when it was never turned on or cannot be read. */
export async function loadNotice(store: SettingsStore, userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await store.get(key(userId))) === 'on';
  } catch {
    return false;
  }
}

/** Saves the switch; false when the phone could not write it. */
export async function saveNotice(store: SettingsStore, userId: string, on: boolean): Promise<boolean> {
  if (!userId) return false;
  try {
    await store.set(key(userId), on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

/**
 * Turning the switch on asks for the location permission (the only place it is asked for this).
 * Null when it is given; else the sentence saying how to allow it.
 */
export async function allowForNotice(deps: Pick<LocationDeps, 'permission' | 'askPermission'>, noPermission: string): Promise<string | null> {
  try {
    let p = await deps.permission();
    if (!p.granted && p.canAskAgain) p = await deps.askPermission();
    return p.granted ? null : noPermission;
  } catch {
    return noPermission;
  }
}

/** Metres between two points (haversine; plenty for 150 m). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest saved home within 150 m of `here`, or null. */
export function homeAt(here: { lat: number; lng: number }, homes: HomeRow[]): HomeRow | null {
  let best: HomeRow | null = null;
  let bestM = AT_HOME_METRES;
  for (const h of homes) {
    const m = metresBetween(here, h);
    if (m <= bestM) {
      best = h;
      bestM = m;
    }
  }
  return best;
}

/** What to ask: "You're at Mom's. Plan from Mom's · from Home". Home rows only, never the reading. */
export interface Noticed {
  at: HomeRow;
  def: HomeRow;
}

export interface NoticeDeps {
  /** The Settings switch (loadNotice). */
  on: () => Promise<boolean>;
  /** The saved homes (homePlace.ts listHomes). */
  homes: () => Promise<HomeRow[]>;
  location: Pick<LocationDeps, 'permission' | 'servicesOn' | 'position'>;
}

/**
 * One reading, only when the switch is on and there are two homes or more; a question only when
 * the phone is at a saved home that is not the default. Never asks for the permission. Any failure
 * or a slow reading: null (plan from the default, as without the switch).
 */
export async function noticeHome(deps: NoticeDeps, timeoutMs = NOTICE_TIMEOUT_MS): Promise<Noticed | null> {
  try {
    if (!(await deps.on())) return null;
    const homes = await deps.homes();
    const def = homes.find((h) => h.is_default);
    if (homes.length < 2 || !def) return null;
    if (!(await deps.location.permission()).granted) return null;
    if (!(await deps.location.servicesOn())) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((done) => {
      timer = setTimeout(() => done(null), timeoutMs);
    });
    const pos = await Promise.race([deps.location.position(), late]).finally(() => clearTimeout(timer));
    if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) return null;
    const at = homeAt({ lat: pos.latitude, lng: pos.longitude }, homes);
    return at && !at.is_default ? { at, def } : null;
  } catch {
    return null;
  }
}

/** The question's words. */
export const noticeText = (n: { at: { label: string } }) => `You’re at ${n.at.label}. Plan your day from:`;
