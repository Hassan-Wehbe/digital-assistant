# UI review: home screen and chat (2026-10-07)

The owner finds the home screen and the chat "very clunky and all over the place". This is a
design review: what feels clunky today, two or three layouts for each screen, a recommendation
and a plan of small app-only PRs. **Decided 2026-10-07 (owner): Home A2 with ＋ and
the usage counter, the password check on the phone (and in the `chat` function), and the chat
sliding up from the bottom. Build next: the plan in section 3.** Nothing is built yet.

**Mockups (light and dark, phone width):** https://claude.ai/artifact/PgrfNQnowFu3w5M4mHYQQA
(private to the owner; source: `docs/ui-review-mockups.html`).

Based on reading the code (`app/src/app/index.tsx`, `chat.tsx`, `components/ui.tsx`,
`ChatBubble.tsx`, `ChatCards.tsx`, `rows.tsx`, `UsageMeter.tsx`, `MicButton.tsx`). There are no
screenshots: the browser preview needs the owner's own sign-in.

What every option keeps: the one box first (D18), the Vault reachable from home, the "never type
or say passwords here" guidance, the usage meter (D28), the 📍 buttons with the location read
only on a tap (places Q9/Q10), restricted spaces never opened or searched (rule 3), and vault
cards that never use the server's link.

## 1. What feels clunky today

### Home (`app/src/app/index.tsx`)

1. **Three styles for the same kind of action.** "Conversation" is a text link (`link()`,
   line 125); "New note or photo" and "📍 Save where I am" are full-width outlined buttons
   (lines 126-127); "+ New space" is a text link again (line 134). Nothing tells you which
   matters more.
2. **Settings are mixed into the home screen.** The footer (lines 142-152) has the meter,
   "Signed in as", four full-width `plain` buttons of equal weight (Vault, Recycle bin, Change
   sign-in password, Sign out) and the version. The Vault, used often, looks exactly like Sign out.
3. **The usage meter moves.** It appears under the box from 80% (line 124) and in the footer
   otherwise (line 144).
4. **Spaces are tall cards** (`SpaceRow` in `rows.tsx` is a `Card` with padding 16 and gap 8),
   so a handful of spaces fills the screen and the footer is far down.
