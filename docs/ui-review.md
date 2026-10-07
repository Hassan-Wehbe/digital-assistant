# UI review: home screen and chat (2026-10-07)

The owner finds the home screen and the chat "very clunky and all over the place". This is a
design review: what feels clunky today, two or three layouts for each screen, a recommendation
and a plan of small app-only PRs. **Nothing is built yet.** The owner picks (questions U1-U8 at the
end), then the work starts.

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

## 3. Recommendation and plan

**Home A + Chat A + the card shell.** These fix the clunkiness the owner describes (stacked
buttons, mixed styles, settings on home, stacked warnings) without moving any screen or reopening
the one-box decisions. They also prepare the Settings screen and the card shell that places step 8,
the miles/km setting and account deletion need anyway.

Six small PRs, app only, no server change. Each passes `npm run check` and is tried in the browser
preview (`docs/handoff.md`, "Trying the app in a browser"). They ship together in one Play build.

1. **Shared pieces** in `components/ui.tsx`: `IconButton`, `TextLink`, `Tile`, `GroupList`, and
   a spacing scale (4/8/12/16/24). No visible change. *Model: Sonnet.*
2. **Settings screen** (`app/src/app/settings.tsx`): meter, signed in as, change sign-in password
   (the existing `/account` screen), recycle bin, sign out, version. Home gets ⚙ in its header and
   drops the footer. *Sonnet.*
3. **Home tidy:** action tiles (Chat, New note, Save here, Vault), round mic and Send, spaces as
   a grouped list, one-line restricted row (`rows.tsx`). The 📍 tile opens the same
   `/new-item?here=1` as today, so the location is still read only on that tap. *Sonnet.*
4. **Chat composer:** icon buttons, one status chip, always-visible short password line with its
   Vault link, "New chat", allowance shown once. Touches the password guidance and the 📍 wiring.
   *Strongest model.*
5. **Chat cards:** `ChatCard` shell used by vault, notes, delete and error cards; side-by-side
   buttons; finished cards as one line. Touches the vault and delete cards. *Strongest model.*
6. **Phone checklist** `docs/ui-tidy-phone-checklist.md` (home tiles, Settings, composer, 📍 on
   and off, dictation, a delete card, a vault card, light and dark), then "build for Play" when
   the owner says so. *Sonnet.*

Places step 8 then builds its cards on the shell from PR 5 (U8).

## 4. Questions for the owner

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
