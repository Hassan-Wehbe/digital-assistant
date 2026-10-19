// Date night and family day (planners step 3, docs/planners-plan.md; design D40): the plan the
// `chat` function's outing route answers ({"mode":"outing"}; supabase/functions/chat/outing.ts),
// checked here field by field, the client that asks for it, and what the screens need from it:
// the days to pick from, the kinds of date and their times, who is coming as roles and ages only
// (Q4: the household's names never leave the phone), the busy times it was planned around (the
// calendar's events are never steps of a plan, owner 2026-10-19), and one calendar event for the
// whole plan with its steps in the notes (Q6).
//
// The plan is kept only in memory while the screen is open: Mapbox's terms do not allow storing
// its Directions results (as My day). Another idea is another plan, counted again (Q7).
import { ageOf, type Member } from './household';
import type { EventCardData } from './phoneActions';
import { WilmaError } from './wilma';

export type OutingKind = 'date' | 'family';

/** What kind of date (owner, 2026-10-19), as the server takes it. */
export type Occasion = 'dinner' | 'lunch' | 'coffee' | 'drinks' | 'activity';

/** Each kind of date: its chip, its start times to pick from, the usual one (as the server's). */
export const OCCASIONS: { value: Occasion; label: string; title: string; times: string[]; start: string }[] = [
  { value: 'dinner', label: 'Dinner', title: 'Date night', times: ['18:00', '19:00', '20:00'], start: '19:00' },
  { value: 'lunch', label: 'Lunch', title: 'Lunch date', times: ['11:30', '12:00', '13:00'], start: '12:00' },
  { value: 'coffee', label: 'Coffee', title: 'Coffee date', times: ['08:00', '10:00', '15:00'], start: '10:00' },
  { value: 'drinks', label: 'Drinks', title: 'Drinks', times: ['19:00', '20:00', '21:00'], start: '20:00' },
  { value: 'activity', label: 'Something to do', title: 'A date out', times: ['10:00', '14:00', '17:00'], start: '14:00' },
];

export const occasionOf = (o: Occasion) => OCCASIONS.find((x) => x.value === o)!;

export interface OutingPlace {
  id: string;
  title: string;
  kind: string;
  cuisine?: string[];
  price_level?: number;
  address?: string;
  maps_url?: string;
  lat: number;
  lng: number;
}

export interface OutingStep {
  start: string;
  end: string;
  line: string;
  place?: OutingPlace;
  home?: true;
  drive_min?: number;
}

export interface OutingPlan {
  kind: OutingKind;
  occasion?: Occasion;
  date: string;
  title: string;
  from: string;
  leave_at?: string;
  steps: OutingStep[];
  back_home_min?: number;
  alternative?: { place: OutingPlace; line: string; minutes?: number };
  /** The calendar's busy times it was planned around (times only). */
  around: { start: string; end: string }[];
  rain: { at: string; rain_pct: number }[];
  credits: string[];
}

export type OutingAnswer =
  | { plan: OutingPlan; usage: { used?: number; limit?: number } }
  | { empty: 'no_home' | 'no_places' | 'no_plan' }
  | { problem: 'pro_required' | 'fair_use' | 'allowance_used' | 'connection' };

/** What the screens send (the server refuses anything else; no field can carry a name). */
export interface OutingBody {
  mode: 'outing';
  kind: OutingKind;
  date: string;
  tz: string;
  now?: string;
  start?: string;
  end?: string;
  occasion?: Occasion;
  budget?: 1 | 2 | 3;
  mood?: 'favourite' | 'new';
  setting?: 'outdoor' | 'indoor' | 'either';
  who?: { adults: number; child_ages: number[] };
  events: Record<string, unknown>[];
  start_from?: { home: string };
  avoid?: string[];
}

