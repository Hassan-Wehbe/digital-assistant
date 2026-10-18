// Home's Plan with Wilma row (D38): My day works; the planners still to come say so, on the phone.
import { describe, expect, it } from '@jest/globals';

import { PLANNERS } from './planners';

describe('Plan with Wilma', () => {
  it('My day first and working; Date night, Family day and Vacation marked soon', () => {
    expect(PLANNERS.map((p) => p.id)).toEqual(['day', 'date', 'family', 'vacation']);
    expect(PLANNERS[0].soon).toBeUndefined();
    for (const p of PLANNERS.slice(1)) expect(p.soon).toMatch(/^Coming (soon|later)\./);
  });
});
