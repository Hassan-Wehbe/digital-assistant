# Tasks left open at the end of their day

Status: plan, 2026-10-10. Owner's answers given the same day ("go with your recommendations").
Design: D35 (new), part of the day planner (D25). Built **before** alarms and calendar entries
(D31, `docs/alarms-calendar-plan.md`). Model: the strongest for both steps (it changes how tasks
are closed automatically, on the server and in the app).

## Why

The owner noticed (2026-10-10) that "Lunch", put in My day on Oct 9 at 12:03 and not marked done,
showed in Oct 10's plan under "Not placed yet" as overdue, asking to find a time again. Today My day
takes every open task due on or before the day, and keeps a task's time only when it is on the day
being planned (`supabase/functions/chat/day.ts`, `makePlan`). A task with a time on an earlier day
therefore comes back as if it had never been planned.

Found at the same time, a plain bug: a task with a time on a **later** day and no due date shows in
today's plan as "Not placed yet".

## What the owner will see

- **When a task gets a time** (＋ Add → Find a time, a suggested time in My day, the task's screen):
  a new optional line, **"If it's not done by the end of the day"**: *Mark it done* · *Move it to
  the next day*. Left blank unless picked. Not shown for repeating tasks (they already move to
  their next date) or for a task without a time.
- **Mark it done:** the task is closed as of the end of that day (done at 11:59 pm that day) and is
  not in the next day's plan.
- **Move it to the next day:** the task comes into the next day's plan under "Not placed yet",
  marked "from Oct 9", to find a time for. It keeps moving forward (as an overdue task does) until
  done.
- **Neither picked:** the next day's My day shows it at the top:

  > **Left open yesterday**
  > ☐ Lunch · planned 12:03 pm
  > **Add to today** · **Done** · **Remove**

  - *Add to today:* it becomes a task due today, in "Not placed yet", with Find a time.
  - *Done:* marked done.
  - *Remove:* moved to the Recycle bin (restorable, as Delete is today).

  No need to open the task. Not answered: asked again the next day ("Left open · Oct 9"). A
  repeating task shows only *Add to today* and *Done* (Done moves it to its next date, as today).
- **Tasks with only a due date, no time:** unchanged; they stay "overdue" until done.
- **Tasks made in the chat** ("lunch with Sam tomorrow at 12"): Wilma does not ask; the choice is
  left blank, so My day asks the next day. The choice can be set on the task any time.

## Decisions (owner, 2026-10-10)

- Q1 *Remove* moves the task to the Recycle bin.
- Q2 Only tasks given a time get the choice; tasks with only a due date keep today's overdue rule.
- Q3 Wilma does not ask in the chat (no change to her instructions or tool descriptions, so no
  evaluation run; rule 9 / D21).
- Q4 Built before alarms and calendar entries.

## How it works

**Stored:** one new optional task field, `day_end`: `"done"` or `"next_day"` (absent: not chosen).
Allowed only with `planned_at` and not on a repeating task (`normalizeTask` refuses it otherwise,
like its other rules). Task fields live in `item.metadata`, so **no migration**. Clearing
`planned_at` clears `day_end` with it.

**When a task's day has ended** (its `planned_at` day, read in `planned_at`'s own offset, is before
the user's today), the server settles it the first time it reads the task: in My day's plan
(`day.ts`) and in `find_tasks` (the Tasks screen, the chat and the Claude connector). With no
phone time zone (the connector), "today" is taken in `planned_at`'s offset.

- `day_end: "done"` → marked done, `done_at` the end of that day.
- `day_end: "next_day"` → `planned_at` and `day_end` removed, `due_on` set to the day after the
  planned day; from then on it is an ordinary open task (overdue rules as today).
- Not chosen → nothing written; the plan lists it as **left open** (below) until the user answers.

Each settle goes through the same update path as an edit, so the previous version goes to
`item_revision` (rule 7), with the change note "closed at the end of its day" / "moved to the next
day". Only the user's own, searchable, not deleted tasks are read, as the user (RLS; rules 3, 5).
Two reads at once settle a task once (the update checks the task still has that `planned_at`).

**The plan:** `tasks_not_placed` entries for a task left open get `left_from: "2026-10-09"` and
`planned_time: "12:03"`. Today's app shows them as it does now (overdue, Find a time); the new app
shows them in **Left open yesterday** instead. The chat's plan given to the model (`planForChat`) is
**unchanged**: the new fields are left out of it, so Wilma's input does not change.

**The three buttons** use what exists: *Add to today* is `update_item` (metadata without
`planned_at` and `day_end`, `due_on` today); *Done* is `update_item` with `task_done`; *Remove* is
`delete_item`. Then the plan is made again.

**The bug:** an open task with `planned_at` on a later day is left out of today's plan, whatever
its due date (today, only a due date in the future kept it out).

**Older apps** (versionCode 19): they ignore `left_from`, so a left-open task looks as it does
today. Their task screen does not know `day_end` and may drop it when the task is edited; the task
is then "not chosen" and asked about the next day. Nothing breaks.

## Steps (one PR each)

1. **Server** (strongest model): `day_end` in `mcp/lib/tasks.ts` (with tests for its rules);
   settling ended days (a helper used by `day.ts` and `find_tasks`; revision written; once only);
   `left_from` / `planned_time` in the day plan and kept out of `planForChat`; the later-day bug;
   Deno tests (each choice, not chosen, no time zone, a repeating task, a restricted space's task
   never read, a revision written, two reads settle once, the chat's plan unchanged). No tool
   description or instruction change, so no evaluation run. **Owner:** OK to deploy `mcp` and
   `chat`. Today's app keeps working (and stops seeing tasks planned for a later day as today's).
2. **App** (strongest model): the "If it's not done by the end of the day" choice where a time is
   set; My day's **Left open** section with Add to today · Done · Remove; "from Oct 9" on moved
   tasks; app tests (each button, the choice saved and cleared with the time, repeating tasks).
   A few lines in the next build's phone checklist. Ships with the next build. No privacy page or
   Data safety change (nothing new leaves the phone or is shared).

**What the owner must do:** OK the `chat` / `mcp` deploy after step 1 is reviewed; then the next
build ("build for Play") carries step 2.
