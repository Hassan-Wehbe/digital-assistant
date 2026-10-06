# Phone checklist: the classifier's notes card and the Search link removal (next Play build)

For the owner, on the first Play build after 2026-10-05 that carries #70 and the step 6 app PR
(versionCode 7 or later). About 10 minutes, with your own account. Never type a real password.
Below, *lasagna* stands for a word from one of your notes, and *Recipes* for one of your spaces.

## The home screen

- [ ] **No Search link.** Under the box there is only **Conversation**.
- [ ] **A space or a secret by name** still works as before (`recipes` opens it; `bank` shows the
  vault card), with no "One moment…" wait.

## A short search (the classifier)

- [ ] Type two or three words from a note's title (`lasagna recipe`) and Send: "One moment…"
  shows briefly, then the conversation opens with *Notes for "lasagna": …* and a card listing up
  to five notes. No Wilma answer.
- [ ] Tap a note in the card: the note opens.
- [ ] Back in the conversation, tap **Ask Wilma instead**: the same message goes to Wilma, who
  answers as usual. The button is gone once anything newer is in the conversation.
- [ ] Words that match no note (`zebra umbrella`): Wilma answers, as before.
- [ ] `hello`, `remind me tomorrow`: Wilma answers (no notes card).
- [ ] `gmail password`, `bank pin` (no secret with those exact names): Wilma answers, never a
  notes card.
- [ ] **A restricted space:** its exact name behaves like a word that is not there (Wilma, or
  notes from other spaces), and no note from it ever shows in a card.

## Editing a note (if this build carries it)

- [ ] Open a note, tap **Edit note**, change the title and the text, **Save**: the note shows the
  new title and text, and "1 earlier version(s)" (or one more than before) under it.
- [ ] Edit a note and type `the wifi password is Sunflower2024!` into the text, **Save**: it is
  refused with "This looks like it holds a password…", and the note is unchanged.
- [ ] **Cancel** leaves the note as it was.

## Allowance used up (optional)

Set your `ai_monthly_limit_cents` to `0` as in the A5d checklist, then:

- [ ] `lasagna recipe` on the home screen: the "used up" message and your notes for it under the
  box (the old note search; the classifier is not asked). Put the limit back afterwards.
- [ ] In the conversation, the error's **Search** button lists notes for your last question.

## Report back

Which lines failed, with what you typed and saw. A notes card showing a note from a restricted
space, or any password in a card, is a stop-ship.
