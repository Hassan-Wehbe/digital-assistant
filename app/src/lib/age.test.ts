// Ages in the app (docs/age-plan.md step 3, D44): the status read back (only "21 or over" or the
// month cocktails open), the month and year checked and sent once (never kept on the phone, never
// in a message), the drinks words under 21 (Q6: also until answered), Settings → Account's line,
// and the Mocktails space's icon.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { AGE_CHECK, birthProblem, cocktailsLine, drinks, giveBirthMonth, loadAgeStatus, mocktailsOnly, toAgeStatus } from './age';
import { spaceTitle } from './memory';

const TODAY = new Date(2026, 9, 21); // October 21, 2026

describe('the status', () => {
  it('keeps only asked, 21 or over, and the month cocktails open while under 21', () => {
    expect(toAgeStatus({ asked: true, is_21: true })).toEqual({ asked: true, is21: true });
    expect(toAgeStatus({ asked: true, is_21: false, alcohol_from: '2028-03-01' })).toEqual({ asked: true, is21: false, alcoholFrom: '2028-03-01' });
    expect(toAgeStatus({ asked: false, is_21: false, alcohol_from: null })).toEqual({ asked: false, is21: false });
    expect(toAgeStatus({ asked: true, is_21: true, alcohol_from: '2028-03-01' })).toEqual({ asked: true, is21: true });
    expect(toAgeStatus(null)).toBeNull();
    expect(toAgeStatus({ asked: 'yes', is_21: true })).toBeNull();
  });

  it('is null when it cannot be read (the server still decides)', async () => {
    expect(await loadAgeStatus(async () => ({ data: null, error: { message: 'x' } }))).toBeNull();
    expect(await loadAgeStatus(async () => {
      throw new Error('offline');
    })).toBeNull();
    expect(await loadAgeStatus(async (fn) => ({ data: fn === 'my_age_status' ? { asked: true, is_21: true } : null, error: null }))).toEqual({ asked: true, is21: true });
  });
});

describe('the month and year', () => {
  it('needs a month and a four-digit year, not in the future, not over 120 years ago', () => {
    expect(birthProblem(null, '1990', TODAY)).toBe('Enter your month and year of birth.');
    expect(birthProblem(4, '', TODAY)).toBe('Enter your month and year of birth.');
    expect(birthProblem(4, '19900', TODAY)).toBe('Enter your month and year of birth.');
    expect(birthProblem(11, '2026', TODAY)).toBe('Please enter a real month and year of birth.');
    expect(birthProblem(4, '1900', TODAY)).toBe('Please enter a real month and year of birth.');
    expect(birthProblem(10, '2026', TODAY)).toBeNull();
    expect(birthProblem(4, ' 1990 ', TODAY)).toBeNull();
  });

  it('is sent once as two numbers; the server’s plain messages are shown, never the date', async () => {
    const calls: unknown[] = [];
    const ok = await giveBirthMonth(async (fn, args) => {
      calls.push([fn, args]);
      return { data: { asked: true, is_21: false, alcohol_from: '2028-03-01' }, error: null };
    }, 2, '2007', TODAY);
    expect(calls).toEqual([['set_birth_month', { p_month: 2, p_year: 2007 }]]);
    expect(ok).toEqual({ status: { asked: true, is21: false, alcoholFrom: '2028-03-01' } });

    const again = await giveBirthMonth(async () => ({ data: null, error: { code: 'P0001', message: 'Your age is already set. If it is wrong, contact us.' } }), 2, '2007', TODAY);
    expect(again).toEqual({ error: 'Your age is already set. If it is wrong, contact us.' });
    const other = await giveBirthMonth(async () => ({ data: null, error: { code: '500', message: 'internal: 2007-02' } }), 2, '2007', TODAY);
    expect(other).toEqual({ error: 'Could not save it just now. Check your connection and try again.' });
    expect(JSON.stringify(other)).not.toContain('2007');
    const none: unknown[] = [];
    expect(await giveBirthMonth(async (fn) => {
      none.push(fn);
      return { data: null, error: null };
    }, null, '2007', TODAY)).toEqual({ error: 'Enter your month and year of birth.' });
    expect(none).toEqual([]);
  });

  it('is never kept on the phone or logged', () => {
    for (const f of ['./age.ts', '../components/AgeCard.tsx', '../components/BirthMonthFields.tsx', '../components/useAge.ts', './signup.ts']) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      expect([f, /AsyncStorage|SecureStore|deviceStorage|deviceSettingsStore|console\./.test(src)]).toEqual([f, false]);
    }
  });
});

describe('drinks under 21', () => {
  it('switched off (owner, 2026-10-22): cocktails for everyone, whatever the status', () => {
    expect(AGE_CHECK).toBe(false);
    expect(mocktailsOnly(null)).toBe(false);
    expect(mocktailsOnly({ asked: false, is21: false })).toBe(false);
    expect(drinks({ asked: true, is21: false })).toEqual({ icon: '🍸', button: 'Make a cocktail', space: 'Cocktails', one: 'cocktail' });
  });

  it('on: mocktails until answered, under 21, or when unknown; cocktails at 21', () => {
    expect(mocktailsOnly(null, true)).toBe(true);
    expect(mocktailsOnly({ asked: false, is21: false }, true)).toBe(true);
    expect(drinks({ asked: true, is21: false }, true)).toEqual({ icon: '🍹', button: 'Make a mocktail', space: 'Mocktails', one: 'mocktail' });
    expect(drinks({ asked: true, is21: true }, true)).toEqual({ icon: '🍸', button: 'Make a cocktail', space: 'Cocktails', one: 'cocktail' });
  });

  it('Settings → Account says it without a birth date', () => {
    expect(cocktailsLine({ asked: true, is21: true })).toBe('Cocktails: yes (21 or over).');
    expect(cocktailsLine({ asked: true, is21: false, alcoholFrom: '2028-03-01' })).toBe('Cocktails from March 2028; mocktails until then.');
    expect(cocktailsLine({ asked: false, is21: false })).toBe('Cocktails: mocktails only until you give your month and year of birth.');
    expect(cocktailsLine(null)).toBe('Cocktails: could not be checked just now.');
  });

  it('the drinks space named Mocktails by the server shows 🍹', () => {
    expect(spaceTitle({ path: 'Mocktails', built_in: 'cocktails' })).toBe('🍹 Mocktails');
    expect(spaceTitle({ path: 'Cocktails', built_in: 'cocktails' })).toBe('🍸 Cocktails');
    expect(spaceTitle({ path: 'Mocktails' })).toBe('Mocktails');
  });
});
