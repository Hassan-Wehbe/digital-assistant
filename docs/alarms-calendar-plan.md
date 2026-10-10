# Alarms, reminders and calendar entries

Status: plan, 2026-10-10. **Waiting for the owner's answers to the open questions below; nothing is
built yet.** Design: D31 (and D25, whose "Wilma never changes your calendar" this ends), D30
(order: after automatic memory, before usage tracking D34). Model: the strongest for steps 1-3
(chat loop, new chat actions, the calendar write); a smaller one for step 4 (wording, checklist,
build).

## What the owner will see

Three new things Wilma can do from the chat (typed or spoken), each shown as a card under her
answer. **Nothing happens until you tap the card's button.**

- **Alarms, in the phone's own Clock app.** "Wake me at 6:30", "set an alarm for 5:45 on weekdays".
  Card: "⏰ Alarm 6:30 am · tomorrow" with **Set in Clock**. The tap opens the Clock app with the
  time (and label, and weekdays) filled in; you see it there and it rings like any alarm you set
  yourself, even if Wilma is closed or uninstalled. Wilma keeps no copy and never changes or deletes
  alarms.
- **Reminders, as a Wilma notification.** "Remind me at 5 to call Sam", "remind me tomorrow at 9 to
  pay the nanny". Card: "🔔 Reminder 5:00 pm today: Call Sam" with **Set reminder** (and Cancel).
  At that time the phone shows "Call Sam" as a Wilma notification, like the leave-by alerts.
  Upcoming reminders are listed (Q4) with Cancel on each.
- **Calendar entries, in a calendar you pick.** "Put the dentist on my calendar Tuesday at 3".
  Card: "📅 Dentist · Tue Oct 14, 3:00-4:00 pm · Family calendar ▾" with the title, day, start, end
  and place editable on the card, and **Add to calendar** (and Cancel). Only after the tap is the
  event written, to the calendar shown; then "Added · Open in Calendar". Wilma never edits or
  deletes an event, including the ones she added (Q6).

Typed or said, the words become a card the same way. Older app versions never get these cards
(they say "update Wilma to set alarms" instead), and the Claude connector does not offer them: they
happen on the phone.

## Decisions already made (owner, 2026-10-10, D31)

- Alarms go to the phone's own Clock app with Android's "set alarm" screen, filled in, so the user
  sees it. Reminders use Wilma's notifications (the morning briefing's code).
- A calendar entry is written **only after the user confirms it on screen**, never silently, to a
  calendar the user picks; Wilma never edits or deletes events it did not make.
- It all runs on the phone (an app-run action, like reading the calendar). **Nothing about an
  alarm, reminder or event is kept on the server** (the chat already sends what the user typed to
  the model, as today).
- The calendar permission text, Settings → Calendars, the privacy page and D25 change with the
  build that ships it. Android's calendar permission already grants reading and writing together,
  so no new permission prompt for calendars.

## Open questions (recommended defaults first)

The owner answers these before anything is built. "Go with your recommendations" takes every
first option.

- **Q1. What "remind me" does.** (a) **A Wilma notification at that time (recommended):** works
  for any day ahead, can carry a line of text, shows Wilma's icon. (b) A Clock alarm: louder, but
  the Clock's "set alarm" screen only takes a time of day (the next 6:30, or weekly days), not
  "Thursday the 23rd". (c) A Wilma task with a due time. Recommended split: "wake me" and "alarm"
  → Clock; "remind me" → notification; "add a task" stays a task, as today.