5. **A restricted space repeats a long sentence** ("Restricted space. Opening restricted spaces
   in the app comes later.") every time it is listed (`rows.tsx`, line 17).
6. **Spacing is uneven.** Header gap 12, footer gap 8 plus marginTop 16, list gap 12. Grey lines
   under the box (mic warning, mic error, held message, "One moment…", meter) come and go and move
   everything below them.
7. **The password reminder on home shows only while dictating** (line 120). The chat shows it
   all the time. This is defensible but inconsistent (see U7).

### Chat (`app/src/app/chat.tsx`, `ChatBubble.tsx`, `ChatCards.tsx`)

1. **The box is squeezed.** 📍 and 🎤 are outlined buttons with padding 12, and Send has padding
   16 (lines 319-335; `MicButton.tsx`). On a 360-pt phone the text field gets about half the width.
2. **Up to four grey lines stack under the box** (lines 339-343): mic error, "Finding where you
   are…" / pin error / the long `PIN_ON` sentence, the used-up message, and the password reminder.
   They push the thread up and read as noise, which weakens the one line that matters (passwords).
3. **Cards and bubbles don't match.** Bubbles have radius 16 and padding 12; `Card` has radius 12
   and padding 16. Card buttons are full width and stacked, so a delete card takes three rows for
   Delete and Cancel, and error cards stack Search / Vault / Try again.
4. **Each card kind looks different.** Notes cards use accent-coloured titles. The vault card
   starts its text with 🔒. Finished delete cards are a whole card holding one grey line. Places
   step 8 will add place cards and a "📍 Share where I am" card; without a shared shell that makes
   five styles.
5. **"New" in the header** doesn't say it clears the conversation.
6. **Allowance shown twice.** The dismissible banner (lines 262-269) and the used-up line under
   the box can be on screen together.

### Shared look (`components/ui.tsx`)

- Only one `Button` with three kinds, and all of them are full-width blocks. There is no small
  icon button (the 📍 button re-implements one inline in `chat.tsx`), no text link (home defines
  its own `link()`), and no grouped list. Each screen improvises, and that is the root of
  "all over the place".
- No spacing scale. Gaps of 2, 6, 8, 10, 12 and 16 appear without a rule.

## 2. Alternatives

### Home

| | What moves where | What it fixes | Cost |
|---|---|---|---|
| **A. Tidy home + Settings screen** (recommended) | Box (🎤, round ↑ Send) → one row of four equal tiles: 💬 Chat, ＋ New note, 📍 Save here, 🔒 Vault → Spaces as one grouped list (thin dividers, restricted = one dimmed line). Footer moves to a new **Settings** screen behind ⚙ in the header: meter, signed in as, change password, recycle bin, sign out, version (later: miles/km from places Q14, delete account from D29) | One style per kind of action; clear order (ask, act, browse); Vault easier to reach than today; meter has one home (still under the box from 80%) | Small: 3 PRs, no new library, no server change |
| **B. Bottom tab bar** | Tabs: Home, Chat, Spaces, Vault. Home = box, New note, Save where I am, a new "Recent" list. Settings behind ⚙ | Familiar phone pattern; Chat and Vault one tap from anywhere | Medium-large: screens move into an expo-router tabs group; back behaviour, share intake (`router.navigate('/share')`) and the chat's Search (`dismissTo('/')`) need re-testing; "Recent" is new; two places to type (home box and chat tab). About 5 PRs and a full phone checklist |
| **C. The chat is home** | App opens in the conversation; Spaces, Recycle bin and Settings in a side menu; 🔒 Vault in the header; New note / Save where I am as tiles in the empty thread | One box everywhere, the purest form of D18 | Large: reopens the settled one-box flow (space names open without the model, note search as the used-up fallback), adds a drawer library, needs new A5d-style checklists. Better as a later product step |

### Home A with a bigger box (owner's request, 2026-10-07)

The owner asked for a wider box, about three lines tall, with 🎤 and Send at its bottom right,
then a division before the rest. Three variations are on the mockup page ("New: big box"):

- **A1, a divider line:** a thin rule under the box, then tiles and spaces. The cheapest.
- **A2, two zones (recommended):** the box and the four tiles sit in a white top panel, and the
  spaces sit on the grey background below. A short "🔒 Passwords go in the Vault" hint fits at the
  bottom left of the box.
- **A3, box + pills:** the actions shrink to small pills under the box, so the spaces start
  higher.

In all three, the box grows from 3 lines to about 6, then scrolls. Return adds a line and only ↑
sends (on home, Return sends today). 📍 stays a tile, so home never reads the location except on
that tap. The chat uses the same box, with 📍 at its bottom left and the password line inside it.

### A2 with ＋, the counter and a password check (owner's request, 2026-10-07)

The owner chose A2 and asked for ＋ (attachments) at the box's bottom left, the usage counter in
the middle, 🎤 and Send at the right, and for Wilma to tell the user when they type a password.
Mockups: section "Newest" on the mockup page.

- **＋** opens: take a photo, photo or file, new note (each opens the existing New note screen).
  "New note" leaves the tiles: Chat, Save here, Vault. In the chat, ＋ also offers 📍 "Send where I
  am", replacing the separate 📍 button.
- **Counter:** "About 180 left", amber from 80% ("12 left · resets Nov 1"), red when used up;
  tap for Settings. Counted in requests, not tokens (D22/D28).
- **Password warning: from the phone, not from Wilma.** If Wilma said it, the password would
  already have been sent to the AI provider (rule 1, rule 9). Instead, the app checks the text as
  it is typed, with the same patterns the server uses (`mcp/lib/credentials.ts`,
  `findCredential`). On a match, the box turns amber, a card says "This looks like a password.
  Wilma won't send it." with **Save in Vault** (opens "Save a secret"; the text is not copied
  across) and **Edit message**, and Send is held.
