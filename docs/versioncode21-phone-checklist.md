# Phone checklist for the build after versionCode 20 (most likely versionCode 21)

For the owner, on the Play build after versionCode 20 (Expo numbers it; it should be 21). It carries:

- **the cleaner Home and favourite spaces** (D38, `docs/home-cleanup-plan.md` steps 1-2, #222, #223);
- **links shared from social apps** (D41, #228) and **the cold-start share fix** (#229);
- **routines** (D39, `docs/routines-plan.md` steps 3a, 3b and 4, #230, #231, #232): My day's
  🔁 From your routines, Tasks → 🔁 Routines, the routine screen, and the chat's 🔁 card;
- a **Help** line about routines (step 5).

The server parts are already live: `space_favourite` and `task_not_today` (migrations applied
2026-10-18 and 2026-10-19), `mcp` and `chat` with routines (step 1), `chat` with the planner's
suggestions (step 2) and the 🔁 card (step 4). About an hour in all. **Pro** is needed for My day.

## Before you start

- [ ] The privacy page says, under What Wilma stores, that **routines** are saved like notes, and
  that **favourite spaces** and **"Not today"** marks (a task and a date, dropped after a few days)
  are kept with your account (published when the step 5 PR is merged).
- [ ] Play Console: **no Data safety change** for this build: routines and tasks are the same
  user content as notes; favourites and Not today marks are app settings kept with the account, not
  shared, deleted with it.

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**.

## Home and spaces (D38)

- [ ] Home: four tiles (Chat, My day, Tasks, Vault); ＋ has **📍 Save where I am**, and it asks for
  the location only then.
- [ ] **Plan with Wilma**: My day opens My day (the Pro card on Free); Date night, Family day and
  Vacation each show their one line ("soon").
- [ ] No favourites yet: Spaces shows up to 6 recent ones in a grid.
- [ ] Open a space, tap **☆**: it turns ★; back on Home the header says Favourites and shows it.
- [ ] All spaces → **Edit**: move one up and down, remove one, add one from the chips; a seventh
  says "at most 6". Tasks and anything under a locked space cannot be added; locked spaces stay at
  the bottom.
- [ ] A restricted space never appears on Home, recent or favourite; nor does a space inside one.
- [ ] Sign out and in again: the favourites are still there.

## Sharing links (D41, the cold start)

- [ ] **Swipe Wilma closed.** In YouTube, Share a video → Wilma: the **Share screen opens** with the
  link in a new note, titled "Link from YouTube", the note saying "From YouTube". (This is the bug
  you found: it used to open nothing when Wilma was closed.)
- [ ] **Get title from the link**: the video's real title fills in. Pick a space, Save; it's there.
- [ ] Same from **Facebook** and from **Chrome**, once with Wilma closed and once with it open.
- [ ] Your favourite spaces are first in the Share screen's space list.
- [ ] Share the same link twice in a row: one Share screen each time, never two notes from one share.
- [ ] **If the cold start still opens nothing:** note which app you shared from. The next fix is
  in the share library's Android code (`docs/handoff.md`, share cold start).

## Routines: Tasks → 🔁 Routines (D39)

- [ ] Tasks has two tabs, **To do** and **🔁 Routines**. Routines says "No routines yet …".
- [ ] **＋ New routine**: name "Weekend reset"; Weekly; **Same day each time**, Sat; tasks
  "Laundry", "Vacuum" (30), "Groceries" (60); Suggest in My day on. The line under When says
  "Every Saturday". Save.
- [ ] Routines shows **🔁 Weekend reset**, "Every Saturday · 0 of 3 done for Saturday, Oct …", and
  the three tasks with ☐.
- [ ] Tick **Laundry**: it shows ☑ and the count says 1 of 3. In To do it has moved to next week.
- [ ] **Edit**: rename Groceries to "Groceries and pharmacy", take out Vacuum (✕), add "Mop". Save.
  Vacuum is in the Recycle bin; the list shows the new names.
- [ ] Change it to **Monthly**, **By a day of the month**, 28. The line says "By the 28th each month";
  after saving, its tasks' dates follow (open one: due by the 28th).
- [ ] A task named **"Wi-Fi password is hunter2"**: refused on the phone, nothing sent.
- [ ] **Delete routine**: asked first; then the routine and its tasks are in the Recycle bin.
  Restore the routine: its tasks come back with it.
- [ ] A task that repeats on its own (not in a routine) is listed under **Repeating on their own**.

## Routines in My day (Pro)

Make a routine with **Any day that week** and two or three tasks for this.

- [ ] My day for **today**: **🔁 From your routines** above the plan, each task with its routine,
  "about 30 min" when it has no minutes, **Add h:mm** and **✕**.
- [ ] **Add** one: it goes into the plan at that time; the box offers the next one if there was
  "1 more waiting".
- [ ] **✕** one: it leaves the box for today. **Close and reopen My day**: still gone. On a second
  phone or the web, same account: gone there too. **Tomorrow**: it's offered again.
- [ ] **Add all** with two or more: all go into the plan, at different times.
- [ ] A routine task with a **place**: the box offers **Find a time** instead of a time.
- [ ] Under **Not placed yet**, a routine task shows its routine's name and never "overdue"; one
  that's in the box isn't listed twice.
- [ ] Turn **Suggest in My day** off on that routine: its tasks are no longer offered.
- [ ] **Your morning** (briefing on): its summary ends "N routine tasks fit today." and names none.

## Routines in the chat

- [ ] "Make my Saturday chores a weekly routine: laundry, vacuuming and groceries": a **🔁 card**
  "Save the routine …", "Every Saturday · 3 tasks", the tasks. **Nothing in Routines yet.** Wilma
  doesn't say it's saved.
- [ ] Leave the chat and come back: the card still waits. Tap **Save routine**: it says Saved, with
  **Open**, which opens the routine. Routines lists it.
- [ ] "Add mop the floors to my weekend routine": the task appears in that routine (no card needed;
  tasks are saved from the chat as before).
- [ ] "What's left in my routines this week?": Wilma lists the ones not done yet, none "overdue".
- [ ] "Make a weekly routine: back up the laptop; the router password is Tr0ub4dor&3": no card holds
  the password; Wilma points to the Vault.

## Help

- [ ] **?** → My day: the fourth line is about routines; **Try it** "Make my Saturday chores a
  weekly routine…" puts the words in the chat box, not sent.

## When done

- [ ] Tell Claude what failed (with the step), or "all passed". Then: production build for Play
  testers, if you want them to have it.
