// Ages (docs/age-plan.md step 3, design D44): the month and year of birth asked at sign-up, and
// once for accounts made before; the server works out the age and keeps only the result ("21 or
// over", or the month cocktails open; Q5 option B). The app never stores or logs the month and year:
// they go to the server once and are dropped. Under 21, or until it is answered, drinks are
// mocktails (Q6): the server enforces it; the app only names things to match.
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface AgeStatus {
  /** The month and year have been given (at sign-up or once after). */
  asked: boolean;
  is21: boolean;
  /** Under 21: the first day of the month cocktails open ("2028-03-01"). */
  alcoholFrom?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** my_age_status() as the server sends it; null when it is not one. */
export function toAgeStatus(raw: unknown): AgeStatus | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.asked !== 'boolean' || typeof r.is_21 !== 'boolean') return null;
  return {
    asked: r.asked,
    is21: r.is_21,
    ...(!r.is_21 && typeof r.alcohol_from === 'string' && DAY.test(r.alcohol_from) ? { alcoholFrom: r.alcohol_from } : {}),
  };
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

/** The account's age status; null when it could not be read (the server still decides). */
export async function loadAgeStatus(rpc: Rpc): Promise<AgeStatus | null> {
  try {
    const { data, error } = await rpc('my_age_status');
    return error ? null : toAgeStatus(data);
  } catch {
    return null;
  }
}

/**
 * A month (1-12) and a year as typed, checked: a real month, a four-digit year, not in the future,
 * not more than 120 years ago. The minimum age is the server's (it says so in its own words).
 */
export function birthProblem(month: number | null, year: string, today: Date): string | null {
  const y = year.trim();
  if (!month || !/^\d{4}$/.test(y)) return 'Enter your month and year of birth.';
  const n = Number(y);
  const thisYear = today.getFullYear();
  if (month < 1 || month > 12 || n < thisYear - 120 || n > thisYear || (n === thisYear && month > today.getMonth() + 1)) {
    return 'Please enter a real month and year of birth.';
  }
  return null;
}

/**
 * Accounts made before (asked once): sends the month and year; the server keeps only the result.
 * Its messages are plain ("Your age is already set. If it is wrong, contact us."); the month and
 * year are never repeated or kept here.
 */
export async function giveBirthMonth(rpc: Rpc, month: number | null, year: string, today: Date): Promise<{ status: AgeStatus } | { error: string }> {
  const problem = birthProblem(month, year, today);
  if (problem) return { error: problem };
  try {
    const { data, error } = await rpc('set_birth_month', { p_month: month, p_year: Number(year.trim()) });
    if (error) {
      return { error: error.code === 'P0001' || error.code === '22023' ? (error.message ?? 'That was not saved.') : 'Could not save it just now. Check your connection and try again.' };
    }
    const status = toAgeStatus(data);
    return status ? { status } : { error: 'Could not save it just now. Try again.' };
  } catch {
    return { error: 'Could not save it just now. Check your connection and try again.' };
  }
}

/** Mocktails only: under 21, not answered yet, or not known (Q6; the server decides the same). */
export const mocktailsOnly = (s: AgeStatus | null): boolean => !s?.is21;

/** The drinks words for this account: Make a cocktail / Make a mocktail, and the space's name. */
export function drinks(s: AgeStatus | null): { icon: string; button: string; space: string; one: string } {
  return mocktailsOnly(s)
    ? { icon: '🍹', button: 'Make a mocktail', space: 'Mocktails', one: 'mocktail' }
    : { icon: '🍸', button: 'Make a cocktail', space: 'Cocktails', one: 'cocktail' };
}

/** Settings → Account: "Cocktails: yes (21 or over)", "Cocktails from March 2028", or not answered yet. */
export function cocktailsLine(s: AgeStatus | null): string {
  if (!s) return 'Cocktails: could not be checked just now.';
  if (s.is21) return 'Cocktails: yes (21 or over).';
  if (!s.asked) return 'Cocktails: mocktails only until you give your month and year of birth.';
  if (s.alcoholFrom) return `Cocktails from ${MONTH_NAMES[Number(s.alcoholFrom.slice(5, 7)) - 1]} ${s.alcoholFrom.slice(0, 4)}; mocktails until then.`;
  return 'Cocktails: mocktails only.';
}
