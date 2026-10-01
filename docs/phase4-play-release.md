# A4: Wilma on Google Play (testing with family and friends)

Owner's decisions (2026-09-30):
- The Play developer account is set up.
- The first goal is testing by the owner plus family and friends, not a public listing.
- The public contact email is **zaftechlabs@gmail.com**.

Each tester gets their own Wilma account, which the owner creates; sign-ups stay closed. The
design keeps every account's data separate (RLS on every table), and each tester sets up their
own vault in the app.

Web pages (GitHub Pages, from `docs/legal/`), needed by Play Console:
- Privacy policy: https://hassan-wehbe.github.io/digital-assistant/legal/privacy
- Account deletion: https://hassan-wehbe.github.io/digital-assistant/legal/delete-account

Images for the listing: `docs/play/icon-512.png` (the Wilma mascot app icon, 512×512, same as
`app/assets/brand/play-store-icon-512.png`) and `docs/play/feature-graphic.png` (1024×500). Screenshots come from the owner's phone.

## Steps at a glance

| # | Step | Who |
|---|---|---|
| 1 | Merge the A4 PRs (pages, this guide; then "change sign-in password" in the app) | Owner says "merge", Claude merges |
| 2 | Production build (`.aab`, the package Google Play wants) | Owner says "build for Play", Claude starts it |
| 3 | Create the app in Play Console, fill in the forms (answers below) | Owner |
| 4 | Upload the `.aab` to **Internal testing** by hand (Google requires the first upload by hand) | Owner |
| 5 | Create Wilma accounts for testers in Supabase (below) | Owner |
| 6 | Add testers' Google emails to the internal test and send them the join link | Owner |

## 3. Create the app in Play Console

play.google.com/console → **Create app**:
- App name: **Wilma**
- Default language: English (United States)
- App or game: **App**
- Free or paid: **Free**. A free app can never become paid, but it can still sell
  subscriptions inside the app later. Choose paid only to charge for the download itself.
- Tick the two declarations → **Create app**.

Then go through **Dashboard → "Set up your app"**, one form at a time:

**Privacy policy:** `https://hassan-wehbe.github.io/digital-assistant/legal/privacy`

**App access:** "All or some functionality is restricted". Add instructions:
- Name: "Test account"
- Username / password: a reviewer account you create in Supabase (step 5), typed only into
  Play Console
- Note: "Sign in with the email and password above. Sign-ups are closed; accounts are created by
  the developer."

Never put these details in the chat or the repo.

**Ads:** No, the app does not contain ads.

**Content rating:** fill in the questionnaire. Category: *Utility, Productivity,
Communication, or Other*. Answer **No** to violence, sexuality, language, controlled
substances, gambling and user interaction or sharing (Wilma has no sharing between users and
no chat with other people). The result should be "Everyone" or the local equivalent.

**Target audience:** 18 and over (or 13 and over). Not designed for children.

**News app:** No. **COVID-19 contact tracing:** No. **Government app:** No.
**Financial features:** None. **Health:** None.

**Data safety.** Read each question on screen; these answers match what the app does today:
- Does the app collect or share user data? **Yes, it collects** (it stores what you save).
  Nothing is **shared** with third parties (Supabase stores it on our behalf, which Google does
  not count as sharing).
- Is all data encrypted in transit? **Yes** (HTTPS only).
- Can users request deletion? **Yes**: `https://hassan-wehbe.github.io/digital-assistant/legal/delete-account`
- Data types:
  - *Personal info → Email address*. Collected, required. Purpose: **Account management**,
    **App functionality**.
  - *Photos and videos → Photos*. Collected, optional. Purpose: **App functionality**.
  - *Files and docs*. Collected, optional. Purpose: **App functionality**.
  - *App activity → Other user-generated content* (notes, spaces, vault entries). Collected,
    optional. Purpose: **App functionality**.
  - Not collected: location, contacts, messages, audio, health, financial info, web
    browsing, device IDs, analytics or crash data (the app has none of these).
  - Vault values are end-to-end encrypted, so no one but the user can read them. Google's form
    still counts data that leaves the phone, so they are covered by "Other user-generated
    content" above. Do not claim the app collects no data.
  - "Is this data processed ephemerally?" **No** for all of the above (it is stored).

