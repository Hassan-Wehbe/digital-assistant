# Wilma mobile app: owner setup (milestone A0)

What you do yourself, once. Nothing here asks you to paste a password, token or key into a
chat, an issue or the repository; each goes only into the website it belongs to.

## 1. Expo account (free)

1. Go to **expo.dev** and sign up (email and password, or GitHub).
2. Top left, **Projects -> Create a project**. Name: `wilma`, slug `wilma`.
3. Open the project. On its overview page copy the **project ID** (a long id like
   `1a2b3c4d-...`) and tell Claude it together with your **Expo username**. These two are
   not secret; they go into `app/app.json` so builds know which project they belong to.

## 2. Build token for GitHub (lets the "app build" button start builds)

1. On expo.dev: your avatar -> **Account settings -> Access tokens -> Create token**.
   Name it `github-actions`. Copy the token (it is shown once).
2. On GitHub: the repository -> **Settings -> Secrets and variables -> Actions -> New
   repository secret**. Name `EXPO_TOKEN`, value: the token. Save.
3. Do not paste the token anywhere else. If it ever leaks, delete it on expo.dev and create
   a new one.

## 3. Google Play developer account (personal, $25 once)

1. Go to **play.google.com/console** and sign up with the Google account you want to own the
   app. Choose **Personal** (we agreed: personal now, a company account later if needed).
2. Pay the $25 fee and complete Google's **identity verification** (a photo ID; it can take
   a few days). Google also asks for a phone number and, for personal accounts, to confirm
   you have an Android device.
3. When the account is ready, tell Claude. Nothing to copy yet: the first upload of the app
   to Google Play is done by hand in the Play Console, with steps provided when the first
   production build exists.

## 4. Try the app on your Android phone (after steps 1 and 2)

1. Claude (or you) runs **GitHub -> Actions -> app build -> Run workflow**, profile
   `preview`.
2. The build runs on Expo's servers (about 10-20 minutes). On expo.dev -> the `wilma`
   project -> **Builds**, open the finished build and scan its QR code with your phone, or
   open the link on the phone, to download and install the `.apk`.
3. Android asks to allow installing apps from your browser: allow it for this install.
4. The first build also creates the app's signing key, which Expo stores for you. It is
   needed for every future update, so do not delete the project's credentials on expo.dev.

For milestone A0 the app shows only a welcome screen with its version. Sign-in and search
come in A1.
