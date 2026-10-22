# Phone checklist for the build after versionCode 24 (most likely versionCode 25)

For the owner, on the Play build after versionCode 24. It carries **daily routines** (D39 addition,
`docs/routines-plan.md` "Daily routines", steps 1-2) and **ages** (D44, `docs/age-plan.md` steps 2-3:
the month and year of birth, mocktails under 21).

**Before you install it:** the server part goes out with this build, not before: with your OK, apply
migration `20261024120000` (after its dry run) and deploy `mcp` and `chat` (they carry the drinks
rules, ages step 2, #262; daily routines step 1, #265; and the 30-second suggestion limit, #263).
An app older than this build ignores daily routines on its Routines tab. About 15 minutes. Do
versionCode 24's checklist first if you haven't. The My day checks need **Pro**.

## New routine (the editor)

- [ ] (1) Tasks → 🔁 Routines → New routine: **Repeats** starts with **Daily**. Tap it: **When** shows
  **Every day** and **Weekdays (Mon–Fri)**, and a time box.
- [ ] (2) Name "Morning", Every day, time **7:30 am**, tasks Make bed (5), Vitamins (5), Stretch (no
  minutes). The line under it says "Every day at 7:30 am. My day offers it as one line…". Save.
- [ ] (3) The Routines tab shows Morning, **Every day at 7:30 am**, "Today: 0 of 3", and no
  "Missed" line.
- [ ] (4) Open it again: the time shows **7:30 am**. Type "soon" in the time: Save says "At what
  time? Like 7:30 am or 19:00". Change it back and switch to **Weekdays**: saved, it reads "Every
  weekday at 7:30 am".
- [ ] (5) Switch Repeats to Weekly and back to Daily: nothing breaks; Weekly has no time box.

## My day

- [ ] (6) My day for **tomorrow** (a weekday): "From your routines" shows **one line, Morning**,
  with "Make bed, Vitamins, Stretch · about 40 min" and **Add 7:30 am** (or the next free time, if
  your calendar has something at 7:30). The three tasks are not also listed under "Not placed yet".
- [ ] (7) **Add**: the three tasks land in the plan one after another from that time
  (7:30, 7:35, 7:40), and "✓ Morning at 7:30 am" shows.
- [ ] (8) Another day: **✕** on the Morning line hides all three for that day only; the next day
  shows it again.
- [ ] (9) Tick all three done today: the Routines tab says **Done for today**; tomorrow it is back
  to "Today: 0 of 3".
- [ ] (10) Your morning (Home → Your morning): the routine line counts the Morning tasks
  ("3 routine tasks fit today").
- [ ] (11) A Saturday with the routine on **Weekdays**: no Morning line; the Routines tab says
  "0 of 3 done for Monday, …". On **Every day**, Saturday shows it.

## The chat

- [ ] (12) "I want to check my email every day, weekends too, at 8 in the morning. Make it a
  routine." → a 🔁 Save routine card: "Every day at 8:00 am · 1 task". Tap Save routine; it shows
  in Routines.
- [ ] (13) "Plan my day for tomorrow" mentions the email routine (and Morning) at their times,
  never as overdue.
- [ ] (14) Help → My day: "daily, weekly or monthly tasks offered in free time"; the Try it "A
  morning routine every day at 7:30: make bed, vitamins" makes a card.

## Ages (D44): switched off on 2026-10-22

The age part is switched off (`docs/age-plan.md`, "Switched off"), so skip the old checks 15-21.
Once migration `20261025120000` is applied, in versionCode 25:

- [ ] (15) Home shows **no** 🎂 question; Home says 🍸 **Make a cocktail**, with Strength; the drinks
  space is 🍸 **Cocktails**.
- [ ] (16) Settings → Account still shows an "Age-limited parts" line saying "Cocktails: yes (21 or
  over)" in this build (it is gone in the next build); nothing to do.
- [ ] (17) Create account in this build still asks the month and year (the next build is back to the
  18+ box); a birth year making you 17 is refused with "Wilma is for people 18 and over."
