# Phone checklist for versionCode 18: morning briefing and leave-by alerts

For the owner, on the Play build after versionCode 17. It carries the day planner's step 4
(`docs/phase6-day-planner-step4-plan.md`): Settings → Morning briefing, leave-by alerts from My
day, the morning notification with the day's summary, and 🌅 Your morning on Home. App only: no
server change. About 30 minutes over an evening and the next morning. Your account is Pro.

## Before you start

- [ ] The privacy page shows "Morning briefing and leave-by alerts" (published when the step 4 PR is
  merged).
- [ ] Play Console: **no Data safety change** for this release (nothing new leaves the phone).
- [ ] Settings → Calendars is on, and tomorrow's calendar has an event with a **street address** (so
  My day has a drive with a leave-by time).

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**.
- [ ] Android does **not** ask about notifications on start (only when a setting needs it).
- [ ] Home has **no Your morning card** (the briefing is off until you turn it on).

## Settings → Morning briefing

- [ ] Settings shows **Morning briefing: Off**. Tap it.
- [ ] Choose **In Wilma only**. Android does **not** ask about notifications. A **Briefing time** row
  appears (7:00 am).
- [ ] Choose **In Wilma and as a notification**. Android asks to allow notifications: **Allow**.
- [ ] Set **Briefing time** to a few minutes from now (to test today), with the phone's clock.
- [ ] **Leave-by alerts → On**, then **Alert me → 10 minutes before**.
- [ ] Back in Settings, the line reads e.g. "At 7:00 am, with a notification; leave-by alerts 10 min
  before".

## Leave-by alerts (evening)

- [ ] Open 🌅 My day → **Tomorrow**. The drive shows **🚗 Leave for …** with a time.
- [ ] (To see one tonight) make a test event an hour from now with a street address, open My day →
  Today: about **10 minutes before its leave-by time**, a notification "Leave by … for …" with the
  drive minutes. It may come a few minutes late if the phone is asleep. Tap it: **My day** opens.
- [ ] A **private** calendar event's alert says "for Busy", never its title.

## Morning (next day)

- [ ] Before bed, with My day → Tomorrow opened, the briefing time set back to your morning time.
- [ ] At the briefing time: a notification **Your day — From yesterday's plan: …** (what's on, the
  first leave-by time, rain if likely). Tap it: My day opens.
- [ ] Open Wilma's Home: **🌅 Your morning** shows today's summary, freshly made. **Open My day ›**
  works; **Hide for today** hides it until tomorrow.
- [ ] Pull down on Home: the card is made again (still there unless hidden).
- [ ] Close Wilma fully and open it again: the card says **Made earlier today** with **Show it
  again** (it does not ask for a new plan by itself).

## Turning things off

- [ ] Morning briefing → **Off**: no card on Home, and no morning notification the next day.
- [ ] Leave-by alerts → **Off**: no more leave-by notifications.
- [ ] Phone Settings → Apps → Wilma → Notifications **off**, then Settings → Morning briefing says
  notifications are off, with **Open phone settings**. Turn them back on.

## Sign out

- [ ] With alerts scheduled, **Sign out**, then sign back in: no notification from before the
  sign-out arrives.

## Report back

Note anything that looked wrong (what you tapped, what you saw, the time). Never paste a password,
code or key.
