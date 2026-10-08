// A sample plan for the tests (one day, as in docs/day-planner-mockups.html).
// A plan as chat/day.ts sends it (the shape of supabase/functions/_shared/dayplan/plan.ts DayPlan).
export const PLAN = {
  date: '2026-10-09',
  time_zone: 'America/New_York',
  home: { set: true, label: 'Home' },
  drive_times: 'available',
  weather: 'available',
  weather_at: [{ place: 'Aquatic Center', for_keys: ['swim'], hourly: [{ at: '2026-10-09T15:00', rain_pct: 30 }, { at: '2026-10-09T16:00', rain_pct: 90 }] }],
  credits: ['Drive times © Mapbox', 'Weather: US National Weather Service'],
  rows: [
    { kind: 'drive', from: 'Home', to: 'Aquatic Center', for_keys: ['swim'], leave_at: '2026-10-09T16:10', arrive_by: '2026-10-09T16:30', minutes: 15, typical_minutes: 10, buffer_min: 5 },
    { kind: 'rain', place: 'Aquatic Center', for_keys: ['swim'], start: '2026-10-09T16:00', end: '2026-10-09T17:00', chance_pct: 90 },
    { kind: 'event', key: 'swim', title: 'Swim: Sara', start: '2026-10-09T16:30', end: '2026-10-09T18:30', place: 'Aquatic Center' },
    { kind: 'overlap', keys: ['swim', 'swim2'], start: '2026-10-09T17:00', end: '2026-10-09T18:30', minutes: 90, same_place: true, suggestion: 'take_both' },
    { kind: 'event', key: 'swim2', title: 'Swim: Adam', start: '2026-10-09T17:00', end: '2026-10-09T19:00', place: 'Aquatic Center' },
    { kind: 'free', start: '2026-10-09T19:20', end: '2026-10-09T22:00', minutes: 160 },
    { kind: 'drive', from: 'Aquatic Center', to: 'Home', for_keys: [], leave_at: '2026-10-09T19:00', arrive_by: '2026-10-09T19:20', minutes: 20 },
  ],
  all_day: [{ key: 'bday', title: 'Mum’s birthday' }],
  tasks_not_placed: [{ id: 't1', title: 'Pick up dry cleaning', priority: 'normal', duration_min: 20 }],
};
