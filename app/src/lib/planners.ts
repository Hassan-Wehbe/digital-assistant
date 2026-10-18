// The planners on Home's "Plan with Wilma" row (D38). My day works today; Date night and Family day
// come with D40, Vacation later. A planner with `soon` is a placeholder: its tap shows that line,
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
  { id: 'date', icon: '❤️', title: 'Date night', soon: 'Coming soon. For now, ask Wilma: “plan a date night Friday”.' },
  { id: 'family', icon: '👨‍👩‍👧', title: 'Family day', soon: 'Coming soon. For now, ask Wilma: “plan a family day Saturday”.' },
  { id: 'vacation', icon: '✈️', title: 'Vacation', soon: 'Coming later. Wilma will help plan trips in a future update.' },
];
