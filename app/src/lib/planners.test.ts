// Home's Plan with Wilma row (D38): My day works; the planners still to come say so, on the phone.
import { describe, expect, it } from '@jest/globals';

import { PLANNERS } from './planners';

describe('Plan with Wilma', () => {
  it('My day, Date night and Family day work; Vacation is marked soon', () => {
    expect(PLANNERS.map((p) => p.id)).toEqual(['day', 'date', 'family', 'vacation']);
    for (const p of PLANNERS.slice(0, 3)) expect(p.soon).toBeUndefined();
    expect(PLANNERS[3].soon).toMatch(/^Coming later\./);
  });
});
