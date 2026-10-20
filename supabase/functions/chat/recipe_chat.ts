// Recipes step 7 (docs/recipes-plan.md; design D43): "what should I cook tonight? I have chicken
// and rice" and "what cocktail can I make with gin and lime?" in the app's chat. Two chat-only
// actions (never offered to the Claude connector), suggest_meal and suggest_cocktail, run the same
// suggestion route as the app's screens (recipe_suggest.ts): the user's own recipes from searchable
// spaces only (rule 3), the same daily count (10 a day, 50 with Pro), one AI request whose cost is
// part of the chat message's (as plan_outing). The app shows the same cards as its screens.
//
// What goes back to the model is facts only: each choice's id, title, why line and what is missing,
// all checked by the route. Nothing is saved: A new idea is marked new and is saved only on the
// card's Save to Recipes, so the model cannot present an invented recipe as the user's own, and
// must say a new idea is new. Who is eating goes as roles and ages only (Q12): the model gives
// adults and children's ages only when the user said them, else the household setting is read as
// ages, never a name. Words that look like a password never reach the route's model (rule 9).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSpec } from "../_shared/llm/index.ts";
import { localTime } from "./day.ts";
import { householdWho } from "./outing.ts";
import { recipeSuggest, type SuggestDeps } from "./recipe_suggest.ts";

export const SUGGEST_MEAL = "suggest_meal";
export const SUGGEST_COCKTAIL = "suggest_cocktail";
export const SUGGEST_NAMES = new Set([SUGGEST_MEAL, SUGGEST_COCKTAIL]);
/** What the app lists in "can" for the recipe cards. */
export const CAN_RECIPES = "recipes";

const COMMON =
  "From the user's OWN saved recipes only (searchable spaces). One call each time (counted: 10 a day, more with Pro). " +
  "The app shows the choices as cards with Open recipe; nothing is saved. Never present a recipe that is not in " +
  "the result as one of theirs. When nothing fits, offer A new idea (call again with new_idea true): it is clearly " +
  "new, not theirs, and is saved only if the user taps Save on its card.";

export const SUGGEST_SPECS: ToolSpec[] = [
  {
    name: SUGGEST_MEAL,
    description:
      "Chat app only. Suggests up to three meals to cook (\"what should I cook tonight?\", \"dinner with chicken and rice " +
      "in 30 minutes\", \"something vegetarian the kids will eat\"). " + COMMON + " Never put a name in it: give adults and " +
      "the children's ages only if the user said them, else leave them out and the household setting is used (ages only).",
    inputSchema: {
      type: "object",
      properties: {
        have: { type: "string", maxLength: 300, description: "What they have, in a few words (\"chicken, rice, spinach\"), only if they said" },
        minutes: { type: "integer", minimum: 5, maximum: 1440, description: "Only if they said how long they have" },
        kind: { type: "string", enum: ["anything", "vegetarian", "kid_friendly", "light"] },
        adults: { type: "integer", minimum: 0, maximum: 10, description: "Only if the user said" },
        child_ages: { type: "array", items: { type: "integer", minimum: 0, maximum: 17 }, maxItems: 10, description: "Only if the user said" },
        new_idea: { type: "boolean", description: "true: one new recipe that is NOT from their recipes (only when nothing fits or they ask for something new)" },
        avoid: { type: "array", items: { type: "string" }, maxItems: 30, description: "Ids already suggested, for \"another one\"" },
      },
      additionalProperties: false,
    },
  },
  {
    name: SUGGEST_COCKTAIL,
    description:
      "Chat app only. Suggests up to three cocktails to make (\"what can I make with gin and lime?\", \"something without " +
      "alcohol\"). " + COMMON + " \"No alcohol\" (strength none) is always fine to ask for.",
    inputSchema: {
      type: "object",
      properties: {
        have: { type: "string", maxLength: 300, description: "What is in their bar, in a few words, only if they said" },
        strength: { type: "string", enum: ["regular", "light", "none"], description: "none: no alcohol" },
        mood: { type: "string", enum: ["classic", "fruity", "surprise"] },
        new_idea: { type: "boolean", description: "true: one new cocktail that is NOT from their recipes (only when nothing fits or they ask for something new)" },
        avoid: { type: "array", items: { type: "string" }, maxItems: 30, description: "Ids already suggested, for \"another one\"" },
      },
      additionalProperties: false,
    },
  },
];

export interface ChatSuggestContext {
  db: SupabaseClient;
  token: string;
  userId: string;
  tz?: string;
  /** The app shows the recipe cards. */
  can: boolean;
}