**Store listing** (Grow → Store presence → Main store listing):
- App name: `Wilma`
- Short description (80 max): `Save notes, photos, files and passwords, and find them again in seconds.`
- Full description:

  ```
  Wilma is your personal assistant for everything you want to keep: notes, recipes, designs,
  photos, files and passwords.

  • Spaces: organise what you save into spaces and sub-spaces (Recipes, Work, Home…).
  • Search: find a note by what it means, not only by its exact words.
  • Photos and files: attach pictures and Visio drawings to your notes, or share them to
    Wilma straight from other apps.
  • Vault: keep passwords, Wi-Fi keys, API keys and recovery codes in an encrypted vault.
    Values are encrypted on your phone with a passphrase only you know, unlocked with your
    fingerprint, and hidden again after 30 seconds. Nobody else can read them, not even us.
  • Recycle bin: deleted notes can be restored.

  No ads, no tracking.

  Wilma is in early testing; accounts are by invitation.
  ```
- App icon: `docs/play/icon-512.png`. Feature graphic: `docs/play/feature-graphic.png`.
- Phone screenshots: at least 2, taken on your phone (home, a space, the locked vault). Do
  **not** screenshot a revealed password. The app blocks screenshots on vault screens anyway.
- Category: **Productivity**. Contact email: **zaftechlabs@gmail.com**.

## 4. First upload: Internal testing

Testing → **Internal testing** → **Testers** tab → **Create email list** (e.g. "Family and
friends"). Add the **Google account emails** your testers use on their phones, up to 100 people.
Save, and tick the list.

**Releases** tab → **Create new release**:
- Play App Signing: accept Google's default (Google keeps the app signing key; the build is
  signed with the upload key that Expo manages).
- Upload the `.aab` downloaded from the expo.dev build page (step 2).
- Release name: leave the default. Release notes: "First test build."
- **Review release** → **Start rollout to Internal testing**.

Then on the **Testers** tab, **Copy link** (the join link) and send it to your testers. On
their Android phone, signed in with the Google account you added, they:
1. open the link and tap **Accept invite**;
2. tap **Download it on Google Play** and install Wilma.

Internal testing has only a light review and is usually available within minutes to a few
hours.

Later builds: Claude starts a production build when you ask, then you upload the new `.aab` to
the same track. (Automatic uploads with `eas submit` need a Google service-account key; set
that up later if uploading by hand becomes tedious.)

## 5. Wilma accounts for testers

Sign-ups stay closed; you create each account:

1. supabase.com → project **digital-assistant** → **Authentication → Users → Add user →
   Create new user**.
2. Email: the tester's email. Password: a temporary one. Tick **Auto Confirm User**. Create.
3. Tell the tester the temporary password in person or by phone, not in the same email as the
   join link. After the "change sign-in password" PR, they change it in the app on first use.
4. The tester signs in, taps **+ New space** to create their spaces, and sets up their own vault
   (**Vault → Set up the vault**). Remind them the recovery key is the only way back if they
   forget their vault passphrase; you cannot recover it for them.

Also create one **reviewer account** for Google (step 3, App access), with a strong password
used nowhere else, typed only into Play Console.

To remove a tester (or answer an account-deletion email), in this order:
1. **Storage → attachments**: delete the folder named with the user's id (the id is shown under
   Authentication → Users). This removes their photos and files. Deleting the user alone would
   leave these files behind, because Storage is not linked to the tables.
2. **Authentication → Users → the user → Delete user**. This removes everything else: every
   table is linked to the user and deleted with it (spaces, notes, versions, vault and log).

## Later: going public

A personal Play developer account must run a **closed test** with at least **12 testers for 14
days in a row** before it can publish to everyone. Family and friends can be those testers
(Testing → Closed testing, the same email list). Going public also needs open sign-ups and
"delete my account" inside the app (plan: "Publishing: what the stores require").
