// Settings → Household (planners step 1, D40): rows read back field by field, every field checked
// before anything is sent (a password-like label held on the phone, rule 9), the database's
// refusals in plain words, reordering that never leaves two people on one position, and the Who
// words that never carry a name (Q4).
import { describe, expect, it } from '@jest/globals';

import {
  addMember, ageOf, changeMember, checkMember, CREDENTIAL_TEXT, listMembers, memberError, memberLine, moveMember, NOT_SAVED, removeMember, toMember,
  whoSummary, type HouseholdDb, type Member,
} from './household';

const YEAR = 2026;
const ME: Member = { id: 'm1', label: 'Me', kind: 'adult', birth_year: null, position: 0 };
const SAM: Member = { id: 'm2', label: 'Sam', kind: 'adult', birth_year: null, position: 1 };
const KID1: Member = { id: 'm3', label: 'Kid 1', kind: 'child', birth_year: 2020, position: 3 };
const KID2: Member = { id: 'm4', label: 'Kid 2', kind: 'child', birth_year: 2017, position: 7 };

/** A pretend table: records what was sent, answers as told. */
function fakeDb(answer: { data?: unknown; error?: unknown } = {}) {
  const sent: unknown[] = [];
  const res = (extra: unknown) => {
    sent.push(extra);
    return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
  };
  const db: HouseholdDb = {
    from: (table) => {
      sent.push(table);
      return {
        select: (cols) => ({ order: (col, o) => res({ select: cols, order: col, o }) }),
        insert: (row) => ({ select: () => ({ single: () => res({ insert: row }) }) }),
        update: (changes) => ({ eq: (_c, id) => ({ select: () => ({ single: () => res({ update: changes, id }) }) }) }),
        delete: () => ({ eq: (_c, id) => res({ delete: id }) }),
      };
    },
  };
  return { db, sent };
}

describe('a household row', () => {
  it('is read field by field; a birth year only for a child', () => {
    expect(toMember({ ...KID1, extra: 'x' })).toEqual(KID1);
    expect(toMember({ ...ME, birth_year: 1980 })).toEqual(ME);
    for (const bad of [null, { ...ME, id: '' }, { ...ME, label: '  ' }, { ...ME, kind: 'dog' }]) expect(toMember(bad)).toBeNull();
  });
});

describe('checking before saving', () => {
  it('tidies the label and keeps a child’s birth year', () => {
    expect(checkMember({ label: '  Kid   1 ', kind: 'child', birthYear: '2020' }, YEAR)).toEqual({ fields: { label: 'Kid 1', kind: 'child', birth_year: 2020 } });
    expect(checkMember({ label: 'Sam', kind: 'adult', birthYear: '1980' }, YEAR)).toEqual({ fields: { label: 'Sam', kind: 'adult', birth_year: null } });
    expect(checkMember({ label: 'Kid 2', kind: 'child', birthYear: '' }, YEAR)).toEqual({ fields: { label: 'Kid 2', kind: 'child', birth_year: null } });
  });

  it('says what is wrong', () => {
    expect(checkMember({ label: ' ', kind: 'adult' }, YEAR)).toHaveProperty('error');
    expect(checkMember({ label: 'x'.repeat(41), kind: 'adult' }, YEAR)).toHaveProperty('error');
    for (const y of ['2027', '1899', '20', 'abcd']) expect(checkMember({ label: 'Kid', kind: 'child', birthYear: y }, YEAR)).toHaveProperty('error');
  });

  it('holds a password-like label on the phone (rule 9)', async () => {
    expect(checkMember({ label: 'password is hunter2', kind: 'adult' }, YEAR)).toEqual({ error: CREDENTIAL_TEXT });
    const { db, sent } = fakeDb();
    expect(await addMember(db, { label: 'PIN 2580', kind: 'adult' }, YEAR)).toEqual({ error: CREDENTIAL_TEXT });
    expect(sent).toEqual([]);
  });
});

