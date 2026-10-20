// Home's Plan with Wilma row (D38): My day and Your morning, the planners still to come say so, on
// the phone; Cook with Wilma (recipes step 6) opens the suggestion screen.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { COOKS, pairs, PLANNERS } from './planners';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('Plan with Wilma', () => {
  it('My day, Your morning, Date night and Family day work; Vacation is marked soon', () => {
    expect(PLANNERS.map((p) => p.id)).toEqual(['day', 'morning', 'date', 'family', 'vacation']);
    for (const p of PLANNERS.slice(0, 4)) expect(p.soon).toBeUndefined();
    expect(PLANNERS[4].soon).toMatch(/^Coming later\./);
  });

  it('two by two, the last one alone', () => {
    expect(pairs(PLANNERS).map((r) => r.map((p) => p.id))).toEqual([['day', 'morning'], ['date', 'family'], ['vacation']]);
    expect(pairs([])).toEqual([]);
  });

  it('Your morning is a button, no longer a card on Home; it opens its own screen', () => {
    const home = read('app/index.tsx');
    expect(home).not.toContain('MorningCard');
    expect(home).toContain('useMorning({ auto: true, refresh: pulls })');
    expect(read('components/PlanRow.tsx')).toContain("'/morning'");
    expect(read('app/morning.tsx')).toContain('useMorning({ auto: false })');
  });
});

describe('Cook with Wilma', () => {
  it("What's for dinner? and Make a cocktail open the suggestion screen", () => {
    expect(COOKS.map((x) => x.mode)).toEqual(['meal', 'cocktail']);
    expect(read('components/PlanRow.tsx')).toContain("pathname: '/suggest', params: { mode: x.mode }");
    expect(read('app/index.tsx')).toContain('<CookRow');
  });
});
