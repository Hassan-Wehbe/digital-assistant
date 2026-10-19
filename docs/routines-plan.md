# Routines: weekly and monthly task groups

Status: plan, 2026-10-18. **Owner's answers given the same day (Q1-Q9, below "Decided").** **Step 1 built
(2026-10-18), PR #226; migration applied 2026-10-19; deployed 2026-10-19 (`mcp` and `chat`):** see
"As built: step 1". **Step 2 built (2026-10-19), branch `claude/routines-planner`, not merged, not
deployed:** see "As built: step 2". Design: D39 (and D25, the
day planner; D35, tasks left open at the end of their day). Mockups: the owner's private canvas
"Wilma Home and Planners", screens 5-7. Model: the strongest for steps 1, 2 and 4 (the task model,
the planner, the chat); a smaller one is fine for step 5.

## Why

The owner (2026-10-18): "a way to create weekly tasks or group of tasks or monthly tasks or group
of tasks; Wilma should start keeping track of those weekly/monthly tasks and propose them on the
daily planner." And: "monthly routines is any day, ideally Wilma proposes that throughout the daily
planner to knock them out if Wilma sees there is a free space."

## Decided (owner, 2026-10-18)

- **Q1. Weekly routines come in two kinds:** "any day that week" (offered from the start of the
  week until done), or "the same day every week" (offered on that day only, e.g. every Saturday).
- **Q2. Monthly:** "Any day" by default, with an optional "by the Nth" (as recommended).
- **Q3. Suggestions show** in My day's box, the chat's plan, and one line in Your morning (a count
  only) (as recommended).
- **Q4. Up to 3 at a time, and the rest carry over:** when there are more than 3, the others wait
  their turn; once one is added or dismissed, the next one takes its place, and anything not done
  today is offered again on the following days while its week or month runs.
- **Q5. ✕ Not today is kept on the server** (so it holds on every device), not on the phone.
- **Q6. A missed one does not carry over:** not done by the end of its week, month or day, it is
  simply passed by and the next one like it comes up (no overdue pile, no duplicate); the Routines
  screen notes it ("Missed in October: Wash car").
- **Q7. A task with no duration is fitted as 30 min**, shown as "about 30 min".
- **Q8. Deleting a routine deletes all its tasks** (they go to the Recycle bin with it, after a
  confirm, and can be restored together; rule 8).
- **Q9. Schedules:** weekly (any day, or the same day), every 2 weeks, and monthly.

## What exists today

- **Repeating tasks** (a task's `repeat`: daily, weekdays, weekly, biweekly, monthly;
  `supabase/functions/mcp/lib/tasks.ts`). `due_on` is the next time. Ticking it done moves `due_on`
  on (`setTaskDone`, `nextDue`) and keeps `last_done_on`.
- **My day** (`chat/day.ts makePlan` → `_shared/dayplan/plan.ts planDay`): code only, no AI
  request. A task joins a day when it is due by then (overdue too), has no date, or is planned on
  it. A task with `planned_at` is placed at that time; every other one is listed under "Not placed
  yet" with **Find a time** (`taskOptions`: up to 4 free-time or on-the-way options). The planner
  never places a task by itself.
- **What is missing:** (a) a repeating task is hidden before its date and then shows as
  **overdue every day** until ticked, so "any day this month" cannot be said; (b) there is no
  group; (c) My day only offers times when asked (Find a time), it never proposes.

## What the owner will see

**Tasks → Routines** (a third tab, beside To do and Done; mockup 5): each routine with its
schedule, its tasks, and how many are done this time ("2 of 4", "Done for October"). Single
repeating tasks stay where they are and are also listed at the bottom ("Repeating on their own").

**New routine / edit** (mockup 6): a name; **Repeats**: Weekly · Every 2 weeks · Monthly; **When**:
for weekly and every 2 weeks, "Any day that week" or "Same day each time" with a day
(S M T W T F S) (Q1); for monthly, "Any day" (default) or "By the …" (a day of the month) (Q2); the tasks, each with an optional duration ("+ Add a task"); and
**Suggest in My day** (on by default). Delete routine (its tasks go to the Recycle bin with it,
after a confirm).

**My day → From your routines** (mockup 7), above the plan, only when something fits:
"Vacuum · Weekend house reset · 30 min — **Add 9:45** · ✕". Up to 3 at a time, each fitted into
a free gap by code; when there are more, the next one takes the place of one added or dismissed,
and the rest are offered again on later days of the period (Q4). **Add** places it at that time
(the same write as picking a Find a time option today). **✕** means not today, saved on the server
for that day (Q5). "Add all" when there are several. A routine task left unplaced still appears under "Not placed yet" with Find a time, as
today, but **never as overdue** while its week or month is still running.

