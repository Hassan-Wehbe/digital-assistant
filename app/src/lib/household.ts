// The household (planners step 1, docs/planners-plan.md; design D40): who is in the family, for
// Family day. Each person is a label ("Me", "Sam", "Kid 1"), adult or child, and for a child an
// optional birth year (Q3: the age stays right without updating it). Nothing more. Kept in the
// `household_member` table, read and written as the user (RLS: own rows only); never a note, never
// searched or shared. The planner (step 2) sends the AI roles and ages only, never a label (Q4).
// Text that looks like a password is held on the phone (rule 9).
import { findCredential } from './credentials';

export const MAX_MEMBERS = 10;
export const MAX_LABEL = 40;

export type MemberKind = 'adult' | 'child';

export interface Member {
  id: string;
  label: string;
  kind: MemberKind;
  birth_year: number | null;
  position: number;
}

/** What the app may write (the database's column grants: never the owner). */
export interface MemberFields {
  label: string;
  kind: MemberKind;
  birth_year: number | null;
}

type Result = PromiseLike<{ data: unknown; error: unknown }>;

/** The database as this file needs it (the Supabase client fits). */
export interface HouseholdDb {
  from(table: 'household_member'): {
    select(columns: string): { order(column: 'position', o: { ascending: true }): Result };
    insert(row: MemberFields): { select(columns: string): { single(): Result } };
    update(changes: Partial<MemberFields> | { position: number }): { eq(column: 'id', value: string): { select(columns: string): { single(): Result } } };
    delete(): { eq(column: 'id', value: string): Result };
  };
}

const COLUMNS = 'id, label, kind, birth_year, position';
export const CREDENTIAL_TEXT = 'That looks like a password or a code, so it was not saved. Use a name or a label, like “Kid 1”.';
export const NOT_SAVED = 'That wasn’t saved. Check your connection and try again.';
export const CANT_READ = 'Your household cannot be read right now. Check your connection and try again.';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A row as read, checked; null when anything is off. */
export function toMember(raw: unknown): Member | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.label !== 'string' || !oneLine(r.label)) return null;
  if (r.kind !== 'adult' && r.kind !== 'child') return null;
  const year = r.kind === 'child' && typeof r.birth_year === 'number' && Number.isInteger(r.birth_year) ? r.birth_year : null;
  return { id: r.id, label: r.label, kind: r.kind, birth_year: year, position: typeof r.position === 'number' ? r.position : 0 };
}

/** The fields to write, checked and tidied, or a sentence saying why not. Nothing is sent before this. */
export function checkMember(m: { label: string; kind: MemberKind; birthYear?: string }, thisYear: number): { fields: MemberFields } | { error: string } {
  const label = oneLine(m.label ?? '');
  if (findCredential(label)) return { error: CREDENTIAL_TEXT };
  if (!label) return { error: 'Give them a name or a label, like “Sam” or “Kid 1”.' };
  if (label.length > MAX_LABEL) return { error: `A name can be at most ${MAX_LABEL} characters.` };
  let birth_year: number | null = null;
  const typed = (m.birthYear ?? '').trim();
  if (m.kind === 'child' && typed) {
    const n = Number(typed);
    if (!/^\d{4}$/.test(typed) || n < 1900 || n > thisYear) return { error: `A birth year like 2018, up to ${thisYear}.` };
    birth_year = n;
  }
  return { fields: { label, kind: m.kind, birth_year } };
}

/** The database's refusal in plain words. */
export function memberError(error: unknown, label?: string): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code === 'P0001' && message.startsWith('A household holds')) return message;
  if (e.code === '23505') return label ? `You already have someone called “${oneLine(label)}”. Pick another name.` : 'You already have someone with that name.';
  if (e.code === '22023' || e.code === '23514') return 'That name is too long, or the birth year is not right.';
  return NOT_SAVED;
}

/** In the order chosen. Throws a plain sentence when they cannot be read. */
export async function listMembers(db: HouseholdDb): Promise<Member[]> {
  let out: { data: unknown; error: unknown };
  try {
    out = await db.from('household_member').select(COLUMNS).order('position', { ascending: true });
  } catch {
    throw new Error(CANT_READ);
  }
  if (out.error || !Array.isArray(out.data)) throw new Error(CANT_READ);
  return out.data.map(toMember).filter((m): m is Member => m !== null);
}

export type MemberResult = { member: Member } | { error: string };

async function one(run: () => Result, label?: string): Promise<MemberResult> {
  try {
    const { data, error } = await run();
    if (error) return { error: memberError(error, label) };
    const member = toMember(data);
    return member ? { member } : { error: NOT_SAVED };
  } catch {
    return { error: NOT_SAVED };
  }
}

/** Someone new, placed last by the database. */
export async function addMember(db: HouseholdDb, m: { label: string; kind: MemberKind; birthYear?: string }, thisYear: number): Promise<MemberResult> {
  const checked = checkMember(m, thisYear);
  if ('error' in checked) return checked;
  return one(() => db.from('household_member').insert(checked.fields).select(COLUMNS).single(), checked.fields.label);
}

/** A new name, kind or birth year. */
export async function changeMember(db: HouseholdDb, id: string, m: { label: string; kind: MemberKind; birthYear?: string }, thisYear: number): Promise<MemberResult> {
  const checked = checkMember(m, thisYear);
  if ('error' in checked) return checked;
  return one(() => db.from('household_member').update(checked.fields).eq('id', id).select(COLUMNS).single(), checked.fields.label);
}

/** Gone for good (a setting, not a note). True when it worked. */
export async function removeMember(db: HouseholdDb, id: string): Promise<boolean> {
  try {
    const { error } = await db.from('household_member').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/** ↑ or ↓: the two swap places. The new order, or null when it could not be saved. */
export async function moveMember(db: HouseholdDb, list: Member[], id: string, by: -1 | 1): Promise<Member[] | null> {
  const i = list.findIndex((m) => m.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const order = [...list];
  [order[i], order[j]] = [order[j], order[i]];
  // Positions as shown (0, 1, 2 …): every row whose number changes is written, so none share one.
  const next = order.map((m, k) => ({ ...m, position: k }));
  for (const m of next) {
    if (list.find((o) => o.id === m.id)!.position === m.position) continue;
    const out = await one(() => db.from('household_member').update({ position: m.position }).eq('id', m.id).select(COLUMNS).single());
    if ('error' in out) return null;
  }
  return next;
}

/** A child's age this year (an estimate: the birthday may not have come yet). */
export function ageOf(m: Member, thisYear: number): number | null {
  return m.kind === 'child' && m.birth_year ? Math.max(0, thisYear - m.birth_year) : null;
}

/** "Kid 1 · child, about 6", "Sam · adult". */
export function memberLine(m: Member, thisYear: number): string {
  const age = ageOf(m, thisYear);
  return `${m.label} · ${m.kind === 'adult' ? 'adult' : age !== null ? `child, about ${age}` : 'child'}`;
}

/** The Who chips' words for a group: "2 adults", "2 kids (6, 9)". Names never appear (Q4). */
export function whoSummary(list: Member[], thisYear: number): string[] {
  const adults = list.filter((m) => m.kind === 'adult').length;
  const kids = list.filter((m) => m.kind === 'child');
  const ages = kids.map((k) => ageOf(k, thisYear)).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const out: string[] = [];
  if (adults) out.push(`${adults} adult${adults === 1 ? '' : 's'}`);
  if (kids.length) out.push(`${kids.length} kid${kids.length === 1 ? '' : 's'}${ages.length ? ` (${ages.join(', ')})` : ''}`);
  return out;
}
