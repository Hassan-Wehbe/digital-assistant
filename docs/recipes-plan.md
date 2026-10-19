# Recipes and cocktails: two built-in spaces, importing, and "what should I make?"

Status: plan, 2026-10-19, **waiting on the owner's answers (Q1-Q12)**. Nothing built. Design: D43
(builds on D41, links shared from social apps; D40, the planners and the household; the built-in
spaces of the memory plan). Model: the strongest for steps 1, 3, 4, 5 and 7 (the sign-up trigger
and a migration, what the AI sees, images sent to the AI, the chat); a smaller one is fine for the
screens of steps 2 and 6 and for step 8.

## Why

The owner (2026-10-19): "we need a new section, propose meal from recipes, propose cocktails. We
should have 2 default spaces for this, recipe and cocktail recipes. It could be a note that has an
fb link or other link or it could be a full blown recipe. If we can someway import recipe from
TikTok or fb even better, if not it's ok."

Recipes are already one of Wilma's first examples ("Wilma, save this recipe"), but today a recipe
is just a note: Wilma cannot tell what is in it, how long it takes, or whether you have what it
needs, so she cannot suggest one. Most saved recipes arrive as links from TikTok, Facebook or
Instagram, which are only useful later if Wilma knows what they are.

## Decided already (owner, 2026-10-19, D43)

- **Two default spaces** on every account: one for food recipes, one for cocktails.
- A recipe can be **a link note** (a TikTok, Facebook or website link with a title) **or a full
  recipe**; both count, both can be suggested.
- **Import from TikTok or Facebook if possible**; not having it is acceptable.
- **A way to ask** "what meal should I make?" and "what cocktail should I make?", from your own
  recipes.

## What exists today

- **Built-in spaces** (`space.built_in`, memory plan): Tasks and Memories. Made at sign-up
  (`_ensure_built_in_spaces`), cannot be deleted, renamed, moved or restricted; a space the user
  already made with that name is adopted rather than duplicated.
- **Notes** (`item`): `item_type` is free text and `metadata` holds checked fields per type (places:
  `mcp/lib/places.ts`). Search, revisions (rule 7), the recycle bin (rule 8) and RLS apply to every
  type. `recipe` is already used as a type by the chat and the Claude connector, with no fields.
