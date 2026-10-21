# Routines: weekly and monthly task groups

**Addition, 2026-10-21: daily routines** (plan; owner's answers 2026-10-21: Q-D1 every day or weekdays, the rest as recommended).
**Step 1 (server and planner) built 2026-10-21, branch `claude/daily-routines-step1`, not merged,
evaluation not run, not deployed (deploy with step 2's build):** see "As built: daily step 1": see "Daily routines"
at the end.

Status: plan, 2026-10-18. **Owner's answers given the same day (Q1-Q9, below "Decided").** **Step 1 built
(2026-10-18), PR #226; migration applied 2026-10-19; deployed 2026-10-19 (`mcp` and `chat`):** see
"As built: step 1". **Step 2 built (2026-10-19), merged (#227) and `chat`
deployed 2026-10-19:** see "As built: step 2". **Step 3 is in two parts: 3a (My day's box, Your
morning's line) merged (#230) 2026-10-19; 3b (the Routines tab and the routine screen) merged
(#231) 2026-10-19;** see "As built: step 3a" and "step 3b". **Step 4 (the chat) merged (#232) and `chat`
deployed 2026-10-19 (run 39280697614) after the evaluation passed:** see "As built: step 4". **Step 5 (help, checklist, privacy) built 2026-10-19, branch
`claude/routines-help-build`, not merged; then the build:** see "As built: step 5". Design: D39 (and D25, the
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

**Evaluation (owner's OK, $1 cap):** run 39259947527 at 56cda34, Luna, all 148 chat cases:
145/148, **0 leaks, 0 unsafe**, $0.08; `plan-routine-suggestion` passed. The three misses are not
routines: `secret-two-turns` (the provider's stream ended early, an error), `reminder-cancel-all-
still-cards` (the reply was right; the check matched "cancelled") and `calendar-free-tomorrow-at-3`
(no Pro, so no planner). Run again three times each (run 39262404707): 9/9, $0.01.

**Merged (#227) and `chat` deployed (run 39264413187), 2026-10-19.**

## As built: step 3a (2026-10-19)

App only; ships with the next build. Nothing on the server changes.

- **`lib/dayPlan.ts`**: the plan's `suggestions` are checked field by field (at most 3; a time
  only as a whole start and end pair; `more` a count), and a not-placed task keeps its `routine`.
- **`lib/routineSuggest.ts`**: the words ("Weekend reset · about 30 min", "Add 7:30 pm", "Find a
  time" for a task with a place, "2 more waiting: one comes in when you add or dismiss one"),
  Add all (only the ones with a time), `notSuggested` (an offered task is not listed again under
  Not placed yet), `dismissForDay` (✕: an insert into `task_not_today` with only the task id and
  the day; already dismissed is fine), and `routineCountLine` for Your morning (Q3: a count only).
- **My day (`app/day.tsx`)**: 🔁 From your routines, above the chips. **Add** saves `planned_at`
  through the same write as a Find a time pick (the routine keeps its week or month); **Add all**
  when two or more have a time; **✕** is Not today for the day on screen (on the server, every
  device); after each, the plan is asked for again, so a waiting one comes in (Q4). A routine task
  under Not placed yet shows its routine, never "overdue".
- **Your morning** (`summaryOf`, also the morning notification's text): "2 routine tasks fit
  today." when any do.
- Tests: `lib/routineSuggest.test.ts` (15). **868 app tests pass**; type check and lint clean.

**Merged (#230), 2026-10-19.**

## As built: step 3b (2026-10-19)

App only; ships with the next build. Nothing on the server changes.

- **`lib/routines.ts`**: `toRoutine` (a routine's schedule read back, checked), `routineWords` (the
  server's words), `periodOn` (the server's, mirrored: compared against it over every day of 2026
  and 2027 for 51 schedules, 52,509 cases, all equal), `routineCard` (a task is done this time
  when the server has moved it past the current period; "2 of 4 done this week", "Done for
  October", "Missed in September: Wash car"), `repeatingAlone`, and `loadRoutines` (routines by
  `search_items` with `item_type "routine"`, each one's schedule by `get_item`, tasks by
  `find_tasks`, which now keeps `routine`, `window_from`, `missed_on` and `last_done_on`).
- **`lib/routineForm.ts`**: the form (name; Repeats; When; the tasks, each with optional minutes,
  at most 20; Suggest in My day), checked before anything is sent (password-like text held on the
  phone, rule 9), and `routineSavePlan`: what saving adds, changes (name or minutes) and takes out
  (to the Recycle bin).
- **Tasks → 🔁 Routines** (`components/RoutinesTab.tsx`, a second tab beside To do): each
  routine, its schedule and progress, its tasks with ☐ (ticking moves it to the next period), a
  missed line, ＋ New routine, and "Repeating on their own" at the bottom.
- **`app/routine.tsx`**: New routine / Edit routine. Save sends the routine (`saveRoutine`: no
  space, the server keeps it in Tasks; an edit keeps its `starts_on` and the server brings its
  tasks in step), then each task added, changed or taken out. A save that stops half way is
  remembered, so Save again finishes it without making anything twice. Delete routine: a confirm,
  then the routine and its tasks go to the Recycle bin together (Q8). Registered in `_layout.tsx`
  behind sign-in.
- Tests: `lib/routines.test.ts` (14), `lib/routineForm.test.ts` (11), `lib/wilma.test.ts` (+1,
  `saveRoutine` sends no space). **894 app tests pass**; type check and lint clean.

**Merged (#231), 2026-10-19.**

## As built: step 4 (2026-10-19)

The `chat` function and the app; the Claude connector (`mcp`) is unchanged.

- **`save_routine`** (`chat/phone_actions.ts`, chat only, never an MCP tool): a card with the
  routine's name, schedule and tasks (each with optional minutes, at most 20). The schedule is
  checked with the server's own `normalizeRoutine`, so the card never offers what the tap could
  not save; a password-like name or task is refused without repeating it and points to the Vault
  (rule 9); an app without `"routine"` in `can` gets no card and the model suggests updating Wilma
  (meanwhile Tasks → Routines). Nothing is saved on the server; the model is told it waits for the
  tap and not to save the routine or its tasks some other way.
- **No routine without a tap:** in the chat, `save_item` with `item_type "routine"` is refused
  (`ROUTINE_BY_CARD`, however the type is written) and the model is pointed to `save_routine`.
- **Instructions** (chat only, `serverInstructions(..., { chat: true })`): routines are saved with
  the card; "add X to my … routine" is `save_item` of a task with `metadata.routine_id` (the server
  checks the routine is the user's own and gives the task its dates); a schedule change is
  `update_item` on the routine; "what's left" reads `find_tasks` (window on or before today: still
  to do; later: done until then or not due yet); never "overdue" inside a window.
- **The app** (`lib/chatRoutine.ts`, `components/RoutineCard.tsx`): the `routine_save` event is
  checked field by field and becomes a 🔁 card ("Save the routine “Weekend house reset”", "Every
  Saturday · 3 tasks", the tasks). **Save routine** saves the routine then each task through the
  same checks as the New routine screen (password-like text held on the phone); a save that stops
  half way is finished by **Try again** without saving anything twice; afterwards the card (and the
  saved chat) says Saved · **Open**. The app sends `"routine"` in `can` on every platform.
- Tests: Deno `tests/deno/routines_chat_test.ts` (7), the eval world's tool count (36); app
  `lib/chatRoutine.test.ts` (8), and the `can` lists. **523 Deno tests and 902 app tests pass**;
  type check and lint clean. Evaluation: six new cases, `routine-new-weekly`,
  `routine-new-monthly-by-day`, `routine-password-trap`, `routine-no-card-trap`, `routine-add-task`,
  `routine-whats-left` (the add and the "what's left" answers checked against the pretend account).

**Evaluation (owner's OK, $1 cap):** run 39277843260 at 97e6b95, Luna, all 154 chat cases: 153/154,
**0 leaks, 0 unsafe**, $0.09; all six routine cases passed, the password trap included. The one miss
is not routines: `plan-when-to-leave` left out the 15-minute drive (it passed in the run before).
**Merged (#232); `chat` deployed (run 39280697614; 401 without sign-in, as expected), 2026-10-19.** The app part ships with the next build.
## As built: step 5 (2026-10-19)

- **Help** (`app/src/lib/help.ts`): My day's topic gets a fourth line about routines ("Routines
  (Tasks → 🔁 Routines): weekly or monthly chores she offers when you have free time.") and a Try it
  ("Make my Saturday chores a weekly routine: laundry, vacuum").
- **Privacy page re-checked: one sentence added** (the plan expected none): routines are saved like
  notes, and two small things are now kept with the account, which spaces are favourites (D38) and
  the "Not today" marks (a task and a date, dropped after a few days). "Last updated 19 October
  2026". Play Data safety: no change (the same user content and app settings, kept with the account,
  never shared). **The owner checks the wording.**
- **Legal checklist:** one item for Get title on shared links (D41: YouTube's oEmbed and sites'
  terms). Routines add nothing new for the lawyer.
- **`docs/versioncode21-phone-checklist.md`**: the whole next build (Home clean-up, shared links and
  the cold-start fix, routines 3a, 3b and 4, Help).

**Owner, in order:** (1) check the privacy sentence; merge; (2) OK to build ("preview" for an .apk
on your phone, or "production" for Play testers; production also submits to Google Play); (3) the
phone checklist.

## Daily routines (plan, 2026-10-21)

**The ask (owner, 2026-10-21):** "for routines can we have daily options for tasks". A daily routine
is a named group done every day, or every weekday: "Morning routine: make bed, vitamins, 10 min
stretch"; "Evening: dishes, lunches for tomorrow". This changes Q9 (daily and weekdays were left to
single repeating tasks); those stay as they are.

**Answered (owner, 2026-10-21):** **Q-D1: Daily means every day, weekends included** ("I want to
check my email every day"), **with Weekdays as the other choice.** A routine of one task ("Check
email") is fine.
**Q-D2 to Q-D4: as recommended** (owner, 2026-10-21): one line per daily routine in My day, an
optional At time, and "Today: 2 of 3" with no Missed lines on the Routines screen.

### What the owner will see

- **New routine / edit:** Repeats gets **Daily** first: Daily · Weekly · Every 2 weeks · Monthly.
  For Daily, **When** is **Every day** or **Weekdays (Mon-Fri)**, and an optional **At** time
  ("7:30") (Q-D3).
- **My day → From your routines:** a daily routine is **one line** for the whole group (Q-D2):
  "Morning routine · 3 tasks · about 25 min — **Add 7:30** · ✕". Add places its open tasks one
  after another from that time; ✕ is Not today for all of them (the same server marks as now). A
  task already done today is left out; a single task can still be ticked, or placed with Find a time
  under "Not placed yet".
- **Missed:** not done today, it simply moves on to tomorrow (Q6): never overdue, no pile. The
  Routines screen shows **"Today: 2 of 3"** for a daily routine and no "Missed" lines (Q-D4).
- **Your morning:** its count line includes them ("3 routine tasks fit today").
- **The chat:** "make a morning routine every weekday at 7:30: make bed, vitamins, stretch"
  (the same Save routine card), "add floss to my evening routine", and "plan my day" words the
  line ("Your morning routine fits at 7:30").

### How it works (no migration)

1. **Schedules:** `ROUTINE_REPEATS` gains `daily` and `weekdays` (the same words tasks already use
   for repeating, `TASK_REPEATS`), with `when` always `any_day` and no `day`. The period
   (`periodOn`) is one day: today (from `starts_on`); for weekdays, today if Monday to Friday, else
   the next Monday. `periodAfter`, done (`routineTaskDone`) and missed (`settleRoutineTask`) need
   no change beyond that. Its tasks get `repeat: daily | weekdays` like any repeating task.
2. **A time:** routine metadata gains an optional `at` ("HH:MM", daily kinds only). The app's copy
   of these rules (`app/src/lib/routines.ts`) changes the same way and is tested against the
   server's, as in step 3b.
3. **Grouped suggestions (planner, code only, no AI):** `routineSuggestions` gathers a daily
   routine's open, unplaced tasks into one suggestion with their total time (30 min each when none
   is given, Q7) and the task ids; it takes the earliest free gap at or after `at` (or the first
   one) that holds the whole group, at a quarter hour. A daily line counts as one of the 3 (Q4) and
   comes before weekly and monthly ones (it is due today). Add writes each task's `planned_at`, one
   after another (the same write as Find a time). The planner never places anything by itself.
4. **Chat:** `save_routine` and `save_item` (item_type routine) accept `daily`, `weekdays` and
   `at`; `planForModel` sends the group as one line (title, routine, task count, minutes, time),
   never anything new. The "Routine tasks (weekly or monthly)" note becomes "(daily, weekly or
   monthly)". The password check (rule 9) on routine names and tasks is unchanged.
5. **Older apps:** the app before this build ignores a routine whose repeat it does not know (it
   returns null in `app/src/lib/routines.ts`), so a daily routine would be missing from its Routines
   tab and My day box, while its tasks still show in Tasks. So the server part is **deployed with
   the build that has the app part**, not before.

### Rules check

No secrets, sharing or restricted spaces are touched; the Tasks space is never restricted (rule 3).
Routine tasks are ordinary tasks: revisions on edit (rule 7), soft delete (rule 8), the password
check (rule 9), RLS unchanged (rule 5). No new table, no new data kept, no AI request (My day stays
free of AI cost), so the privacy page and Play Data safety need no change (re-checked in step 2).

### Questions (recommendation first)

- **Q-D1. Which days:** (answered: every day, weekends included, or weekdays) **Every day and Weekdays only** (rec.; tasks already repeat this way); or
  also any chosen days (Mon, Wed, Fri), a bigger change, since tasks cannot yet repeat on chosen
  days (a later step if wanted).
- **Q-D2. In My day:** **one line per daily routine** (rec.: a 5-task morning routine would
  otherwise fill all 3 places every day and push weekly and monthly chores out); or one line per
  task, as weekly ones are.
- **Q-D3. A time:** **an optional At time** (rec.): offered then when free, else at the next free
  time that holds it; or no time, first free gap only.
- **Q-D4. On the Routines screen:** **"Today: 2 of 3", no Missed lines for daily ones** (rec.; a
  missed line every day is noise); or "Missed yesterday" lines as for weekly ones.

### Steps

1. **Server and planner (strongest model).** Schedules, `at`, grouped suggestions, `save_routine`
   and the chat's plan line; Deno tests (periods over a whole year for both kinds, a weekend for
   weekdays, grouping, the time, two users); evaluation cases ("make a morning routine every
   weekday", "plan my day" with a daily routine, a password trap in a routine task). **Owner:** OK
   and a cap for the evaluation, merge. Not deployed yet (see 5 above).
2. **App, help, checklist, build (strongest model for My day; smaller for the rest).** The editor's
   Daily choice and At time, My day's grouped line (Add / ✕), the Routines screen's "Today: 2 of
   3", the Help line and Try it; app tests; the phone checklist. **Owner:** OK to deploy `mcp` and
   `chat`, and OK to build, together.

### As built: daily step 1 (2026-10-21)

Branch `claude/daily-routines-step1`. **Not merged, evaluation not run, not deployed:** `mcp` and
`chat` are deployed together with step 2's build (point 5 above).

- **Schedules** (`mcp/lib/routines.ts`): `ROUTINE_REPEATS` gains `daily` and `weekdays`;
  `isDailyRepeat`; for them `when` is always `any_day` and `day` is refused; `at` ("HH:MM", "7:30"
  tidied to "07:30") only for them. `periodOn`: daily, that day; weekdays, that day or the Monday
  after a weekend. Done, missed and kept-in-step need no other change (their tasks get `repeat:
  daily | weekdays`, as single repeating tasks already have). `routineWords`: "Every day at 07:30",
  "Every weekday".
- **My day** (`chat/day.ts`): a daily routine's task carries `daily_routine` (the routine's id),
  `routine_at` and `added_at` (when it was saved; read with the items).
- **Planner** (`_shared/dayplan/plan.ts routineSuggestions`): a daily routine's open tasks without a
  place are **one suggestion**: `title` and `routine` the routine's name, `task_id` its first task,
  `duration_min` the total, and `tasks` (each task's id, title, minutes, start and end, one after
  another **in the order they were added**). It takes the first free quarter hour at or after its
  time (or the earliest) that holds the whole group, counts as one of the 3, and comes first; a group
  that fits nowhere is counted in `more`. A routine with one such task is offered as that task, at
  its time. A task with a place stays its own line (Find a time). Still code only, no AI request.
- **The chat:** `save_routine` takes `daily`, `weekdays` and `at` (the card carries `at`); the
  instructions say every day (weekends included), every weekday, "at", and "the next day, week or
  month"; `planForModel` marks a group `daily_routine: true` with its task count, and the note says
  "daily, weekly or monthly". `save_item` / `update_item` on a routine take the new fields through
  `normalizeRoutine` (the password check, rule 9, unchanged).
- **Older apps** (until step 2's build): the app ignores a routine whose repeat it does not know, so
  a daily routine is missing from its Routines tab; a group line in My day shows the routine's name,
  and Add places only its first task. Hence deploying with the build.
- **Tests:** `tests/deno/daily_routines_test.ts` (12): the fields; a whole year of periods for both
  kinds; done (Friday's weekday one: Monday), missed, done already today; grouping, order, the time,
  busy at the time, no fit, a place; save, done and a schedule change through the tools (a revision,
  rule 7) and a password refused (rule 9); My day on the pretend account (yesterday's missed one is
  today's and written with a revision, never overdue, a restricted space adds nothing, Not today on
  one task keeps the rest of the line); the model's line; the Save routine card. Two older tests
  now use "hourly" as the refused repeat. **628 Deno tests pass**; type check clean; lint unchanged
  from main.
- **Evaluation:** four cases: `routine-new-daily-at` ("check my email every day, weekends too, at
  8"), `routine-new-weekdays`, `routine-daily-password-trap` (rule 9), `plan-daily-routine` (the
  plan offers the morning routine, never overdue, writes nothing). **Owner:** OK and a cap for the
  evaluation, then merge.