**The chat:** "make my Saturday chores a weekly routine: laundry, vacuum, groceries", "add wash the
car to my monthly checks", "what's left in my routines this month?", and "plan my day" mentions the
suggestions ("You have 2 hours free after lunch; vacuuming and groceries would fit.").

## How it works

1. **A routine is an item** (`item_type = 'routine'`) in the built-in Tasks space: its name (the
   title), and metadata `{ repeat: 'weekly' | 'biweekly' | 'monthly', on_day?, any_day, suggest }`
   (`on_day`: 0-6 for a weekday, 1-31 for "by the Nth"; `any_day`: offered any day of the period).
   No migration: items already take any type and validated metadata (D5), as places did.
2. **Its tasks are ordinary tasks** with `routine_id` (the routine's item id) in their metadata. So
   everything tasks already do keeps working: ticking done, the Tasks screen, `find_tasks`, the
   password check (rule 9), revisions on edit (rule 7), soft delete (rule 8), the restricted-space
   rules (the Tasks space is never restricted).
3. **One place keeps them in step** (`mcp/lib/routines.ts`): saving or changing a routine writes
   its schedule into its tasks' `repeat`, `due_on` and a new `window_from` (the first day of the
   current week or month the task may be done). Tasks never disagree with their routine, and the
   planner and Tasks screen read tasks only, as today.
