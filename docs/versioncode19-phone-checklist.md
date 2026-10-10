# Phone checklist for versionCode 19: morning briefing, theme and automatic memory

For the owner, on the Play build after versionCode 17 (versionCode 18 was never built: Expo's free
Android builds ran out). It carries:

- the **morning briefing and leave-by alerts** (day planner step 4): use
  `docs/versioncode18-phone-checklist.md` for those, unchanged;
- **Settings → Theme** (#199);
- **automatic memory** (`docs/memory-plan.md` steps 1-5): Settings → Memory, the Home card,
  "🧠 Remembered · Undo" in the chat, the Memories space, and Wilma using what she remembered.

The server parts are already live (`mcp` v32, `chat` v29). About 20 minutes for theme and memory.

## Before you start

- [ ] The privacy page shows "Memory (optional, off unless you turn it on)" (published when the
  step 5 PR is merged).
- [ ] Play Console: **no Data safety change** for this release (memories are notes, already
  declared as "Other user-generated content"; `docs/phase4-play-release.md`).

## Update and start

- [ ] Update Wilma from Play (internal testing). It **starts without a crash**, in the same colours
  as before (Theme starts as "Same as the phone").
- [ ] Home shows the **🧠 Let Wilma remember** card (memory is off until you turn it on).

## Theme

- [ ] Settings → **Theme → Dark**: the whole app turns dark at once (top bar, status bar, lists).
- [ ] **Light**: light at once, even if the phone is in dark mode.
- [ ] Close Wilma fully and open it again: it opens **in the chosen theme**, with no flash of the
  other one.
- [ ] **Same as the phone**: follows the phone's dark mode again (change it in the phone's
  settings to check).

## Built-in spaces

- [ ] Home → See all spaces: **✅ Tasks** and **🧠 Memories** each show a **BUILT-IN** badge.
- [ ] Open 🧠 Memories: the badge and "What Wilma remembered about you…"; **no Delete space** button.
- [ ] Memories → Edit: **no Name field**, the line "Built-in space: it can't be deleted or renamed.";
  the description can still be changed and saved.
- [ ] Ask Wilma "delete the Memories space": she says it is a built-in space and cannot be deleted.

## Turning memory on

- [ ] On the Home card, tap **Not now**: the card goes, and does not come back after restarting.
- [ ] Settings → **Memory**: shows **Off** ticked. Tap **On**: it stays ticked after leaving and
  coming back.
- [ ] (Second test account, or after Not now was not tapped) the Home card's **Turn on** does the same,
  and the card goes.

## Remembering

- [ ] In the chat: "Lexi swims on Tuesdays at 5pm". After Wilma's reply, within a few seconds, a
  small line **🧠 Remembered: …Lexi swims on Tuesdays…** with **· Undo**.
- [ ] Tap **Undo**: the line says **Forgotten: …**; the memory is in the Recycle bin.
- [ ] Say it again: remembered again. Then "Lexi swims on Wednesdays now": **🧠 Updated: …**; Undo
  says **Back to: …Tuesdays…**.
- [ ] Settings → Memory → **See what I remembered**: the Memories space lists what is kept; open one,
  edit it, delete one.
- [ ] Close the chat and open it again: the Remembered lines are still under their replies.

## Never remembered (each in a new message; nothing should appear under the reply)

- [ ] "the wifi at my mom's is sunflower22, she never changes it" (Wilma should point you to the
  vault instead; never a Remembered line).
- [ ] "ugh, my migraines are back" (health, not asked to keep).
- [ ] "remember that I'm allergic to shellfish": **is** remembered (you asked).
- [ ] Ask about a restricted space by name: no Remembered line.

## Wilma uses them

- [ ] New conversation (so the chat holds no earlier message): "What time is Lexi's swim?": Wilma
  answers from memory.
- [ ] "Thinking of shrimp scampi tonight, good idea?": she brings up the shellfish allergy.
- [ ] Settings → Memory → **Off**, new conversation, "What time is Lexi's swim?": she no longer knows it
  from memory (she may still find the note by searching your notes; that is fine).

## Report back

Note anything that looked wrong (what you tapped, what you saw, the time). Never paste a password,
code or key.