// ---- Checking the answer -----------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const mins = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1440;
const onMap = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function toPlace(raw: unknown): OutingPlace | null {
  if (!isObject(raw) || !text(raw.id, 100) || !text(raw.title) || !onMap(raw.lat, raw.lng)) return null;
  const cuisine = Array.isArray(raw.cuisine) ? raw.cuisine.filter((c): c is string => text(c, 40)).slice(0, 3) : [];
  return {
    id: raw.id, title: raw.title, kind: text(raw.kind, 40) ? raw.kind : 'other',
    ...(cuisine.length ? { cuisine } : {}),
    ...(typeof raw.price_level === 'number' && [1, 2, 3, 4].includes(raw.price_level) ? { price_level: raw.price_level } : {}),
    ...(text(raw.address) ? { address: raw.address } : {}),
    ...(typeof raw.maps_url === 'string' && /^https:\/\//.test(raw.maps_url) && raw.maps_url.length <= 500 ? { maps_url: raw.maps_url } : {}),
    lat: raw.lat as number, lng: raw.lng as number,
  };
}

function toStep(raw: unknown): OutingStep | null {
  if (!isObject(raw) || typeof raw.start !== 'string' || !HHMM.test(raw.start) || typeof raw.end !== 'string' || !HHMM.test(raw.end)) return null;
  const line = typeof raw.line === 'string' ? raw.line.slice(0, 200) : '';
  const drive = mins(raw.drive_min) ? { drive_min: raw.drive_min } : {};
  const place = toPlace(raw.place);
  if (place) return { start: raw.start, end: raw.end, line, place, ...drive };
  if (raw.home === true) return { start: raw.start, end: raw.end, line, home: true, ...drive };
  return null;
}

/** The plan, checked; null when it is not one (no place step at all included). */
export function toOutingPlan(raw: unknown): OutingPlan | null {
  if (!isObject(raw) || (raw.kind !== 'date' && raw.kind !== 'family') || typeof raw.date !== 'string' || !DAY.test(raw.date)) return null;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 6).map(toStep).filter((s): s is OutingStep => s !== null);
  if (!steps.some((s) => s.place)) return null;
  const alt = isObject(raw.alternative) ? toPlace(raw.alternative.place) : null;
  const occasion = raw.kind === 'date' ? OCCASIONS.find((o) => o.value === raw.occasion) : undefined;
  return {
    kind: raw.kind, ...(occasion ? { occasion: occasion.value } : {}), date: raw.date,
    title: text(raw.title, 80) ? raw.title : raw.kind === 'date' ? (occasion?.title ?? 'Date night') : 'Family day',
    from: text(raw.from, 60) ? raw.from : 'Home',
    ...(typeof raw.leave_at === 'string' && HHMM.test(raw.leave_at) ? { leave_at: raw.leave_at } : {}),
    steps,
    ...(mins(raw.back_home_min) ? { back_home_min: raw.back_home_min } : {}),
    ...(alt && isObject(raw.alternative)
      ? { alternative: { place: alt, line: typeof raw.alternative.line === 'string' ? raw.alternative.line.slice(0, 200) : '', ...(mins(raw.alternative.minutes) ? { minutes: raw.alternative.minutes } : {}) } }
      : {}),
    around: (Array.isArray(raw.around) ? raw.around : [])
      .filter((b): b is { start: string; end: string } => isObject(b) && typeof b.start === 'string' && HHMM.test(b.start) && typeof b.end === 'string' && HHMM.test(b.end))
      .slice(0, 10).map((b) => ({ start: b.start, end: b.end })),
    rain: (Array.isArray(raw.rain) ? raw.rain : [])
      .filter((h): h is { at: string; rain_pct: number } => isObject(h) && typeof h.at === 'string' && LOCAL.test(h.at) && typeof h.rain_pct === 'number' && h.rain_pct >= 0 && h.rain_pct <= 100)
      .slice(0, 24).map((h) => ({ at: h.at, rain_pct: h.rain_pct })),
    credits: (Array.isArray(raw.credits) ? raw.credits : []).filter((c): c is string => text(c, 100)).slice(0, 4),
  };
}

