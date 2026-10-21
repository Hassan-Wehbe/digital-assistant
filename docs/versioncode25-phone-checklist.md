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

## Ages (D44)

You need: an invite code for a test sign-up (in the SQL editor: `select create_invite_code('age
test', 2, 7, 'free');`, never in chat) and an email you can open.

- [ ] (15) The privacy page says the month and year of birth are asked once and **not kept**
  (published when this PR is merged).
- [ ] (16) Your own account: Home shows **🎂 What’s your month and year of birth?** Not now hides it;
  reopen the app and it is back. Answer it: the card goes; Settings → Account → **Age-limited parts**
  says "Cocktails: yes (21 or over). Wrong? Contact us." Answering again is not offered.
- [ ] (17) 21 or over: Home says 🍸 **Make a cocktail**, with Strength; the drinks space is
  🍸 **Cocktails**.
- [ ] (18) Create account: **Month and year of birth** (month chips, year box) and "I agree to the
  Privacy policy and Testing terms" (no 18+ box). A year in the future: "Please enter a real month
  and year of birth." A birth year that makes you 15: the server says "Wilma is for people 18 and
  over." and no email comes.
- [ ] (19) A test account aged 19 (sign up with a birth year 19 years ago and a test email): after
  confirming, the drinks space is 🍹 **Mocktails**; Home says 🍹 **Make a mocktail**, with no
  Strength; Settings → Account says "Cocktails from <month and year>; mocktails until then."
- [ ] (20) As the 19-year-old: New note in Mocktails: Strength shows only **No alcohol**, already
  picked. In the chat, "What cocktail can I make with vodka and lime?" gives mocktails and one line
  that cocktails are for 21 and over; never a recipe with alcohol.
- [ ] (21) Supabase dashboard → Authentication → Users → the test account: its metadata has **no**
  birth_month or birth_year. Then delete the test account (Settings → Delete account).