- **Q2. A tap before an alarm or reminder is set.** (a) **Yes, a card with one button
  (recommended):** the model never acts on its own (rule 9's spirit), and a misheard voice
  request costs nothing. (b) Reminders set at once with an Undo line, like memory. Calendar
  entries always need the tap (D31).
- **Q3. Is a reminder also saved as a note or task?** (a) **No (recommended):** it lives only in
  the phone's notification schedule, like the leave-by alerts; nothing on the server. (b) Also a
  task in Tasks, so it shows on other devices and in My day.
- **Q4. Where to see and cancel reminders.** (a) **Settings → Reminders (recommended):** the
  upcoming ones, soonest first, with Cancel. (b) A line on Home when one is due today. (c) Only
  by asking Wilma ("what reminders do I have?"); this needs (a)'s list anyway.
- **Q5. Which calendar new events go to.** (a) **A "New events go to" choice in Settings →
  Calendars (recommended),** first set to the phone's primary calendar among the ones you ticked
  (only calendars the phone lets apps write to); the card shows it and lets you change it for that
  event. (b) Ask every time.
- **Q6. Changing or deleting events Wilma added.** (a) **Not in this feature (recommended):** add
  only; you change or delete them in your calendar app ("Open in Calendar" after adding). (b)
  Wilma may move or delete events she added (she would remember their ids on the phone), each with
  its own confirm card.
- **Q7. Free or Pro.** (a) **Free (recommended):** no paid map or weather call, only the chat
  answer, and reading the calendar is already Free. (b) Pro, like My day.
- **Q8. Repeating.** (a) **Alarms may repeat on weekdays (the Clock does it); reminders are one-off
  (recommended).** (b) Repeating reminders too ("every Monday at 8"), with their own schedule
  rules.

Small ones, defaults chosen unless the owner says otherwise:

- Q9. A new event lasts 1 hour unless the user says otherwise; all-day when only a day is given
  ("put Lexi's recital on Friday"); no guests are ever added; the calendar's own default
  reminder applies.
- Q10. A reminder's notification shows the words as said ("Call Sam") on the lock screen. Text
  that looks like a password, PIN or code is refused by the server, as `save_item` does (rule 9),
  and Wilma points to the vault.
- Q11. Reminders, like the briefing, may arrive a few minutes late while the phone sleeps (Wilma
  does not ask for Android's exact-alarm permission; Play allows it only for alarm and calendar
  apps). The card says "5:00 pm"; Settings → Reminders says "may be a few minutes late; use an
  alarm when the minute matters". Alarms in the Clock are exact.
- Q12. An alarm is for the next time that time comes (the Clock's rule) or for weekdays; "wake me
  at 6:30 on the 23rd" gets a reminder card instead, with a sentence saying why.
- Q13. When the calendar is read (Settings → Calendars on), the event card says "You have Swim at
  3:00 then" if the new event overlaps one; otherwise no check.

## How it works

**The chat (server, `chat`; chat-only actions in `actions.ts`, like `show_places`).** Three new
actions the model may call, offered only when the app says it can (`"can": [..., "alarm",
"reminder", "calendar_add"]`), so older apps and the Claude connector never see them:

- `set_alarm({time: "06:30", days?: ["mon",...], label?})`
- `set_reminder({at: "2026-10-11T17:00", text})`
- `add_calendar_event({title, start, end?, all_day?, location?})`

Times are the user's local wall-clock times in the phone's time zone (`tz`, already sent). The
server checks every field before anything reaches the app: a real time, a reminder or event in the
future and within a year, sizes (title and text at most 200 characters), and **no credential-looking
text** (`findCredential`, the same check `save_item` uses; refused with the vault sentence, rule 9).
It then sends one event to the app and tells the model "waiting for the user to tap", exactly as
the delete card does (`confirm.ts`):

```
{"type":"alarm","time":"06:30","days":["mon",...],"label":"..."}
{"type":"reminder","at":"2026-10-11T17:00","text":"Call Sam"}
{"type":"calendar_add","title":"Dentist","start":"2026-10-14T15:00","end":"2026-10-14T16:00","all_day":false,"location":null}
```

Nothing is stored or logged but counts (`{"event":"action","kind":"reminder"}`). Wilma's
instructions get a few lines on when to use each; the model never sees a calendar id.

**The app.**

- **Alarm card → Clock.** Android's `AlarmClock.ACTION_SET_ALARM` intent with the hour, minutes,
  label and days, `SKIP_UI` false, so the Clock shows its own screen with the alarm filled in. It
  needs `com.android.alarm.permission.SET_ALARM`, an install-time permission (no prompt, no Play
  form). Opened with `expo-intent-launcher` (or React Native's `Linking.sendIntent` if it passes the
  numbers as whole numbers; step 2 checks on a phone). No Clock app that takes it: "Your phone's
  Clock app didn't open; set it there yourself." iPhone and the web build: no card (iPhone has no
  such intent; later, a reminder instead).
- **Reminder card → notification.** `lib/notifications.ts` gets a `reminder` kind
  (`wilma.<date>.reminder.<n>`), scheduled with `expo-notifications` like the leave-by alerts,
  carrying the account; the notifications permission is asked on the first reminder if not given.
  The list in Settings → Reminders reads the phone's schedule (`scheduled()`), so there is nothing
  else to keep in step. As today, sign-out, another account signing in, and Delete account cancel
  every Wilma notification, reminders included (Settings → Reminders says so). A tap on a reminder
  opens Wilma's Home.
- **Calendar card → the phone's calendar.** `expo-calendar`'s `createEventAsync` on the calendar
  chosen (Q5), only from the tap on **Add to calendar**; `lib/calendar.ts` gets its first and only
  write function, with the rule written next to it: create only, never update or delete. The card's
  fields are checked again on the phone before writing (the server's checks are not trusted alone).
  Without calendar permission the card asks for it on the tap; the calendar setting off: the card
  says to turn it on in Settings → Calendars.
- **Older apps:** they do not send the new `can` values, so the actions are not offered and Wilma
  answers in words ("I can set alarms once you update Wilma").

**Never (rules 1, 3, 9):** a password or code in a reminder, alarm label or event (server and
phone both refuse); anything from the vault or a restricted space on the lock screen (the text is
only what the user asked for; restricted spaces are not searchable anyway); an event written
without a tap; an event changed or deleted.

## Steps (one PR each)

1. **Server: the three chat actions** (strongest model: chat loop, rule 9): `actions.ts`
   (`set_alarm`, `set_reminder`, `add_calendar_event`, their checks and events), the `can` values,
   Wilma's instruction lines, Deno tests (each check, the credential refusal, not offered without
   `can`, the waiting message), and **evaluation cases**: each action from plain and spoken-style
   wording, "remind me" vs "wake me" vs "add a task", a date the Clock cannot take, and traps (a
   reminder holding a PIN or Wi-Fi password, an event titled with a password, a restricted space's
   note asked onto the calendar, "add it without asking me"). **Owner:** OK and a dollar cap for
   one paid evaluation run (rule 9, D21; about $1 as for memory), then OK to deploy `chat`.
   Nothing changes for today's app.
2. **App: alarm and reminder cards** (strongest model: chat client): the two cards, the Clock
   intent and its permission, the reminder kind in `lib/notifications.ts`, Settings → Reminders,
   the new `can` values for these two. App tests (card from each event, the permission asked once,
   reminders cancelled on sign-out, the list). Ships with the next build.
3. **App: calendar entry card** (strongest model: first write to the user's calendar): the card
   with editable fields, the overlap line (Q13), "New events go to" in Settings → Calendars
   (only writable calendars), the create-only write, `calendar_add` in `can`. App tests (nothing
   written without the tap, the chosen calendar used, a read-only calendar never offered, fields
   checked again).
4. **Privacy and build** (smaller model): the calendar permission text ("Wilma reads the calendars
   you choose … and adds an event only when you tap Add to calendar"), the line in Settings →
   Calendars, the privacy page (calendar paragraph; reminders kept in the phone's notification
   schedule), D25's "never changes your calendar" sentence, Play Data safety check (expected: no
   change, nothing new leaves the phone), a legal checklist item, `docs/versioncode20-phone-checklist.md`,
   then "build for Play" (versionCode 20). The owner's OK on the wording first (merging publishes
   the privacy page).

**What the owner must do:** answer the questions above; OK and a cap for the evaluation run (step
1); OK to deploy `chat` (step 1); OK on the privacy wording (step 4); "build for Play" (step 4);
then test on the phone with the checklist.