/** The outing route's answer (status and body) as the screens read it. */
export function toOutingAnswer(status: number, body: unknown): OutingAnswer {
  const b = isObject(body) ? body : {};
  if (status === 403 && b.error === 'pro_required') return { problem: 'pro_required' };
  if (status === 429 && (b.error === 'fair_use' || b.error === 'allowance_used')) return { problem: b.error };
  if (status !== 200) return { problem: 'connection' };
  if (b.plan === null && (b.reason === 'no_home' || b.reason === 'no_places' || b.reason === 'no_plan')) return { empty: b.reason };
  const plan = toOutingPlan(b.plan);
  if (!plan) return { problem: 'connection' };
  const u = isObject(b.usage) ? b.usage : {};
  return { plan, usage: { ...(mins(u.used) ? { used: u.used } : {}), ...(mins(u.limit) ? { limit: u.limit } : {}) } };
}

// ---- The client --------------------------------------------------------------------------------

export type JsonFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

export function outingClient({ url, token, refresh, fetch: f = fetch as unknown as JsonFetch }: {
  url: string;
  token: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  fetch?: JsonFetch;
}) {
  /** Asks for one plan. Never throws except when the session has ended (a signed-out WilmaError). */
  async function plan(body: OutingBody, signal?: AbortSignal): Promise<OutingAnswer> {
    const json = JSON.stringify(body);
    const post = (accessToken: string) =>
      f(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: json, signal });
    let accessToken = await token();
    if (!accessToken) throw new WilmaError('Please sign in again.', true);
    try {
      let res = await post(accessToken);
      if (res.status === 401) {
        accessToken = await refresh();
        if (!accessToken) throw new WilmaError(SESSION_ENDED, true);
        res = await post(accessToken);
        if (res.status === 401) throw new WilmaError(SESSION_ENDED, true);
      }
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // an unreadable body is a connection problem below
      }
      return toOutingAnswer(res.status, parsed);
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      return { problem: 'connection' };
    }
  }
  return { plan };
}

export type OutingClient = ReturnType<typeof outingClient>;

// ---- What the screens need ---------------------------------------------------------------------

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** The next `n` days from `today`, today included (the day chips; any later day from the picker). */
export const nextDays = (today: string, n = 7): string[] => Array.from({ length: n }, (_, i) => addDays(today, i));

/** The next given weekday (0 Sunday … 6 Saturday) from `today`, today included. */
export function nextWeekday(today: string, day: number): string {
  return addDays(today, (day - weekday(today) + 7) % 7);
}

/** Who is coming, as the server takes it: roles and ages only, never a label (Q4). */
export function whoFrom(members: Member[], thisYear: number): { adults: number; child_ages: number[] } {
  return {
    adults: members.filter((m) => m.kind === 'adult').length,
    child_ages: members.map((m) => ageOf(m, thisYear)).filter((a): a is number => a !== null).map((a) => Math.min(17, a)).slice(0, 10),
  };
}

