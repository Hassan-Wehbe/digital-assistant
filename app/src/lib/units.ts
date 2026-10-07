// Distances in miles or kilometres (docs/places-plan.md step 8, Q14; part 2 PR 3). One account
// setting, app_user.distance_unit, read by the server, so Wilma's replies, the place cards and
// "nearby" (10 miles, about 16 km) all agree. Miles by default; changed on Settings only (not by
// chat). Read and written as the signed-in user: RLS lets each user see and change only their own
// row, and only this column of it.

export type DistanceUnit = 'mi' | 'km';
export const DEFAULT_UNIT: DistanceUnit = 'mi';

export const UNIT_CHOICES: { unit: DistanceUnit; title: string }[] = [
  { unit: 'mi', title: 'Miles' },
  { unit: 'km', title: 'Kilometres' },
];

export const isDistanceUnit = (v: unknown): v is DistanceUnit => v === 'mi' || v === 'km';

/** The part of the Supabase client used here (so the tests need no network). */
export interface UnitsDb {
  from(table: 'app_user'): {
    select(columns: 'distance_unit'): {
      eq(column: 'id', value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
    };
    update(values: { distance_unit: DistanceUnit }): {
      eq(column: 'id', value: string): {
        select(columns: 'distance_unit'): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
  };
}

const unitOf = (data: unknown): DistanceUnit | null => {
  const v = data && typeof data === 'object' ? (data as { distance_unit?: unknown }).distance_unit : undefined;
  return isDistanceUnit(v) ? v : null;
};

/** The user's unit; null when it cannot be read (offline), so the screen can say so. */
export async function loadDistanceUnit(db: UnitsDb, userId: string): Promise<DistanceUnit | null> {
  try {
    const { data, error } = await db.from('app_user').select('distance_unit').eq('id', userId).maybeSingle();
    if (error) return null;
    return unitOf(data) ?? DEFAULT_UNIT;
  } catch {
    return null;
  }
}

/** Saves the unit; true only when the database confirms the new value. */
export async function saveDistanceUnit(db: UnitsDb, userId: string, unit: DistanceUnit): Promise<boolean> {
  if (!isDistanceUnit(unit)) return false;
  try {
    const { data, error } = await db
      .from('app_user')
      .update({ distance_unit: unit })
      .eq('id', userId)
      .select('distance_unit')
      .maybeSingle();
    return !error && unitOf(data) === unit;
  } catch {
    return false;
  }
}

/**
 * "about 0.5 miles", "about 1 mile", "about 12 km": a distance the server measured, as the place
 * cards show it (straight line, never a travel time).
 */
export function distanceText(value: number, unit: DistanceUnit): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const n = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  if (n === 0) return unit === 'mi' ? 'less than 0.1 miles' : 'less than 0.1 km';
  if (unit === 'km') return `about ${n} km`;
  return `about ${n} ${n === 1 ? 'mile' : 'miles'}`;
}