describe('the database', () => {
  it('lists in the chosen order; a failure is a plain sentence', async () => {
    const { db, sent } = fakeDb({ data: [ME, { id: 'odd' }, KID1] });
    expect(await listMembers(db)).toEqual([ME, KID1]);
    expect(sent).toEqual(['household_member', { select: 'id, label, kind, birth_year, position', order: 'position', o: { ascending: true } }]);
    await expect(listMembers(fakeDb({ error: { code: '42501' } }).db)).rejects.toThrow('cannot be read');
  });

  it('adds and changes only the label, kind and birth year', async () => {
    const add = fakeDb({ data: KID1 });
    expect(await addMember(add.db, { label: 'Kid 1', kind: 'child', birthYear: '2020' }, YEAR)).toEqual({ member: KID1 });
    expect(add.sent[1]).toEqual({ insert: { label: 'Kid 1', kind: 'child', birth_year: 2020 } });
    const change = fakeDb({ data: { ...KID1, birth_year: 2019 } });
    await changeMember(change.db, 'm3', { label: 'Kid 1', kind: 'child', birthYear: '2019' }, YEAR);
    expect(change.sent[1]).toEqual({ update: { label: 'Kid 1', kind: 'child', birth_year: 2019 }, id: 'm3' });
  });

  it('turns refusals into plain words', () => {
    expect(memberError({ code: 'P0001', message: 'A household holds at most 10 people. Remove one first.' })).toBe('A household holds at most 10 people. Remove one first.');
    expect(memberError({ code: '23505' }, ' Sam ')).toBe('You already have someone called “Sam”. Pick another name.');
    expect(memberError({ code: '23514' })).toBe('That name is too long, or the birth year is not right.');
    expect(memberError({ code: 'XX000', message: 'internal detail' })).toBe(NOT_SAVED);
  });

  it('removes for good', async () => {
    const { db, sent } = fakeDb();
    expect(await removeMember(db, 'm2')).toBe(true);
    expect(sent[1]).toEqual({ delete: 'm2' });
    expect(await removeMember(fakeDb({ error: { code: '42501' } }).db, 'm2')).toBe(false);
  });

  it('reorders so no two share a position, writing only the rows that change', async () => {
    const { db, sent } = fakeDb({ data: ME });
    const next = await moveMember(db, [ME, SAM, KID1, KID2], 'm4', -1);
    expect(next!.map((m) => [m.id, m.position])).toEqual([['m1', 0], ['m2', 1], ['m4', 2], ['m3', 3]]);
    // Me and Sam already had 0 and 1; Kid 1 had 3 and keeps it; Kid 2 moves from 7 to 2.
    expect(sent.filter((s) => typeof s === 'object')).toEqual([{ update: { position: 2 }, id: 'm4' }]);
    expect(await moveMember(db, [ME, SAM], 'm1', -1)).toEqual([ME, SAM]);
  });
});

describe('the words', () => {
  it('says a child’s age from the birth year', () => {
    expect(ageOf(KID1, YEAR)).toBe(6);
    expect(ageOf(ME, YEAR)).toBeNull();
    expect(memberLine(KID1, YEAR)).toBe('Kid 1 · child, about 6');
    expect(memberLine({ ...KID1, birth_year: null }, YEAR)).toBe('Kid 1 · child');
    expect(memberLine(SAM, YEAR)).toBe('Sam · adult');
  });

  it('sums up who is coming without a name (Q4)', () => {
    expect(whoSummary([ME, SAM, KID1, KID2], YEAR)).toEqual(['2 adults', '2 kids (6, 9)']);
    expect(whoSummary([ME, { ...KID1, birth_year: null }], YEAR)).toEqual(['1 adult', '1 kid']);
    expect(whoSummary([], YEAR)).toEqual([]);
    expect(whoSummary([ME, SAM, KID1, KID2], YEAR).join(' ')).not.toMatch(/Me|Sam|Kid/);
  });
});