/** "Dinner and a walk · Fri 7:00 pm" etc. need these. */
export function clock(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? 'am' : 'pm'}`;
}

/** The second line of a step: what it is, how far. */
export function stepDetail(s: OutingStep): string {
  const parts: string[] = [];
  if (s.place) {
    if (s.place.cuisine?.length) parts.push(s.place.cuisine.join(', '));
    if (s.place.price_level) parts.push('$'.repeat(s.place.price_level));
  }
  if (s.drive_min !== undefined) parts.push(`${s.drive_min} min drive`);
  return parts.join(' · ');
}

/** "Rain likely around 3 pm (70%)" when it is likely; null otherwise. */
export function rainLine(plan: OutingPlan): string | null {
  const wet = plan.rain.filter((h) => h.rain_pct >= 50);
  if (!wet.length) return plan.rain.length ? 'Dry, by the forecast.' : null;
  const top = wet.reduce((a, b) => (b.rain_pct > a.rain_pct ? b : a));
  return `Rain likely around ${clock(top.at.slice(11, 16))} (${top.rain_pct}%).`;
}

/** "Planned around your calendar (busy 11:00 am–12:00 pm)." when it had busy times; null otherwise. */
export function aroundLine(plan: OutingPlan): string | null {
  if (!plan.around.length) return null;
  const shown = plan.around.slice(0, 3).map((b) => `${clock(b.start)}–${clock(b.end)}`).join(', ');
  const more = plan.around.length > 3 ? ` and ${plan.around.length - 3} more` : '';
  return `Planned around your calendar (busy ${shown}${more}).`;
}

/** What the screen says when there is no plan. */
export const EMPTY_TEXT: Record<'no_home' | 'no_places' | 'no_plan', string> = {
  no_home: 'Set where you leave from first (Settings → Homes), so the drives can be worked out.',
  no_places: 'Wilma plans from places you saved. Save a few (restaurants, cafés, bars, parks, things to do) and mark the right ones “date night” or “kids”.',
  no_plan: 'Wilma couldn’t make a plan from your places this time. Try Another idea, or change the choices.',
};

export const PROBLEM_TEXT: Record<'fair_use' | 'allowance_used' | 'connection', string> = {
  fair_use: 'Today’s plans are used up. Try again tomorrow.',
  allowance_used: 'This month’s AI allowance is used up, so Wilma can’t plan this now.',
  connection: 'Could not make the plan just now. Check your connection and try again.',
};

/**
 * One calendar event for the whole plan (Q6): from the first step to the last, at the first place,
 * the steps in its notes. Added only when the user taps Add to calendar.
 */
export function planEvent(plan: OutingPlan): EventCardData {
  const first = plan.steps[0];
  const last = plan.steps[plan.steps.length - 1];
  const firstPlace = plan.steps.find((s) => s.place)?.place;
  const notes = [
    ...(plan.leave_at ? [`${clock(plan.leave_at)} Leave ${plan.from}`] : []),
    ...plan.steps.map((s) => `${clock(s.start)} ${s.place?.title ?? 'Home'}${s.line ? `: ${s.line}` : ''}`),
    'Planned with Wilma.',
  ].join('\n');
  return {
    title: plan.title,
    start: `${plan.date}T${first.start}`,
    end: `${plan.date}T${last.end}`,
    allDay: false,
    ...(firstPlace ? { location: firstPlace.address ?? firstPlace.title } : {}),
    notes: notes.slice(0, 2000),
  };
}

/** Use this one: the alternative takes the first place's step (its drive is not known then). */
export function withAlternative(plan: OutingPlan): OutingPlan {
  if (!plan.alternative) return plan;
  const i = plan.steps.findIndex((s) => s.place);
  const steps = plan.steps.map((s, k) =>
    k === i ? { start: s.start, end: s.end, line: plan.alternative!.line, place: plan.alternative!.place, ...(plan.alternative!.minutes !== undefined && i === 0 ? { drive_min: plan.alternative!.minutes } : {}) } : s,
  );
  const first = steps[0];
  const leave = i === 0 && first.drive_min !== undefined ? toTime(toMin(first.start) - first.drive_min) : i === 0 ? undefined : plan.leave_at;
  const { alternative: _a, leave_at: _l, ...rest } = plan;
  return { ...rest, steps, ...(leave ? { leave_at: leave } : {}) };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(Math.max(0, m) / 60)).padStart(2, '0')}:${String(Math.max(0, m) % 60).padStart(2, '0')}`;

/** Another idea: the places just shown are left out (when others fit). */
export const avoidOf = (plan: OutingPlan): string[] => plan.steps.flatMap((s) => (s.place ? [s.place.id] : []));