- **Gap found while checking this:** today the chat function sends any message to the model.
  Only saving is blocked (rule 9 in `save_item`/`update_item`), and the one-box classifier is
  guarded (`chat/classify.ts`, `guard`). A typed password therefore reaches the AI provider, even
  though it is never saved. The app check above covers the app. **Recommend** the same check in
  the `chat` function, refusing a credential-looking message before any model call, so other
  front ends and old app versions are covered too. That is a server change and needs an
  evaluation run (strongest model, owner's OK).
- Dictation: speech is turned into text by the phone's speech service before the check can see
  it, so a small "Don't say passwords" line stays while the mic is on.

### Chat

| | What moves where | What it fixes | Cost |
|---|---|---|---|
| **A. Compact composer, one status line, one card style** (recommended) | 📍 and 🎤 become small round icon buttons, Send a round ↑ (same accessibility labels). The grey lines collapse to **one chip above the box** showing the most important state (used up > finding location / pin error > 📍 on > mic error); its ✕ removes the 📍. The password line stays **always visible**, shortened to "🔒 Passwords go in the Vault, never here." with "Vault" tappable. "New" → "New chat". Allowance in one place at a time | Text field gets roughly 40% more width; the thread keeps its height; the password line stands out because it is alone | Small-medium: 2 PRs (composer, cards); the 📍 logic (`lib/chatHere.ts`) is reused unchanged |
| **B. "+" tray, mic turns into Send** | 📍 (and later photos) behind ＋; with an empty box the round button is 🎤, once you type it becomes ↑ | Cleanest composer; room for attachments | Medium: 3 PRs; 📍 is one tap deeper (less important once step 8's "Share where I am" card exists); the mic/Send swap is new behaviour, and the step 7 checklist must be redone |
| **C. Light polish only** | Today's layout with narrower 📍/🎤, the grey lines joined into one, "New chat", cards matched to the bubbles | The worst of the squeeze | Very small: 1 PR; still four controls in a row and stacked card buttons |

### Chat cards (with chat A or B)

One `ChatCard` shell: an icon for the kind (🔒 vault, 🗒 notes, 📍 place, 🗑 delete, ⚠️ problem),
the text, then a right-aligned row of buttons side by side. One main action is filled. A
destructive action is red text, never filled. Cancel comes first. Finished cards (deleted, left
alone, not done) shrink to one dimmed line. Unchanged rules: a vault card opens the app's own
vault screen only, shows name and kind only, and never uses a server link; a delete card shows the
server's own question and labels; nothing runs until Delete is tapped. Places step 8's place
cards and "📍 Share where I am" card use the same shell.

## 3. Plan (decided 2026-10-07, build next)

**Into the full chat:** tapping ↑ on home slides the chat up from the bottom (mockup section
"Newest: into the chat"), showing your message and then Wilma's answer; the box at the bottom
is the same box. The Chat tile becomes wide and shows the last question ("💬 Continue · where's
the wifi note?"; `lastUserText` in `lib/chatThread.ts`), or "💬 Chat" when empty, and opens the
chat without sending. ‹ or Android back slides it away and keeps the conversation. Space names
and the used-up note search work as today.

Small PRs. Each passes `npm run check` and is tried in the browser preview (`docs/handoff.md`,
"Trying the app in a browser"). PRs 1-6 are app only and ship together in one Play build.

1. **Shared pieces** in `components/ui.tsx`: `IconButton`, `TextLink`, `Tile`, `GroupList`,
   `WilmaBox` (3 lines growing to about 6; ＋ bottom left, counter centre, 🎤 and ↑ bottom right;
   Return adds a line, only ↑ sends) and a spacing scale (4/8/12/16/24). No visible change.
   *Model: Sonnet.*
2. **Settings screen** (`app/src/app/settings.tsx`) behind ⚙: full meter, signed in as, change
   sign-in password (the existing `/account` screen), recycle bin, sign out, version. Home drops
   its footer. *Sonnet.*
3. **Home A2:** the top panel with `WilmaBox`, the tiles (wide Continue/Chat, 📍 Save here, 🔒
   Vault), the ＋ menu (new note; photo or file opens New note, which attaches after saving as
   today), spaces as a grouped list with a one-line restricted row, the counter (amber from 80%,
   red when used up; tap for Settings), and the chat screen's `animation: 'slide_from_bottom'`.
   📍 Save here still opens `/new-item?here=1`, so the location is read only on that tap. *Sonnet.*
4. **Password check on the phone** (home and chat): an app copy of the server's `findCredential`
   (`supabase/functions/mcp/lib/credentials.ts`) with a test that both give the same answers on
   the same cases; the amber card ("This looks like a password. Wilma won't send it.", **Save in
   Vault** opening "Save a secret" without copying the text, **Edit message**); Send held; a
   "Don't say passwords" line while the mic is on. *Strongest model.*
5. **Chat with `WilmaBox`:** ＋ menu with 📍 "Send where I am" (replaces the 📍 button; the
   location is still read only on that tap and sent with one message), the counter, one status
   chip, "New chat". *Strongest model.*
6. **Chat cards:** one `ChatCard` shell for vault, notes, delete and error cards (section 2,
   "Chat cards"). *Strongest model.*
7. **Server: the same check in the `chat` function** before any model call (and before the
   classifier, which already has it), with an evaluation run; covers the Claude connector and
   older app versions. Deploy needs the owner's OK. *Strongest model.*
8. **Phone checklist** `docs/ui-tidy-phone-checklist.md` (home panel, ＋ menu, counter, Settings,
   slide-up, Continue tile, password card on home and chat, 📍 on and off, dictation, a delete
   card, a vault card, light and dark), then "build for Play" when the owner says so. *Sonnet.*

Places step 8 then builds its place cards on the `ChatCard` shell from PR 6.

## 4. Questions for the owner

**Decided 2026-10-07:** U1 (A, variation A2 with ＋ and the counter), U3 (Vault as a tile, the
rest on Settings), U4 (📍 Save here stays a tile), U6/U7 (replaced: the password check on the
phone shows a card when needed; no fixed hint line, except while the mic is on), U2 (chat A,
with `WilmaBox`). Still open, with the plan assuming the recommendation: U5 (one card shell) and
U8 (this before places step 8).

- **U1. Home layout?** *Recommend:* A (tidy home + Settings), variation A2 (big box in a top panel). Alternatives: B tab bar, C chat as home.
- **U2. Chat layout?** *Recommend:* A (compact composer, one status line). Alternatives: B "+" tray, C polish only.
- **U3. Where do Vault, Recycle bin, password and Sign out go?** *Recommend:* Vault as a home
  tile; the rest on Settings (⚙). Alternatives: everything on Settings; a Vault tab (with B).
- **U4. Where does "📍 Save where I am" live?** *Recommend:* a home tile ("Save here"), still
  reading the location only on that tap. Alternative: inside New note as "Use where I am".
- **U5. How do chat cards look?** *Recommend:* one shell (icon, text, buttons side by side).
  Alternative: keep today's cards and only match the bubble shape.
- **U6. Password reminder in the chat?** *Recommend:* always visible, one short line, "Vault"
  tappable. Alternative: only while typing or dictating.
- **U7. Password reminder on home?** *Recommend:* as today (while dictating); the chat carries
  the permanent line. Alternative: also while the box has focus.
- **U8. Order?** *Recommend:* this tidy-up first, then places step 8 on the new cards.
  Alternative: step 8 first.
