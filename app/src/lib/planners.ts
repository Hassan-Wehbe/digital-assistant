// The planners on Home's "Plan with Wilma" row (D38). My day, Your morning (the morning briefing,
// a button here since recipes step 6, owner 2026-10-20; app/morning.tsx), and Date night and Family
// day (D40, app/outing.tsx); Vacation later. A planner with `soon` is a placeholder: its tap shows
// that line, answered on the phone with no AI request.
export interface Planner {
  id: 'day' | 'morning' | 'date' | 'family' | 'vacation';
  icon: string;
  title: string;
  /** Set while the planner is not built yet. */
  soon?: string;
}

export const PLANNERS: readonly Planner[] = [
  { id: 'day', icon: '📅', title: 'My day' },
  { id: 'morning', icon: '🌅', title: 'Your morning' },
  { id: 'date', icon: '❤️', title: 'Date night' },
  { id: 'family', icon: '👨‍👩‍👧', title: 'Family day' },
  { id: 'vacation', icon: '✈️', title: 'Vacation', soon: 'Coming later. Wilma will help plan trips in a future update.' },
];

// Home's "Cook with Wilma" row (recipes step 6, D43 Q9): What's for dinner? and Make a cocktail
// (app/suggest.tsx), for everyone (10 suggestions a day, more with Pro).
export interface Cook {
  mode: 'meal' | 'cocktail';
  icon: string;
  title: string;
}

export const COOKS: readonly Cook[] = [
  { mode: 'meal', icon: '🍽️', title: "What's for dinner?" },
  { mode: 'cocktail', icon: '🍸', title: 'Make a cocktail' },
];

/** A row's buttons two by two (a last one alone keeps half the width). */
export function pairs<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));
  return out;
}