- **Links shared to Wilma** (D41, `app/src/lib/linkInfo.ts`, `share.tsx`): Share → Wilma opens a new
  note with the link, the site's name ("From TikTok") and **Get title**, which reads the page's title
  on the phone only when tapped (YouTube via its public oEmbed address; other pages' og:title). It
  already knows TikTok, Facebook, Instagram and Pinterest links. Facebook and Instagram mostly
  answer with a login page, so Get title gives nothing there.
- **Photos and screenshots** can be shared to Wilma and attached to a note (`image/jpeg`, `image/png`
  share filters, `attach.tsx`). The AI never sees them: the AI layer (`_shared/llm`) sends text only.
- **The planners** (D40, `chat/outing.ts`): code makes a short list, **one AI request picks and
  words it, code checks every id**, Pro and fair use, never stored, a card shared by the screen and
  the chat. The **household** (`household_member`: labels, adult or child, a birth year) and the
  rule that the AI hears roles and ages only, never names.
- **Home's Plan with Wilma row** (`lib/planners.ts`, `PlanRow.tsx`): My day, Date night, Family day,
  Vacation (Soon).

## Importing: what is realistic (to confirm in step 3; sites change their rules)

| Source | What Wilma can get | How |
|---|---|---|
| **Recipe websites** (AllRecipes, BBC Good Food, most food blogs) | **The whole recipe**: ingredients, steps, time, servings, often a photo | Almost every recipe site puts a standard hidden "Recipe" block in the page (schema.org `Recipe`, which Google uses for its recipe cards). Plain code reads it on the phone: **no AI, no cost**. |
| **TikTok** | **The caption** (often the ingredient list, sometimes the steps) and the creator's name | TikTok's public oEmbed address, no key (as YouTube's for Get title). The caption is then turned into a recipe by the AI, on a tap. Nothing from the video itself (what is said or shown). |
| **Instagram, Facebook** | **Usually nothing** | Posts need a login; Meta's official oEmbed needs a registered developer app, review, and gives back embed code rather than the text. Not worth it. |
| **A screenshot** (any app: TikTok, Facebook, Instagram, a cookbook page, a handwritten card) | **The recipe as written in the picture** | Share the screenshot to Wilma (or take a photo); the AI reads it and fills in the recipe, on a tap. Works for every source above, which is why it is worth building even though it is new (images to the AI). |
| **Video transcription** ("what the chef says") | Not planned | Downloading videos breaks TikTok's and Meta's terms, and would be slow and costly. |

**So:** websites fully, TikTok mostly, Facebook and Instagram through a screenshot. A link note
always stays as it is: the recipe fields are filled in **next to** the link, never instead of it,
so the original is one tap away and its creator is credited.

## What the owner will see

**Two new spaces** on every account: **🍽️ Recipes** and **🍸 Cocktails** (Q1, Q2). An account that
already has a top-level, unrestricted space called Recipes (or Cocktails) keeps it, now built in.

**A recipe note** (new, or Share → Wilma into Recipes or Cocktails) can have, besides the title and
the link: **Ingredients** (one per line), **Steps**, **Time** (minutes), **Serves**, and **Tags**
(weeknight, vegetarian, kid-friendly, dessert, …; for a cocktail: the base spirit, Light, No
alcohol). All optional. A link note with only a title is still a recipe.
- On a note with a link: **Fill in the recipe** (Q4). From a recipe website it fills the fields
  at once (no AI); from TikTok it reads the caption and the AI turns it into fields; either way you
  see the result and tap **Save** or change it first.
- On a screenshot shared to Wilma (or a photo attached to a recipe): **Read the recipe** (Q5), the
  same result to check and save.
- **Made it** with an optional ★ 1-5 (Q8), so "you rated it 5, last made in July" can steer
  suggestions.

**"What's for dinner?"** (Q9: from Home; mockup to come in step 6):
- **For:** Tonight (default), Lunch, Pick a day. **Time:** 20 min · 45 min · No rush. **Who's
  eating:** chips from the household ("2 adults", "2 kids (6, 9)"), as Family day. **I have:** a few
  words ("chicken, rice, spinach"), remembered on the phone for next time (Q6). **Kind:** Anything ·
  Vegetarian · Kid-friendly · Something light.
- Then **one card**: BEST FIT, the recipe's title, one line why ("30 min · uses your chicken and
  spinach · missing: cream"), "You rated it 5 · last made in July", **Open recipe** (or **Open
  link** for a link note), two others under it, and **Another idea**.

**"Make a cocktail"** (🍸): **My bar:** a few words ("gin, vodka, lime, mint, tonic"), remembered on
the phone (Q6); **Strength:** Regular · Light · No alcohol; **Mood:** A classic · Something fruity ·
Surprise me. The same kind of card, with what is missing ("missing: Cointreau").

**When nothing fits** (Q7): "None of your 12 recipes fits 20 minutes with chicken." and **A new idea**:
the AI suggests one recipe that is not in your spaces, clearly marked **New, not from your
recipes**, with a **Save to Recipes** button.

**The chat:** "Wilma, what should I cook tonight? I have chicken and rice" and "what cocktail can I
make with gin and lime?" give the same cards (step 7). "Save this recipe" keeps working as today.

## How it works

1. **Built-in spaces** (step 1): `space.built_in` gains `'recipes'` and `'cocktails'`;
   `_ensure_built_in_spaces` makes them at sign-up and for every existing account (adopting a
   top-level, unrestricted space of that name, any case; a restricted one is left alone and a new
   one is not made beside it, so a user who locked their Recipes space keeps it locked, rule 3).
2. **Recipe fields** (step 2): item types `recipe` and `cocktail`, with checked `metadata` in a new
   `mcp/lib/recipes.ts` (as places): `ingredients` (at most 60 lines, each ≤ 200 characters),
   `steps` (≤ 40), `minutes`, `serves`, `tags` (≤ 15), `source_url`, `source_site`, `made` (dates and
   ratings, ≤ 50). The note's text (`body_markdown`) is written from the fields (an Ingredients list
   and numbered Steps) so ordinary search finds "the chicken one" and the Claude connector reads it
   as a normal note. Every field passes the password check (rule 9). Editing keeps the previous
   version (rule 7). `save_item` and `update_item` accept the fields.
3. **Fill in from a link** (step 3), started only by the tap:
   - **Website:** the phone fetches the page (as Get title does) and plain code reads its `Recipe`
     block. No server, no AI, no cost. A page without one says "This page has no recipe Wilma can
     read. Try a screenshot."
   - **TikTok:** the phone reads the caption through the public oEmbed address, then sends **only
     that caption** to the `chat` function (`{"mode":"recipe_from_text"}`), where one small AI
     request returns the fields as JSON, which code checks (the same limits as step 2; anything
     credential-like blanked). Counted against the AI allowance.
