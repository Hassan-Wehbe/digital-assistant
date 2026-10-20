# Phone checklist for the build after versionCode 23 (most likely versionCode 24)

For the owner, on the Play build after versionCode 23. It carries **recipes and cocktails** (D43,
`docs/recipes-plan.md` steps 1-8): the Recipes and Cocktails spaces, recipe fields and Made it, Fill
in the recipe from a link, Read a screenshot, What's for dinner? and Make a cocktail, the same in the
chat, and Your morning as a button on Home. The server parts are already live (`mcp` v36, `chat`
v45; v46 if the step 8 Help change is deployed). It is a **full build** (a new native module for
pictures). About 30 minutes. Do versionCode 21-23's checklists first if you haven't.

You need: a TikTok recipe video link with the ingredients in its caption, a recipe page on a big
recipe website (BBC Good Food, AllRecipes) and one on a food blog, a screenshot of a recipe (from
Instagram or Facebook), a screenshot of a chat (no recipe), and Settings → Household with at least
one child. The morning checks need **Pro** and the morning briefing on.

## Before you start

- [ ] The privacy page has a **Recipes and cocktails** paragraph (what the AI gets for a suggestion:
  your recipes, what you have, ages never names) and says Your morning is kept **under Your morning
  on the home screen** (published when the step 8 PR is merged).
- [ ] Play Console: the **content rating** was redone with **references to alcohol**, and **Target
  audience** is **18 and over** (`docs/phase4-play-release.md`, Content rating).

## Recipe notes (steps 1-2)

- [ ] (1) All spaces shows 🍽️ **Recipes** and 🍸 **Cocktails**. New note in Recipes starts as
  **Recipe**: add two ingredients, two steps, 20 minutes, serves 2, save: the note shows them in
  order.
- [ ] (2) **Made it** with ★★★★ → "Made once · last on today · ★4".
- [ ] (3) Share a TikTok link into Recipes → saved as a recipe; **Open on TikTok** opens it.
- [ ] (4) New note in Cocktails → Strength **No alcohol** shows on the note.
- [ ] (5) Edit a plain note → 🍽️ **Make this a recipe** → save → it shows the recipe card.
- [ ] (6) Typing a password in an ingredient is refused and pointed to the Vault.

## Fill in the recipe (step 3)

- [ ] (7) A recipe from BBC Good Food or AllRecipes: **Fill in the recipe** fills the ingredients,
  steps, time and servings.
- [ ] (8) A food blog recipe (WordPress): the same.
- [ ] (9) The TikTok recipe video: Fill in fills the ingredients from its caption.
- [ ] (10) A Facebook link: the "doesn't let apps read its posts" line, nothing fetched.
- [ ] (11) Type an ingredient first, then Fill in: your ingredient stays.

## Read a screenshot (step 4)

- [ ] (12) 📷 **Read a screenshot** of the Instagram or Facebook recipe: the boxes fill.
- [ ] (13) A photo of a cookbook page: the same.
- [ ] (14) The chat screenshot: "couldn't find a recipe".
- [ ] (15) Cancel the picker: nothing happens.

## Home and Your morning (step 6)

- [ ] (16) Home: **Plan with Wilma** has My day and 🌅 **Your morning** side by side, then Date night
  and Family day, then Vacation (SOON); **Cook with Wilma** is under it. No morning card at the top
  of Home any more.
- [ ] (17) With the briefing on, open Wilma after its time: Your morning says **NEW**; open it: the
  summary and Open My day; back on Home, NEW is gone.
- [ ] (18) Before the briefing time: the screen says not made yet; **Make it now** makes it.
- [ ] (19) Briefing off: the screen offers **Morning briefing ›**.
- [ ] Pull down on Home: the spaces refresh; Your morning is **not** made again (Make it again on
  its screen does that).

## What's for dinner? and Make a cocktail (step 6)

Save three or four recipes first (with times and a ★ rating on one), one of them vegetarian.

- [ ] (20) **What's for dinner?** with a few recipes: a BEST FIT card and two smaller ones; **Open
  recipe** opens the note; **Another idea** gives different ones; "n of 10 today" under them.
- [ ] (21) **Vegetarian** with no vegetarian recipe saved (or 20 min with only slow ones): "None of
  your … fits" and "This didn't count…", then **A new idea**: a dashed card marked **NEW · NOT
  FROM YOUR RECIPES**; **Save to Recipes** opens a new recipe note in Recipes.
- [ ] (22) **Make a cocktail**, **No alcohol**: only drinks without alcohol, or a new one with no
  spirits.
- [ ] (23) Type "password 1234" in I have: the password warning, Suggest is off.
- [ ] (24) Leave and come back: I have and My bar are still there.
- [ ] (25) The household shows as chips ("1 adult", "1 kid (6)"); turning the kids off changes the
  suggestions.

## In the chat (step 7)

- [ ] (26) "What should I cook tonight? I have chicken and rice": "Looking through your recipes…",
  a short answer naming your recipes, and the same cards under it.
- [ ] (27) "What cocktail can I make without alcohol?": only drinks without alcohol.
- [ ] (28) "Which of my sushi recipes can I make?" (with none saved): Wilma says you have none and
  offers a new idea; if she gives one, she says it is new, and its card has **Save to Recipes**.
- [ ] (29) Save to Recipes on that card: "Saved to Recipes" and **Open recipe**.
- [ ] (30) Close and reopen the chat: the recipe cards are gone (they are not kept with the chat),
  the words stay.

## Help (step 8)

- [ ] (31) **?** → **Recipes & cocktails** is a topic: four short lines, Try it fills the chat box,
  and **What's for dinner?** opens that screen.
- [ ] (32) In the chat, "how do recipes work?": a short answer and the Help card at Recipes &
  cocktails (needs `chat` v46).
