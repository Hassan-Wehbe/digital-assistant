// The usage meter (docs/design.md D28, part 1): this month's AI allowance shown as "about N
// requests left, resets Nov 1", read from my_ai_allowance() as the signed-in user (RLS-scoped,
// security definer that only answers for the caller). Shown as requests, never dollars (D22).

/** What my_ai_allowance() returns. */
export interface Allowance {
  /** First day of the allowance month, e.g. "2026-10-01". */
  month: string;
  used_cents: number;
  requests: number;
  limit_cents: number;
  used_fraction: number;
}

/** From this share of the month's allowance, the meter warns (as the chat's banner does). */
export const LOW_FRACTION = 0.8;
/** Requests counted before the user's own average cost is trusted. */
export const MIN_REQUESTS_FOR_AVERAGE = 5;
/** A typical chat request's cost, in cents, until the user has their own average (on the high
 * side: the evaluation's cases cost about 0.04 cents each, everyday messages less). */
export const TYPICAL_REQUEST_CENTS = 0.04;

export interface UsageSummary {
  /** 0-1, how much of the month is used. */
  fraction: number;
  /** About how many requests are left, rounded down so it never promises too much. */
  requestsLeft: number;
  /** "Nov 1": when the allowance starts again. */
  resetsOn: string;
  low: boolean;
  usedUp: boolean;
}

/** Rounds down to a number that reads as an estimate: 7, 40, 350, 1,200. */
export function roughlyDown(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = n < 20 ? 1 : n < 200 ? 10 : n < 2000 ? 50 : 100;
  return Math.floor(n / step) * step;
}

/** "Nov 1" for the month after `month` ("2026-10-01"). */
export function resetDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 'the 1st of next month';
  const next = new Date(Date.UTC(y, m, 1));
  return `${next.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} 1`;
}

export function usageSummary(a: Allowance): UsageSummary {
  const used = Math.max(0, Number(a.used_cents) || 0);
  const limit = Math.max(0, Number(a.limit_cents) || 0);
  const requests = Math.max(0, Number(a.requests) || 0);
  const fraction = Math.min(1, Math.max(0, Number(a.used_fraction) || 0));
  const perRequest = requests >= MIN_REQUESTS_FOR_AVERAGE && used > 0
    ? Math.max(used / requests, TYPICAL_REQUEST_CENTS / 4)
    : TYPICAL_REQUEST_CENTS;
  const usedUp = fraction >= 1 || limit <= used;
  return {
    fraction,
    requestsLeft: usedUp ? 0 : roughlyDown((limit - used) / perRequest),
    resetsOn: resetDay(a.month),
    low: fraction >= LOW_FRACTION,
    usedUp,
  };
}

/** The meter's sentence. */
export function usageText(s: UsageSummary): string {
  if (s.usedUp) return `You've used this month's AI requests. They start again on ${s.resetsOn}. Search, notes and your vault still work.`;
  return `About ${s.requestsLeft.toLocaleString('en-US')} requests left this month · resets ${s.resetsOn}`;
}

/** Reads the allowance; null when it cannot be read (the meter then stays hidden). */
export async function loadAllowance(
  rpc: (fn: 'my_ai_allowance') => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Allowance | null> {
  try {
    const { data, error } = await rpc('my_ai_allowance');
    if (error || !data || typeof data !== 'object') return null;
    const a = data as Partial<Allowance>;
    if (typeof a.month !== 'string' || typeof a.limit_cents !== 'number') return null;
    return {
      month: a.month,
      used_cents: Number(a.used_cents) || 0,
      requests: Number(a.requests) || 0,
      limit_cents: a.limit_cents,
      used_fraction: Number(a.used_fraction) || 0,
    };
  } catch {
    return null;
  }
}