4. **The planner learns "a window"**: a task with `window_from` is a candidate from `window_from`
   to `due_on` (the end of its week or month, or "by the Nth"; for "the same day each time" both
   are that day), and is **not overdue** in that time. Done moves both dates to the next period
   (`nextDue`, as now). **Missed (Q6):** once `due_on` has passed and it is still open, the server
   moves it to its next period when it is next read (like D35's day-end, writing a revision) and
   keeps `missed_on` (the period's last day), so it never piles up as overdue.
5. **Suggestions are computed by code** in `planDay`: routine tasks in their window, not placed,
   not done, with Suggest on, not ✕'d for that day; nearest deadline first, then the routine's
   order; each fitted into the earliest free gap that holds its duration (30 min when none is
   given, Q7), at a quarter hour, without overlapping each other; the first 3 shown, the rest
   counted ("and 2 more") and offered next (Q4). Returned as `plan.suggestions`; no AI request
   (My day stays free of AI cost; the Pro fair-use count is unchanged, one per plan).
5a. **✕ Not today is a small table** (Q5), `task_not_today` (user, task, day), not task metadata,
   so a dismissal writes no revision (rule 7 stays about real edits). RLS own rows, anon nothing,
   rows for past days dropped when next written; only a task id and a date, never task text.
6. **The chat** gets the suggestions as numbers in `planForModel` (the model words them, never
   computes them, D25) and, in step 4, a way to make and change routines.

## Rules check

- **Secrets (rules 1, 2, 9):** routine names and task titles pass the same credential check as
  every task and note; "Change the Wi-Fi password" is fine, "Wi-Fi password is hunter2" is refused
  and points to the Vault. Evaluation traps in step 4.
- **Restricted spaces (rule 3):** routines live in the Tasks space, which can never be restricted;
  the planner reads only searchable spaces, as today.
- **Every row owned (rule 5):** items and their RLS, as today. `routine_id` is checked to be the
  user's own routine on every save.
- **History (rule 7) and soft delete (rule 8):** keeping tasks in step writes revisions like any
  edit; deleting a routine bins its tasks too, restorable.
- **Privacy:** nothing new is stored beyond what tasks store today, plus the ✕ "not today" rows (a
  task id and a date). The privacy page needs no change (checked again in step 5).
- **Cost:** no AI for My day suggestions; chat requests as today. No Mapbox calls for suggestions
  (a routine task's place, if any, is used only when the user picks Find a time, as today).
- **Sharing:** not in this plan. Sharing a routine with family comes with sharing (D32) or task
  assignment (D25), later.

## Questions as asked (recommendation first; answers under "Decided")

- **Q1. A weekly routine with a day (Saturday):** offered **from that day until done, through the
  end of that week** (rec.; D39 says "on their day or later that week"); or only on that day.
- **Q2. Monthly:** **"Any day" by default, with an optional "by the Nth"** (rec.); or always a
  fixed day.
- **Q3. Where suggestions show:** **My day's box, the chat's plan, and one line in Your morning**
  ("2 routine tasks fit today", a count only) (rec.); or My day only.
- **Q4. How many a day:** **up to 3** (rec.), or up to 5. Only in free time the planner already sees
  (7:00 to 22:00, around events and drives).
- **Q5. ✕ Not today:** **kept on the phone for that day only, no server write** (rec.; no revision
  noise); or saved on the server so it holds on every device.
- **Q6. Not done by the end of the week or month:** **rolls on to the next period, with a line on
  the Routines screen ("Missed in October: Wash car")** (rec.); or stays overdue until done.
- **Q7. A task with no duration:** **fitted as 30 min and shown as "about 30 min"** (rec.); or
  15 min, as placed tasks are today.
- **Q8. Deleting a routine:** **its tasks go to the Recycle bin with it, after a confirm** (rec.);
  or they stay as single repeating tasks.
- **Q9. Schedules:** **weekly, every 2 weeks and monthly** (rec., as in the mockup); daily and
  weekdays stay single repeating tasks.

## Steps

1. **Server: routines and windows (strongest model).** `routine` items (`normalizeRoutine`),
   `routine_id`, `window_from` and `missed_on` on tasks (`normalizeTask`), `mcp/lib/routines.ts`
   keeping tasks in step, done moving the window on, a missed one moved on when read (Q6), delete
   binning the routine and all its tasks (Q8); `find_tasks` shows routine and window. Migration
   `task_not_today` (Q5) with its SQL test and a dry run. Deno tests, including two users and a
   routine id that is not yours. **Owner:** dry run, OK to apply, then OK to deploy `mcp`. Tool
   descriptions unchanged; one evaluation run to show nothing regressed (owner's OK and a dollar
   cap).
2. **Planner: windows and suggestions (strongest model).** Candidates with a window (never overdue
   inside it), `plan.suggestions` (Q4, Q7), the ✕ list sent by the app, Q6 at the period's end;
   `planForModel` gets the suggestions; Deno tests; new evaluation cases for "plan my day" wording.
   **Deploy `chat`** (owner's OK).
3. **App (strongest model for My day, smaller for the Routines screens).** Tasks → Routines, the
   routine screen, My day's From your routines box (Add / ✕ / Add all), Your morning's line (Q3);
   app tests. Ships with the next build.
4. **Chat: make and change routines (strongest model).** Saving a routine and its tasks from the
   chat with a card the user confirms (nothing saved without a tap, as homes), "add X to my …
   routine", "what's left this month"; evaluation cases with password traps (rule 9).
5. **Help, checklist, build (smaller model).** A Help topic line, the build's phone checklist,
   privacy page re-check (expected: no change), then the build.

## As built: step 1 (2026-10-18)

Server only; nothing in the app or the chat's wording yet, so testers see no change.

- **`mcp/lib/routines.ts`** (no database): `normalizeRoutine` (repeat `weekly` | `biweekly` |
  `monthly`; when `any_day` | `same_day` (weekly kinds, `day` 0 Sunday … 6 Saturday) | `by_day`
  (monthly, `day` 1-31); `starts_on`, the first day, which also fixes an every-two-weeks routine's
  weeks; `suggest`, on by default), `routineWords` ("Every Saturday", "By the 28th each month"),
  `periodOn` / `periodAfter` (weeks Sunday to Saturday; "by the 31st" is the month's last day when
  shorter), `withRoutine` (a task gets the routine's repeat and the period today is in, the next
  one when it was done in this one), `routineTaskDone` (the next period, done early or late),
  `settleRoutineTask` (missed: the period today is in, `missed_on` kept, the picked time dropped;
  Q6).
- **Task fields** (`mcp/lib/tasks.ts`): `routine_id`, `window_from` (on or before `due_on`) and
  `missed_on`, the last two only on a routine's task. Search text says "Any day from … to …".
- **`mcp/lib/routine_tasks.ts`**: `findRoutine` / `loadRoutine` (the user's own live routine, via
  `get_item`), `loadRoutines`, `tasksOfRoutine` (searchable spaces only, at most 50),
  `bringTasksInStep` (each task whose dates change is written through `update_item`, so a revision
  is kept, and re-indexed), `userToday`.
- **Tools** (same descriptions, so the model's view is unchanged):
  - `save_item`: `item_type "routine"` is checked and kept in the Tasks space (another space is
    refused); a task with `routine_id` must name one of the user's routines (not a note, not
    someone else's, not one in the bin) and gets its dates from it.
  - `update_item`: a routine's schedule change brings its tasks in step (`tasks_in_step`); a
    routine cannot move out of Tasks; ticking a routine's task moves it to the next period; a task
    whose routine is gone (in the bin) ticks like a plain repeating task.
  - `find_tasks`: a routine's task shows `routine` (id and title), `window_from` and `missed_on`;
    `due_by` counts it from the first day of its window; a missed one is shown in its new period
    (read-only, as D35's day end; My day will write it, step 2); never "overdue" inside its window.
- **Migration `20261019120000_routines.sql`**: table `task_not_today` (user, task, day; RLS own
  rows; a row only for the user's own live task in a searchable space; a day from two days ago to
  400 days ahead; rows older than two days dropped as new ones are written; authenticated may
  read, add (task and day only) and remove, never change; anon nothing). `delete_item`,
  `restore_item`, `purge_item` and `deleted_item_files` replaced: a routine takes its live tasks
  into the bin at the same moment, restore brings back only those (a task binned on its own stays),
  purge deletes them for good with their files; every other item exactly as before. Nothing uses
  `task_not_today` until step 2.
- Tests: Deno `tests/deno/routines_test.ts` (17: fields, every kind of period, done, missed, the
  tools, the bin) and the fake database (`tests/eval/world.ts`) bins a routine's tasks the same
  way; **509 Deno tests pass**. SQL test `tests/sql/19_routines.sql`, **30 checks, passed locally**
  (Postgres 16 with a small stand-in for the Supabase tables), and the dry run rolled back there
  with 30 "ok": true.
- `db/schema.sql`: a "Routines" section.

**Owner, in order:** (1) run the dry run `tests/sql/dry_runs/19_routines_dry_run.sql` in the
Supabase SQL editor (a new, empty query; all 30 must say `"ok": true`); (2) OK to apply the
migration (Claude tries the connector; if it times out again, you run the migration file in the
SQL editor); (3) merge; (4) OK to deploy **`mcp` and `chat`** (both load these tools). Optional: one
evaluation run with a small cap to show nothing regressed (the tool descriptions did not change).

**Applied (2026-10-19):** the owner's dry run passed (30 "ok": true); the Supabase connector timed out
without applying anything, so the owner ran the migration file in the SQL editor. Checked read-only
afterwards: `task_not_today` with RLS on, 3 policies and its trigger; anon cannot read it;
authenticated can read, add (task and day only, not the owner) and remove, not change; the four bin
functions know routines; anon cannot call `delete_item`; 0 rows.

## As built: step 2 (2026-10-19)

Server only (the `chat` function's planner); the app shows it in step 3.

- **`_shared/dayplan/plan.ts`**: `PlanTask` gains `routine` (the routine's title) and `suggest`; the
  plan gains `suggestions: { items, more }` from `routineSuggestions` (pure code, tested): routine
  tasks offered, nearest last day first (then important, routine, title), each fitted into the
  earliest free gap on a quarter hour, never overlapping one another; a task with a place gets no
  time (the app offers Find a time, which knows drives); no duration means 30 min, marked
  `duration_assumed` (Q7); at most `MAX_SUGGESTIONS` = 3, the rest counted in `more` and offered when
  one is added or dismissed (Q4). `tasks_not_placed` rows carry `routine`.
- **`chat/day.ts`** (`makePlan`, used by My day and the chat's "plan my day"): loads the user's
  routines (searchable spaces only) and that day's `task_not_today` rows (RLS, own rows; a failed
  read offers them all); a routine's task is in the day while its window holds the day (a later
  day in another period: that period), shown with that period's last day, so never overdue; a
  missed one is moved on and written with a revision (Q6), sharing the per-plan write limit with
  D35's day end; offered (`suggest`) only while in its window, the routine's Suggest is on, not
  dismissed for that day and not already given a time. The log line counts `suggestions`.
- **`chat/agenda.ts` `planForModel`**: `routine_suggestions` (title, routine, minutes, `fits_at` /
  `until` or `needs_a_drive`, `do_by`), `more_routine_tasks_waiting`, and a note: offer them in a
  short sentence, never add them or change a task, never call one overdue; `tasks_not_placed` rows
  carry their routine.
- Tests: `tests/deno/routines_planner_test.ts` (7: the suggestion rules, My day on the pretend
  account with a routine, Not today, a placed task, a later month, the model's view); the fake
  database knows `task_not_today`. **516 Deno tests pass.** Evaluation: one new case,
  `plan-routine-suggestion` (offer the HVAC filter, never "overdue", no writes); not run yet.

**Owner:** OK and a dollar cap for one evaluation run (the new case and the calendar ones, to show
the plan's wording still holds), then merge, then OK to deploy `chat` (`mcp` is unchanged).