const MEAL_KEYS = new Set(["have", "minutes", "kind", "adults", "child_ages", "new_idea", "avoid"]);
const COCKTAIL_KEYS = new Set(["have", "strength", "mood", "new_idea", "avoid"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const yearOf = (now: number, tz?: string) => Number((localTime(now, tz ?? "UTC") ?? new Date(now).toISOString()).slice(0, 4));

type Out = { isError: boolean; text: string; events: Record<string, unknown>[]; costCents: number };

/** suggest_meal or suggest_cocktail in the chat: the route's answer, as facts for the model and a card for the app. */
export async function suggestForChat(
  deps: SuggestDeps, ctx: ChatSuggestContext, name: string, input: Record<string, unknown>,
): Promise<Out> {
  let costCents = 0;
  const reply = (isError: boolean, facts: unknown, events: Record<string, unknown>[] = []): Out =>
    ({ isError, text: typeof facts === "string" ? facts : JSON.stringify(facts), events, costCents });
  const meal = name === SUGGEST_MEAL;
  const keys = meal ? MEAL_KEYS : COCKTAIL_KEYS;
  const extra = Object.keys(input).filter((k) => !keys.has(k));
  if (extra.length) {
    return reply(true, `${name} does not take ${extra.join(", ")}. ${meal ? "It takes have, minutes, kind, adults, child_ages, new_idea, avoid" : "It takes have, strength, mood, new_idea, avoid"}. No names.`);
  }
  // Ids the model passes back for "another one" are only ever the route's own; anything else is dropped.
  const avoid = Array.isArray(input.avoid) ? input.avoid.filter((v): v is string => typeof v === "string" && UUID.test(v)) : [];
  const body: Record<string, unknown> = { mode: meal ? "meal" : "cocktail" };
  for (const k of meal ? ["have", "minutes", "kind"] : ["have", "strength", "mood"]) if (input[k] !== undefined) body[k] = input[k];
  if (input.new_idea === true) body.new_idea = true;
  if (avoid.length) body.avoid = avoid;
  if (meal) {
    const said = input.adults !== undefined || input.child_ages !== undefined;
    const who = said
      ? { adults: input.adults ?? 0, child_ages: input.child_ages ?? [] }
      : await householdWho(ctx.db, yearOf(deps.now?.() ?? Date.now(), ctx.tz));
    if (who && (who.adults || (Array.isArray(who.child_ages) && who.child_ages.length))) body.who = who;
  }
  const out = await recipeSuggest(deps, ctx.token, ctx.userId, body, undefined, { recordUsage: false, cost: (c) => (costCents = c) });
  const b = (out.body ?? {}) as Record<string, unknown>;
  const what = meal ? "recipe" : "cocktail";

  if (out.status === 400) return reply(true, `${name}: ${String((b as { error_description?: string }).error_description ?? "bad input")}. No names.`);
  if (out.status === 429) {
    return reply(false, {
      status: b.error,
      message: b.error === "limit"
        ? `Today's ${b.limit ?? ""} suggestions are used up. Say they can ask again tomorrow (more with Wilma Pro).`
        : "This month's AI allowance is used up. Say so in one sentence.",
    });
  }
  if (out.status !== 200) return reply(true, "No suggestion could be made just now (a connection problem). Say so in one sentence.");

  if (b.reason === "credential") {
    return reply(false, {
      status: "credential",
      message: "What they said they have looks like a password, so it was not used and nothing was suggested. Say Wilma never " +
        "uses passwords here and that they belong in the Vault; do not repeat it.",
    });
  }
  if (body.new_idea) {
    const idea = b.idea as { title: string; fields: Record<string, unknown> } | null | undefined;
    if (!idea) return reply(false, { status: "no_idea", message: `No new ${what} could be made this time. Say so in one sentence.` });
    return reply(false, {
      status: "new_idea",
      new: true,
      title: idea.title,
      ...idea.fields,
      message: (ctx.can
        ? `The app shows this as a card marked NEW · NOT FROM YOUR RECIPES with Save to ${meal ? "Recipes" : "Cocktails"}. `
        : "This app cannot show the card: give the ingredients and steps in a few short lines. ") +
        `Say clearly it is a new idea, not one of their ${what}s, in one or two sentences from these facts only. ` +
        "Nothing was saved.",
    }, ctx.can ? [{ type: "recipe_idea", mode: body.mode, idea: { title: idea.title, fields: idea.fields }, usage: b.usage }] : []);
  }
  const list = Array.isArray(b.suggestions) ? (b.suggestions as Record<string, unknown>[]) : [];
  if (!list.length) {
    const none = b.reason === "none_fit";
    return reply(false, {
      status: none ? "none_fit" : "no_answer",
      ...(typeof b.recipes === "number" ? { saved: b.recipes } : {}),
      message: none
        ? (b.recipes
          ? `None of their ${b.recipes} saved ${what}s fits what they asked. Say so in one sentence and offer A new idea (call again with new_idea true). Never suggest a ${what} as theirs that is not in a result.`
          : `They have no ${what}s saved yet. Say so, suggest saving a few (a link from TikTok or a recipe site is enough), and offer A new idea.`)
        : "No choice came back this time. Say so in one sentence and offer to try again.",
    });
  }
  const facts = list.map((s) => ({
    id: s.id, title: s.title, ...(s.why ? { why: s.why } : {}), ...(s.missing ? { missing: s.missing } : {}),
    ...(s.minutes ? { minutes: s.minutes } : {}), ...(s.rating ? { rating: s.rating } : {}), ...(s.last_made ? { last_made: s.last_made } : {}),
    ...(s.source_site ? { from: s.source_site } : {}),
  }));
  return reply(false, {
    status: "shown",
    suggestions: facts,
    message: (ctx.can
      ? `The app shows these as cards with Open ${what}. Say them in two or three short sentences from these facts only; `
      : `This app cannot show the cards: name each ${what} in a short line from these facts only; `) +
      `they are the user's own saved ${what}s. Never add a ${what} that is not here. For "another one", call again with these ids in avoid.`,
  }, ctx.can ? [{ type: "recipe_suggestions", mode: body.mode, suggestions: list, usage: b.usage }] : []);
}
