// The planners on Home's "Plan with Wilma" row (D38). My day, and Date night and Family day (D40,
// app/outing.tsx); Vacation later. A planner with `soon` is a placeholder: its tap shows that line,
// answered on the phone with no AI request.
export interface Planner {
  id: 'day' | 'date' | 'family' | 'vacation';
  icon: string;
  title: string;
  /** Set while the planner is not built yet. */
  soon?: string;
}

export const PLANNERS: readonly Planner[] = [
  { id: 'day', icon: '📅', title: 'My day' },
  { id: 'date', icon: '❤️', title: 'Date night' },
  { id: 'family', icon: '👨‍👩‍👧', title: 'Family day' },
  { id: 'vacation', icon: '✈️', title: 'Vacation', soon: 'Coming later. Wilma will help plan trips in a future update.' },
];
