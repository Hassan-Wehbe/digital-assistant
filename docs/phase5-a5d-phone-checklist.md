# A5d phone checklist (the one box), plus the layout re-checks

For the owner, on a phone with the Play build that carries A5d (the first build after
2026-10-05). About 15 minutes. Use your own account: the box only reads names, and the vault
still asks for your fingerprint. Never type a real password into the box or the chat.

Before you start, note the exact names of two of your spaces (one nested, e.g. "Work/Gartner")
and two of your vault secrets. Below, *Recipes*, *Gartner*, *Bank login* and *Wi-Fi* stand for
yours.

## The one box (home screen)

- [ ] **Looks right.** The home screen shows the box ("Ask Wilma, or type a name") with **Send**,
  and under it two small links, **Search** and **Conversation**. The old **Ask Wilma** button and
  the old search field are gone.
- [ ] **A space by name.** Type `recipes` and Send: the Recipes space opens at once (no waiting
  for Wilma). Back on home, try `open the gartner space`: Gartner opens.
- [ ] **A secret by name.** Type `bank` (or the main word of a secret's name) and Send: the
  conversation opens with the line *Here is "Bank login" in your vault.* and a vault card. **No
  value in the chat.** Tap the card: the fingerprint screen, then the value, outside the chat.
- [ ] **A question with a secret's name.** `what's my wifi password` (if a secret is named
  Wi-Fi): the same card, straight away.
- [ ] **A typo.** One letter off in a name of 6+ letters (`recipez`): it still opens.
- [ ] **Not a name: goes to Wilma.** `how many recipes do I have` and `bank of montreal` (a part
  of a longer name): the conversation opens and Wilma answers as before.
- [ ] **Two of the same name.** If two things share a name, typing it goes to Wilma (she asks
  which). Skip if you have none.
- [ ] **A restricted space.** If you have one, type its exact name: it goes to Wilma, and nothing
  on the screen hints that the space exists.
- [ ] **Search link.** Type a word from a note and tap **Search**: the old results list shows,
  with no Wilma answer. Clearing the box brings the spaces back.
- [ ] **Conversation link.** Tap **Conversation**: the thread opens without sending anything.
- [ ] **The chat screen's own box** behaves the same: a space name there opens the space, a
  secret's name adds a card.

## Allowance used up (optional, 2 minutes)

In Supabase: Table editor → `app_user` → your row → `ai_monthly_limit_cents` = `0` (note what
was there). Then in the app:

- [ ] The first message for Wilma (`hello`) opens the conversation with the "used up" message
  (the app learns it from the server). Go back home and send `hello` again: this time it is **not
  sent**, the box keeps the text and the "used up" message shows under it.
- [ ] A secret's name still shows its card, and a space's name still opens the space.
- [ ] Put your limit back (empty = the default), fully close and reopen the app: `hello` works
  again.

## Offline

- [ ] **Airplane mode,** type a space's name and Send: the conversation opens with the usual
  "can't reach Wilma" message (lookups need the server for names). Airplane mode off, **Try
  again** works once.

## Layout re-checks (#60, #61, first device check)

- [ ] **Chat:** the message box stays above the keyboard and above Android's three-button bar.
- [ ] **New note:** with the keyboard open, the **Save** button can be reached.
- [ ] **A form field near the bottom** (e.g. a long new note): stays visible while typing.
- [ ] **Home:** the one box is not covered by the keyboard.
- [ ] **Vault, edit a secret:** the fields are visible while typing.

## Report back

Tell me which lines failed, with what you did and saw (hide anything private in screenshots).
A secret value anywhere in the chat, or a restricted space showing up, is a stop-ship.
