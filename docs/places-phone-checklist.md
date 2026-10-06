# Phone checklist: places, Save where I am, and the mic fix (places step 6)

For the owner, on the places build (**versionCode 10**), built 2026-10-06 from `main` at 537fff2
(GitHub run 37540216475). It carries places steps 3, 4 and 5a (#97, #100, #101), the Expo patch updates (#98) and
the mic fix (#91). About 20 minutes, with your own account, standing somewhere you don't mind
saving as a test place. **Never say or type a real password or door code**: use the made-up
ones below. *Restaurants* stands for one of your spaces.

## Update and start

- [ ] Update Wilma from Play (internal testing). The app **starts without a crash**.
- [ ] Settings > Apps > Wilma > Permissions: **Location** is not allowed yet (nothing asked at
  start-up). Microphone is as you left it.

## The mic (fix #91; from the A5e checklist)

- [ ] Home screen, tap **🎤**: if the microphone is already allowed, it **listens at once** (red
  button with ■). No permission screen flashes up, and it doesn't stop by itself.
- [ ] Tap ■, then 🎤 again: it listens again (the second and later taps work too).
- [ ] Say "what did I save about the roof": the words appear in the box and stay. **Nothing is
  sent** until you tap Send.
- [ ] Tap 🎤, then press the phone's Home button: listening stops. Back in Wilma, the words heard
  so far are still in the box.

## A new place (step 3)

- [ ] **New note**: a **Note / 📍 Place** choice. Pick Place: name, address, Google Maps link,
  kind, cuisine, price, dishes, occasions, want to go / been there.
- [ ] Save "Test Café" in *Restaurants* as a café, want to go, cuisine "coffee", with an address
  and no link. The note view shows the place and **Open in Maps**. It opens Google Maps on that
  address.
- [ ] **Edit note**: switch to **Been there**, rating 4, "would go back". Save: the note shows it,
  and the list shows "Cafe · coffee · Been there ★4" or similar.
- [ ] In the place form, paste `https://example.com/maps` as the link: **refused** (only Google
  Maps links). A real Google Maps link is accepted and Open in Maps uses it.
- [ ] **We went again** on the place, with today's date and a name: the visit shows, newest first.
- [ ] Edit an ordinary note, choose **Make this a place**: it becomes a place and keeps its text.

## Share from Google Maps (step 4)

- [ ] In Google Maps, open any place, **Share**, pick Wilma: the share screen opens as a **Place**
  with the name and the link filled in. Save it; Open in Maps opens that place.

## Save where I am (step 5a)

- [ ] Home screen, tap **📍 Save where I am**: Android asks for location **now**, and only now.
  Allow it (while using the app). New note opens as a Place with **your current location** set.
  Name it "Test spot", save.
- [ ] Tap 📍 Save where I am again: **no question this time**. The location is read again.
- [ ] Open "Test spot": **Open in Maps** (no link saved) opens Google Maps at that point.
- [ ] In a place's form, **Use where I am now** sets the location, **Remove the location** clears
  it.
- [ ] Settings > Apps > Wilma > Permissions > Location > **Don't allow**. Tap 📍: it asks again, or
  a plain sentence says how to allow it; nothing breaks.
- [ ] Turn the phone's location off (quick settings), tap 📍: a plain sentence says location is
  off. Turn it back on afterwards.
- [ ] Settings > Apps > Wilma > Permissions > Location: only **while using the app** is offered,
  never "all the time".

## Places near a point (step 5b, server, already live)

- [ ] In the chat: "which of my places are near Test spot?". Wilma lists saved places **with a
  location**, nearest first, as "about N km". She never gives a travel time.
- [ ] "What restaurants are near me?": Wilma **asks** which saved place you're near (the chat
  can't see your location yet; that is step 7). She doesn't invent a distance.
- [ ] Ask how far a place **without** a location is (e.g. "Test Café"): no distance; she says it has
  no saved location.

## Secrets stay out (rule 9)

- [ ] On a place, type the note `the door code is 4821` and Save: **refused**, pointing to the
  Vault. The place is unchanged.
- [ ] Vault screens, sign-in, Change sign-in password: still **no 🎤**.

## Clean up

- [ ] Delete "Test Café", "Test spot" and any shared test place (they go to the recycle bin; empty
  it if you like).

## Report back

Tell me which lines failed, what you did and what you saw. These are stop-ships:

- a message sent without tapping Send;
- the location asked at start-up or "all the time";
- a place or password saved where it shouldn't be;
- Wilma giving a distance for a place without a location.
