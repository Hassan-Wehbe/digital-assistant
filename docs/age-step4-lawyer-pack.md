# Teens on Wilma: the pack for the lawyer (ages step 4, D44)

For the owner to send to the lawyer (Q10: teens sign up only after the lawyer has read the new terms
and privacy page). **Nothing here is live.** Wilma stays 18 and over until the owner says the
lawyer is done; then the drafts below (with the lawyer's changes) go into the real pages, a small
app build, and one database setting (see "The switch").

Plan: `docs/age-plan.md` (decisions Q1-Q11, as built steps 1-3). Today's pages:
[privacy policy](legal/privacy.html), [testing terms](legal/testing-terms.html).

## What changes

- **Who can sign up:** 13 and over (today 18). Under 13: no account (families accounts are a later,
  separate plan, Q11).
- **Under 18:** a parent or guardian must agree to the terms and privacy policy (wording below).
- **Age check:** the month and year of birth at sign-up (already live since versionCode 25). Wilma
  works out the age on the server and **keeps only the result**: "21 or over", or the month the
  person turns 21. The month and year are not stored, logged or shown anywhere.
- **Alcohol:** cocktail recipes and suggestions only from 21; under 21, drinks are mocktails (no
  alcohol), enforced on the server, in the app and in the AI chat (already live).
- **Nothing else changes for teens:** the same features as adults (notes, the vault, My day, places,
  the AI chat, memory, recipes). No ads, no sharing with other users yet, no public profile.

## Draft wording (for the lawyer to change)

**Testing terms, "Who can take part"** (replaces "You are 18 or older, and you were given an
invite code."):

> - You are 13 or older, and you were given an invite code.
> - If you are under 18, a parent or legal guardian has read these terms and the privacy policy and
>   agrees to them for you, and is responsible for your use of Wilma.
> - Cocktail recipes and suggestions are only for people 21 and over; younger people get drinks
>   without alcohol.

**Sign-up screen, shown when the month and year say under 18** (new line in the app):

> You're under 18: ask a parent or guardian to read the Testing terms and Privacy policy with you.
> By creating the account, you confirm they agree.

**Privacy policy, "Children"** (replaces the paragraph that says Wilma is for adults):

> Wilma is for people 13 and over; people under 18 need a parent or guardian's agreement. Your
> month and year of birth are asked once to check your age and are not kept: Wilma keeps only
> whether you are 21 or over, or the month you turn 21, so that cocktail recipes are only for adults.
> We do not knowingly collect information from children under 13; if you believe a child under 13
> has an account, contact us and we will delete it. If you add children to your household, Wilma
> keeps only the label and birth year you enter (as today).

## Questions for the lawyer

1. **Consent for 13-17:** is "a parent or guardian agrees" (a line the teen confirms) enough, or is
   verified parental consent needed in some states we expect users in (Florida first)?
2. **US children's and teen laws:** COPPA should not apply (no one under 13). Do state laws apply to
   an AI assistant used by 13-17-year-olds: age-appropriate design codes (for example Maryland's),
   minors' social media laws (Florida HB 3; Wilma has no feed or other users today), and the newer
   **AI chatbot laws for minors** (for example California's companion-chatbot law): disclosures that
   the user is talking to an AI, break reminders, self-harm protocols?
3. **The AI provider's rules:** OpenAI's terms allow 13-17 with a parent's permission. Does Wilma's
   wording meet that, and do we need anything more in the terms (AI answers can be wrong; not for
   medical, legal or emergency help)?
4. **Alcohol:** 21 everywhere for cocktail recipes, enforced as above, with the content rating
   "references to alcohol". Enough for a 13+ audience, and in every country Play distributes to?
5. **Keeping only the result** (not the birth date): is that fine for proving the age check was done
   (we keep the terms version and the time of acceptance too)? Anything to declare in Play's Data
   safety form (we think nothing new: no date of birth is kept or shared)?
6. **Memory, location, calendar and household for teens:** the same features as adults. Should any
   be off by default for under 18 (automatic memory is already off until turned on)?
7. **Deleting a teen's account** at a parent's request: is the support email enough?

## The switch (after the lawyer)

In this order; each step has the owner's OK:

1. **Pages:** the lawyer's wording into `docs/legal/testing-terms.html` (a **new version**, for
   example `2026-11-xx`) and `docs/legal/privacy.html` (Children, and "Last updated").
2. **App build:** `TERMS_VERSION` in `app/src/lib/signup.ts` set to the new version, and the under-18
   line on the sign-up screen. Older apps send the old terms version, so their sign-ups are refused
   with "Please accept the privacy policy and testing terms." until updated (only new sign-ups).
3. **Server, on the day the build is released** (Supabase → SQL Editor → New query → Run):

   ```sql
   update signup_setting set terms_version = '<the new version>', min_age = 13;
   select terms_version, min_age from signup_setting;
   ```

   Good result: one row with the new version and 13.
4. **Play Console:** Policy and programs → App content → **Target audience and content** → ages
   **13-15, 16-17 and 18 and over** (not under 13, so the Families policy does not apply) → Save;
   **Content rating** stays "references to alcohol"; **Data safety** as the lawyer says; then
   Publishing overview → Send changes for review.
5. **Legal checklist:** the review date and reviewer recorded (`docs/legal-review-checklist.md`).
