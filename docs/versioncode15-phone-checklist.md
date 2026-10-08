# Phone checklist for versionCode 15: My day and tasks

For the owner, on the Play build after versionCode 14. It carries the day planner's app side
(`docs/phase6-day-planner-step2-plan.md`):
- **🌅 My day** (step 4, #176): the timeline with leave-by times (Mapbox, traffic), rain and
  weather alerts (US National Weather Service), overlaps with Take both, free time, Home setup,
  the event detail, "📍 Where is this?", and **Open my day** from the chat.
- **Tasks** (step 5, #178): the Tasks tile and list, the task form, and ＋ Add → Find a time in My day.
The server side is live (`chat` and `mcp`, deployed 2026-10-08 with #177 and #178's change).

About 30 minutes. **Never type or say a real password or code.** Your account is Pro (My day is a
Pro feature); the Play review account is Pro too.

## Before you start

- [ ] Play Console: Data safety has **Calendar → Calendar events** (left over from versionCode 14;
  steps in `docs/phase4-play-release.md`, "Data types"). Nothing else changes in the form for this
  release (see "Day planning" there). Send the change for review with this release.
- [ ] The privacy page shows "Planning your day" (published when the step 6 PR is merged).
- [ ] Phone Settings → Apps → Wilma → Permissions → **Location: Allow only while using the app**
  (My day finds your events' addresses with the phone's map lookup only when location is allowed).
- [ ] Tomorrow's calendar has an event with a **street address** as its location, one with a
  **name only** (e.g. "Aquatic Center"), one **video call**, and two that **overlap at the same
  place** (e.g. two swim sessions).

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**.
- [ ] Home shows **🌅 My day** and **✅ Tasks** tiles, with no PRO badge on your account.

## My day

- [ ] Tap 🌅 My day. No typing, and the usage counter does not change (no AI request).
- [ ] Your Home is set (the 🏠 line at the bottom). Tap **Change** and back out with Not now.
- [ ] Switch to **Tomorrow**. The address event has a **🚗 Leave for …** row with minutes "with
  traffic" (and "usually …" when traffic adds time) + 5 to park.
- [ ] The name-only event says **📍 found by name: … Is this right?** Tap **Yes, that's it**, or
  **Pick another** → Type an address → Find it → Use this place.
- [ ] The video call has **no drive row**.
- [ ] An event whose place cannot be found shows **📍 Where is this?** Try **Not a trip**: the
  question goes away. (It is remembered for that event's name.)
- [ ] The overlap shows **⚠ Overlap** with **Take both**. Tap it: one trip, "one trip with …" on
  both events. **Undo one trip** puts it back.
- [ ] If rain is forecast at 50% or more there, a **🌧** row; at the bottom, "Drive times ©
  Mapbox · Weather: US National Weather Service".
- [ ] Tap an event: the sum (**Drive from Home**, Usually, Park and walk in, **Leave by**), the
  hourly rain there, **Not driving** (the drive row goes; tap I'm driving to bring it back) and
  **Directions** (opens Google Maps).
- [ ] Leave My day and open it again: the plan is fetched again (nothing about drives is kept on
  the phone); your Take both and answers are still there.

## Tasks

- [ ] ✅ Tasks → **＋ New**: "Return the library books", 15 min, Pick a place, By when **Saturday**,
  Repeats **One time**, Save. It opens the task; its line shows "15 min · … · by Sat".
- [ ] Back in Tasks it is under **This week** (or Today). Tick ☐: it moves to **Done**. Tick again
  to reopen.
- [ ] A **daily** task, ticked in the evening, moves to **tomorrow** (not the day after).
- [ ] New note → **✅ Task** opens the task form. Edit on a task opens the same form.
- [ ] Type "my wifi password is Sunflower882" as a task: it is **not saved** and says to use the
  Vault.

## ＋ Add in My day

- [ ] My day (Today) → **＋ Add** → "Pick up dry cleaning", 20, a saved place → **Find a time**.
  Up to three suggestions: **On the way to …** (with "Leave at … instead of …") or **In free
  time**. Pick one: "✓ … at …" shows, and the task appears in the timeline at that time.
- [ ] ＋ Add again → Find a time → **Not today**: the task moves to tomorrow (Tasks shows it).
- [ ] A task under **Not placed yet** has **Find a time** too.

## In the chat

- [ ] In an empty chat, tap **🌅 Plan my day**. Wilma answers with leave-by times and rain, and an
  **Open my day** card under her answer opens the same day.
- [ ] Ask "when should I leave for <tomorrow's address event>?": a short answer with the
  leave-by time.
- [ ] Tell Wilma "my home is <your address>": she updates your Home (no second Home place).

## Not Pro (the Play review account, or ask Claude to set an account to free)

- [ ] The tiles show **PRO** on 🌅 My day; tapping opens "🌅 My day is part of Pro" with Not now /
  See Pro ("Pro is coming…"). Tasks have no badge and work.

## Report back

Tell Claude what worked and what didn't (a screenshot helps). Claude checks the `chat` logs:
`drive_requests` above 0 with `drive_failures` and `weather_failures` 0.
