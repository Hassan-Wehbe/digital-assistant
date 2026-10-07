import { describe, expect, it } from '@jest/globals';

import { loadAllowance, resetDay, roughlyDown, TYPICAL_REQUEST_CENTS, usageCounterText, usageSummary, usageText } from './usage';

const month = '2026-10-01';

describe('usage meter', () => {
  it('rounds down to a number that reads as an estimate', () => {
    expect([0, 7.9, 19.5, 47, 199, 357, 1999, 2499, -3, NaN].map(roughlyDown)).toEqual([0, 7, 19, 40, 190, 350, 1950, 2400, 0, 0]);
  });

  it('resets on the 1st of the next month, also across the year end', () => {
    expect(resetDay('2026-10-01')).toBe('Nov 1');
    expect(resetDay('2026-12-01')).toBe('Jan 1');
    expect(resetDay('nonsense')).toBe('the 1st of next month');
  });

  it("uses a typical cost until there are 5 requests, then the user's own average", () => {
    const fresh = usageSummary({ month, used_cents: 0.1, requests: 2, limit_cents: 100, used_fraction: 0.001 });
    expect(fresh.requestsLeft).toBe(roughlyDown(99.9 / TYPICAL_REQUEST_CENTS));
    // 10 requests at 0.1 cents each: 99 cents left is about 990 requests.
    const own = usageSummary({ month, used_cents: 1, requests: 10, limit_cents: 100, used_fraction: 0.01 });
    expect(own.requestsLeft).toBe(950);
    expect(own.low).toBe(false);
    expect(usageText(own)).toBe('About 950 requests left this month · resets Nov 1');
  });

  it('warns from 80%, and says so plainly when used up', () => {
    const low = usageSummary({ month, used_cents: 85, requests: 2000, limit_cents: 100, used_fraction: 0.85 });
    expect(low.low).toBe(true);
    expect(low.usedUp).toBe(false);
    expect(low.requestsLeft).toBe(350);
    const done = usageSummary({ month, used_cents: 100.2, requests: 2400, limit_cents: 100, used_fraction: 1 });
    expect(done.usedUp).toBe(true);
    expect(done.requestsLeft).toBe(0);
    expect(usageText(done)).toBe("You've used this month's AI requests. They start again on Nov 1. Search, notes and your vault still work.");
  });

  it('the box counter is short: about N left, then N left with the reset day, then used up', () => {
    const fine = usageSummary({ month, used_cents: 20, requests: 500, limit_cents: 100, used_fraction: 0.2 });
    expect(usageCounterText(fine)).toBe('About 2,000 left');
    const low = usageSummary({ month, used_cents: 85, requests: 2000, limit_cents: 100, used_fraction: 0.85 });
    expect(usageCounterText(low)).toBe('350 left · resets Nov 1');
    const done = usageSummary({ month, used_cents: 100.2, requests: 2400, limit_cents: 100, used_fraction: 1 });
    expect(usageCounterText(done)).toBe('Used up · resets Nov 1');
  });

  it('a zero allowance is used up; odd numbers never make a negative or huge estimate', () => {
    expect(usageSummary({ month, used_cents: 0, requests: 0, limit_cents: 0, used_fraction: 1 }).usedUp).toBe(true);
    const odd = usageSummary({ month, used_cents: 0.0001, requests: 50, limit_cents: 100, used_fraction: 0 });
    expect(odd.requestsLeft).toBeLessThanOrEqual(roughlyDown(100 / (TYPICAL_REQUEST_CENTS / 4)));
  });

  it('reads the allowance, and gives null (meter hidden) on any problem', async () => {
    const good = { month, used_cents: 1, requests: 3, limit_cents: 100, used_fraction: 0.01 };
    expect(await loadAllowance(async () => ({ data: good, error: null }))).toEqual(good);
    expect(await loadAllowance(async () => ({ data: null, error: { message: 'no' } }))).toBeNull();
    expect(await loadAllowance(async () => ({ data: { month }, error: null }))).toBeNull();
    expect(await loadAllowance(async () => { throw new Error('offline'); })).toBeNull();
  });
});