4. **Read a screenshot** (step 4): the `chat` function gets one image (`{"mode":"recipe_from_image"}`,
   JPEG or PNG, ≤ 5 MB, resized on the phone to at most 1,600 px and **with its location and camera
   details removed**), sends it to the AI with "return only the recipe's fields as JSON", and checks
   the answer as above. The AI layer learns to send an image (both providers support it). The image
   is not kept by the server; if you save, it is attached to the note as any photo. Counted against
   the AI allowance. A screenshot that holds no recipe: "Wilma couldn't find a recipe in this
   picture."
5. **The suggestion route** (step 5): `{"mode":"meal"}` and `{"mode":"cocktail"}` in `chat`, as the
   planners.
   - **Code makes the short list** (no AI): `recipe` (or `cocktail`) notes, plus link-only notes
     in the Recipes (or Cocktails) space, **from searchable spaces only** (rule 3), filtered by
     time, kind and strength where the note says so; well-rated and not made lately first; at most
     25.
   - **One AI request** gets the list as facts (title, ingredients, minutes, tags, rating, last
     made; for a link note only its title and site), what you have, who is eating as **roles and
     ages only** (as D40), and must answer with JSON: up to 3 choices **by number from the list**,
     each with one short line and what is missing. **Code checks it:** unknown numbers dropped, a
     line that looks like a credential blanked; no choice left = "nothing fits".
   - **A new idea** (Q7) is a second, separate request, only on its tap, whose answer is a full
     recipe marked new and never saved until you tap Save.
   - Pro and fair use as the planners (Q10); never stored.
6. **The app** (step 6): the two screens, the card, Home's new row (Q9), the recipe fields on
   new and edit note, Fill in the recipe, Read the recipe, Made it.
7. **The chat** (step 7): tools `suggest_meal` and `suggest_cocktail` on the same route, the same
   card; evaluation cases with traps.

## Rules check

- **Secrets (rules 1, 2, 9):** recipe fields, captions and AI answers pass the password check; a
  recipe is ordinary content. A screenshot could show something private (a password on the screen
  next to the recipe): the AI is told to return only recipe fields, and code blanks anything
  credential-like in what comes back; the evaluation gets a screenshot trap (step 4). No secret is
  ever read.
- **Restricted spaces (rule 3):** suggestions read only from searchable spaces; a recipe in a locked
  space is never suggested, counted or hinted at ("None of your 12 recipes" counts searchable ones
  only). A restricted space named Recipes is never adopted as the built-in one.
