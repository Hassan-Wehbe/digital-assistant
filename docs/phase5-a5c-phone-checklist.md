# A5c phone checklist (chat screen)

For the owner, on a phone with the Play build (or the browser preview, `npm run web:preview`;
the fingerprint part only works on the phone). About 20 minutes. Use a test account or a test
space so nothing real is lost. Tick each line; note anything odd (what you did, what you saw).
Never type a real password into the chat with Wilma.

Start: sign in, open **Ask Wilma** from the home screen, tap **New conversation** if the thread
is not empty.

## Answers

- [ ] **Long streamed answer.** Ask for something long ("Explain how to cook rice, in detail,
  with 10 steps"). Text appears bit by bit, a status line shows while Wilma works, the screen
  follows the new text, and the answer ends cleanly.
- [ ] **Stop.** Ask for another long answer and tap **Stop** midway. Writing stops at once, what
  was written stays, and you can send a new message straight away.
- [ ] **A save.** "Save a note called Test A5c: the sky is blue". A reply confirms it. Check
  the note exists in the app's other screens.

## Delete cards

- [ ] **Delete.** "Delete the note Test A5c". A **card** appears with **Delete** and **Cancel**,
  and the note is still there. Tap **Delete**: the card shows it is done, Wilma replies, and the
  note is now in the recycle bin. Tapping twice quickly must not run it twice.
- [ ] **Cancel.** Save a note again, ask to delete it, tap **Cancel**. The card shows "Not
  done", Wilma replies, and the note is untouched.
- [ ] **Non-empty space.** Ask to delete a space that contains notes. Tap **Delete**: it must
  **fail with a clear message, the space and its notes must be unchanged, and the card keeps its
  buttons** (so you can Cancel).
- [ ] **Ignored card.** Ask for a delete, then do not tap; send a different message. The old
  card turns to "Not done" and nothing is deleted.

## Vault cards

- [ ] **Reveal.** Ask to see a password you saved in the vault (e.g. "show my test login"). A
  vault card appears; **no secret value is in the chat**. Tap it: the fingerprint / passphrase
  screen opens, and after unlocking you see the value there, outside the chat.
- [ ] **Enter the value, existing secret.** Ask to change the value of an existing secret. The
  card's **Enter the value** opens that secret's edit screen.
- [ ] **Enter the value, new secret.** Ask to store a new password ("store my test wifi
  password"). Wilma refuses to take the value in chat; the card's **Enter the value** opens the
  new-secret screen with the name filled in.
- [ ] **Look back through the thread:** no password, link or secret value appears anywhere.

## Failures and restarts

- [ ] **Airplane mode.** Turn on airplane mode, send a message. A plain "can't reach Wilma"
  message appears with **Try again**. Turn airplane mode off, tap **Try again**: the answer
  arrives once (not twice).
- [ ] **Close and reopen.** Ask for a delete so a card is pending, then fully close the app
  (swipe away) and reopen it. The thread is back and the card is **still pending** with working
  buttons. Cancel it.
- [ ] **Sign out and back in.** Sign out, sign in again (same account), open Ask Wilma: the
  thread is **empty**. (If you sign in with a second account, it must not see the first's.)
- [ ] **Very long thread.** Send 15-20 short messages ("say hi"). Scrolling stays smooth, sending
  still works, and after closing and reopening the app the recent messages are still there.

## Report back

Tell me which lines failed, with what you did and saw (a screenshot helps, but hide anything
private). Any failure on the delete or vault lines is a stop-ship: do not build for Play until
it is fixed.
