# Day planner step 4: morning briefing and leave-by alerts

Status: plan, 2026-10-10. Owner's answers given the same day (Q1-Q3 below). Design: D25 step 4.
Model: the strongest for steps 1-2 (new app code around the day plan); a smaller one for step 3.

## What the owner will see

- **Settings → Morning briefing** (Pro): *Morning briefing* on/off and a time (default 7:00);
  *Leave-by alerts* on/off and how early (default 10 minutes before the leave-by time). Turning
  either on asks Android for permission to show notifications (Android 13+), once.
- **Each morning at the chosen time**, a notification. If the day was planned the evening before
  (My day → Tomorrow), it carries a short summary from that plan:
  "Planned last night: 3 things today. First: leave by 8:10 for Swim. Rain likely at 4 pm."
  Otherwise: "Good morning. Tap to see your day." Tapping opens My day for today, which plans the
  day again (fresh drive times, fresh weather) and refreshes the alerts.
- **Leave-by alerts**: for every drive in the plan, a notification at leave-by minus the lead time:
  "Leave by 8:10 for Swim · 18 min drive" (a pick-up: "Leave by 3:50 to pick up from Lexigazer").
  Tapping opens My day. A drive marked tight says so ("traffic is heavy, 25 min").

## Decisions (owner, 2026-10-10)

- **Q1, delivery: the phone schedules them.** Local notifications set by the app whenever My day
  builds a plan (today or tomorrow). No server push, no Firebase, no push tokens, no background
  task. So: the calendar is still read only when the user opens My day (the calendar permission
  text stays true), Mapbox is still asked only in response to the person (step 2 plan, "Only in
  response to a person"), and nothing new is stored on the server.
  **Limit, said plainly in Settings:** leave-by alerts exist only for days planned in My day; if
  the user never opens My day that day, only the morning notification comes.
- **Q2, morning text: a short summary** when a plan for that day exists on the phone, else the
  plain greeting. The summary is from the evening before ("Planned last night"), never presented
  as live.
- **Q3, lock screen: title and time.** Event titles as the calendar has them; private events are
  already "Busy" in the plan. Vault items and restricted spaces never appear: they are never in
  the day plan (rules 1 and 3).

## How it works (app only)

- **Package:** `expo-notifications` (Expo SDK 57's version, local notifications only; its config
  plugin with no Firebase file). Android channel "Day plan", default importance.
- **`lib/dayAlerts.ts` (pure, tested):** `alertsFor(plan, settings, now)` turns a `DayPlan` into a
  list of `{ id, at, title, body, date }`: one per `drive` row with `leave_at` (not `unavailable`),
  at `leave_at - lead`, skipped when already past; the morning summary from `rows` (count of
  events and tasks, the first drive, the first `rain` row, the first `alert`). Ids are
  `wilma.<date>.<kind>.<n>` so a new plan for a date replaces exactly that date's alerts.
- **`lib/notifications.ts`:** asks the permission; `scheduleDay(date, alerts)` cancels the
  date's earlier Wilma notifications, then schedules the new ones; `topUpMornings()` keeps the next
  7 mornings scheduled as one-off notifications (plain greeting unless a summary replaced it), run
  on each app start and Settings change (one-offs, not a repeating one, so a day's summary can
  replace that day's greeting). If the app is not opened for a week, the mornings stop; they come
  back on the next start.
- **My day (`app/src/app/day.tsx`)**: after each successful plan, `scheduleDay(...)` when the
  settings are on. A changed choice (Take both, Not driving) re-plans and so re-schedules.
- **Tap:** opens `/day?date=<date>` (the screen already takes `date`).
- **Sign-out and Delete account cancel every Wilma notification** (another account on the phone
  must never see them). Turning a setting off cancels its notifications.
- **Settings** are per account on the phone (`deviceSettingsStore`, key
  `wilma.briefing.v1.<userId>`), like the calendar choice. Nothing on the server.
- **Pro:** only Pro accounts get plans, so only they get alerts; the Settings section shows the
  Pro card for Free accounts, like My day.
- **Timing:** Android may hold a notification back a few minutes while the phone sleeps (no exact
  alarm permission: Play allows that only for alarm and calendar apps). The 10-minute lead covers
  it; the text always gives the leave-by time itself.
- **What lives on the phone:** the scheduled notifications' text (event titles, times) sits in
  Android's notification schedule until shown or cancelled, for today and tomorrow only. The
  privacy page says so.

## Steps (one PR each)

1. **Settings and the scheduler** (strongest model): `expo-notifications`, `lib/dayAlerts.ts`
   with tests (drives, pick-ups, tight, unavailable, past times, summary text, ids), `lib/notifications.ts`,
   Settings → Morning briefing, cancel on sign-out and delete. Mornings scheduled with the plain
   greeting only.
2. **My day schedules** (strongest model): My day schedules leave-by alerts and the morning
   summary; tap opens My day for that date. Tests for re-scheduling and for settings off.
3. **Privacy and checklist** (smaller model): privacy page sentence (notifications are made on the
   phone from your plan; titles and times stay on the phone until shown); Play Data safety needs no
   change (nothing leaves the phone); `docs/versioncode18-phone-checklist.md`; then "build for
   Play" (versionCode 18). The owner's OK on the privacy wording first.

No server change, no prompt change, no evaluation run.

## Open questions (small, defaults chosen)

- Q4: the morning time default 7:00 and the lead 10 minutes; the owner may change both in Settings.
- Q5: a "Tomorrow is planned" reminder in the evening (e.g. 8 pm, "Plan tomorrow?") so the
  morning summary has something to say. Default: not now; add later if the owner wants it.
- Q6: the chat's "plan my day" answer (`chat/agenda.ts`) does not schedule alerts in step 2;
  only My day does. Later, the chat's `day_plan` action could open My day to schedule them.