- **Every row owned (rule 5):** no new table (Q6's lists stay on the phone); notes keep their RLS.
  Step 1's migration changes only the built-in check and the helper, granting nothing new to anon.
- **History and delete (rules 7, 8):** filling in a recipe edits the note, so the earlier version
  is kept; Made it adds to the note's fields (also a revision). Built-in spaces cannot be deleted;
  their notes can.
- **Sharing (rule 4):** not in this plan. When sharing spaces comes (D32), a shared Recipes space
  shares notes only, as any space.
- **What goes where (privacy page, step 8):** a website's page and TikTok's caption are fetched by
  the phone on a tap, as Get title. A caption, a screenshot, your "I have" words and roles and ages
  go to the AI provider only on a tap, never stored by Wilma's server. **Images to the AI are new**:
  the privacy page and the Play Data safety form are checked in step 8.
- **Alcohol:** a cocktail feature references alcohol. **Before the build that ships Cocktails:**
  redo Play's **content rating** questionnaire (references to alcohol) and add a line to the legal
  checklist; "No alcohol" is always offered (Q11).
- **Copyright:** a recipe saved for yourself, with its link and creator kept, is personal use. The
  card always shows where a recipe came from. Nothing is republished.
- **Cost:** a website import is free; a caption or a suggestion is one small AI request; a
  screenshot is one AI request with an image (a few times a text request); all inside the existing
  AI allowance and fair use.

## Questions (recommendation first)

- **Q1. The two spaces:** **built in, like Tasks and Memories** (rec.: always there, the suggestion
  screens always know where to look, cannot be deleted by mistake); or ordinary starter spaces you
  can rename or delete.
- **Q2. Their names:** **"Recipes" and "Cocktails"** (rec.: short, and an existing "Recipes" space
  is adopted); or "Recipes" and "Cocktail recipes".
- **Q3. Where a recipe can live:** **anywhere; the two spaces are the default** (rec.: a recipe in
  Work/Team lunch still counts, if the space is searchable); or only inside the two spaces.
- **Q4. Fill in from a link:** **websites (no AI) and TikTok captions (AI), on a tap** (rec.); or
  websites only (no AI at all for importing).
- **Q5. Screenshots:** **yes, in its own step (4), after the link import works** (rec.: it is the
  only way for Facebook and Instagram, but it sends images to the AI, which is new and needs the
  privacy page); or not now.
- **Q6. What you have (fridge, bar):** **typed each time, remembered on the phone for next time**
  (rec.: no new table, nothing stored on the server, and the fridge changes daily); or a saved
  Pantry and My bar list in Settings (handy for the bar, which changes slowly; one more table).
- **Q7. When none of your recipes fits:** **say so, and offer A new idea, clearly marked, saved
  only on your tap** (rec.: a new account with an empty Recipes space still gets something); or
  your recipes only, never anything new.
- **Q8. Made it and a rating:** **yes, Made it with an optional ★ 1-5** (rec.: favourites not made
  lately rise, as Date night's favourites); or no history.
- **Q9. Where you ask:** **a new Home row "Cook with Wilma" with 🍽️ What's for dinner and 🍸 Make a
  cocktail, plus the chat** (rec.: the Plan with Wilma row is about your time and already has four
  buttons); or two more buttons on the Plan with Wilma row; or only from inside the two spaces.
- **Q10. Who gets suggestions:** **everyone; up to 10 suggestions a day free, more with Pro**
  (rec.: a suggestion is a small text request, much cheaper than a planner's drive times); or
  Pro only, as the planners.
- **Q11. Cocktails and alcohol:** **"No alcohol" always offered; no age question** (rec.: Wilma is
  not designed for children; Play's target audience is "18 and over (or 13 and over)" in
  `docs/phase4-play-release.md`, so the owner confirms it is set to 18 and over; the content
  rating is redone); or ask the user's
  age before showing Cocktails.
- **Q12. Who is eating:** **the household's roles and ages, as Family day (never names)** (rec.:
  "kids 6 and 9" is enough to skip the chilli); or a plain number of people.

## Steps

1. **Built-in Recipes and Cocktails (strongest model).** Migration: `built_in` allows `'recipes'`
   and `'cocktails'`, `_ensure_built_in_spaces` makes or adopts them (never a restricted one), run
   for every existing account; SQL test and a dry run; the app shows them like Tasks and Memories.
   **Owner:** dry run, OK to apply, merge.
2. **Recipe fields (strongest for the server check, smaller for the screens).** `mcp/lib/recipes.ts`
   (checked fields, the text written from them), `save_item`/`update_item` accept them; the app's
   new and edit note get the fields for `recipe` and `cocktail` notes; a recipe view; Made it.
   Deno and app tests (a password in an ingredient refused, a revision on Made it). **Owner:**
   merge, OK to deploy `mcp`.
3. **Fill in from a link (strongest model).** The phone's `Recipe` block reader (tests with saved
   pages from a few big recipe sites), TikTok's caption via oEmbed, `{"mode":"recipe_from_text"}`
   with checked JSON; Fill in the recipe on link notes. Check TikTok's oEmbed terms first.
   **Owner:** merge, OK to deploy `chat`.
4. **Read a screenshot (strongest model).** Images in the AI layer (both providers), the phone's
   resize and metadata removal, `{"mode":"recipe_from_image"}`, Read the recipe; evaluation cases
   with traps (a screenshot with a password beside the recipe; a screenshot with no recipe).
   **Owner:** OK + cap for an evaluation run, merge, OK to deploy `chat`.
5. **The suggestion route (strongest model).** `{"mode":"meal"}` and `{"mode":"cocktail"}`: the short
   list (code, searchable spaces only), one AI request, every number checked, A new idea; Deno
   tests (a restricted recipe never reaches the AI, names never reach it, an invented number
   dropped). **Owner:** merge, OK to deploy `chat`.
6. **The app (smaller model; a mockup first for the owner).** Home's Cook with Wilma row, What's
   for dinner and Make a cocktail screens, the card, remembered "I have" and "My bar". App tests.
7. **The chat (strongest model).** `suggest_meal`, `suggest_cocktail`, the same card; evaluation
   cases with traps (a restricted recipe, a credential in a recipe, an invented recipe presented
   as yours). **Owner:** OK + cap for an evaluation run, merge, OK to deploy `chat`.
8. **Help, privacy, Play, checklist, build (smaller model).** Help topic lines; the privacy page
   (images to the AI, captions, what the phone fetches); Play **content rating** (alcohol) and
   **Data safety** checked; the legal checklist; the phone checklist; then the build.

Steps 1-3 are useful on their own (the spaces and imports, no suggestions yet) and can ship in one
build; 4 can wait if you want to see the rest first.
