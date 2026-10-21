// Drinks and age (docs/age-plan.md step 2, D44): under 21, or until the age is given (is_21()),
// every drink is a mocktail, whatever the app or the model asks: saving (save_item, update_item),
// the suggestions and A new idea (the route and the chat's suggest_cocktail), the drinks space's
// name (list_spaces), and the chat's own answers (a line in the system prompt). 21 and over is
// unchanged. Run on the evaluation's pretend account with a scripted model.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { ChatRequest, StreamEvent } from "../../supabase/functions/_shared/llm/index.ts";
import { systemPrompt, UNDER_21_LINE } from "../../supabase/functions/_shared/assistant_prompt.ts";
import { MOCKTAILS_ONLY, SUGGEST_COCKTAIL, suggestForChat } from "../../supabase/functions/chat/recipe_chat.ts";
import { checkIdea } from "../../supabase/functions/chat/recipe_suggest.ts";
import { drinkHasAlcohol, namesAlcohol, UNDER_21 } from "../../supabase/functions/mcp/lib/recipes.ts";
import { openSession } from "../eval/harness.ts";
import { addCookbook, BOOK, World } from "../eval/world.ts";

const world = (is21: boolean) => {
  const w = new World();
  addCookbook(w);
  w.is21 = is21;
  return w;
};

Deno.test("the alcohol words: spirits, wine, beer and liqueurs; not ginger beer, non-alcoholic wine or vanilla extract", () => {
  for (const t of ["2 oz vodka", "a splash of gin", "white rum", "triple sec", "Aperol", "prosecco", "a can of beer", "whiskey sour", "bitters"]) {
    assert(namesAlcohol(t), t);
  }
  for (const t of ["ginger beer", "ginger ale", "non-alcoholic wine", "alcohol-free gin", "vanilla extract", "rum extract", "red wine vinegar", "Virgin mojito", "ginger", "lime", "tonic water", "bitter lemon"]) {
    assertFalse(namesAlcohol(t), t);
  }
  assert(drinkHasAlcohol("Mojito", { strength: "regular" }));
  assert(drinkHasAlcohol("Spritz", {}), "no strength set counts as alcohol");
  assert(drinkHasAlcohol("Cooler", { strength: "none", ingredients: ["60 ml vodka"] }), "\"none\" with vodka in it is not a mocktail");
  assertFalse(drinkHasAlcohol("Cucumber cooler", { strength: "none", ingredients: ["cucumber", "ginger beer"] }));
});

Deno.test("saving under 21: a drink with alcohol is refused; a mocktail saves; Made it on an older cocktail still works", async () => {
  const w = world(false);
  const s = await openSession(w);
  const bad = await s.call("save_item", {
    space: "Cocktails", title: "Margarita", body: "", item_type: "cocktail",
    metadata: { ingredients: ["2 oz tequila", "1 oz lime", "1 oz triple sec"], strength: "regular" },
  });
  assert(bad.isError);
  assert(bad.text.includes(UNDER_21));
  const sneaky = await s.call("save_item", {
    space: "Cocktails", title: "Lime cooler", body: "", item_type: "cocktail",
    metadata: { ingredients: ["60 ml vodka", "lime"], strength: "none" },
  });
  assert(sneaky.isError, "strength none with vodka in it");
  const ok = await s.call("save_item", {
    space: "Cocktails", title: "Lime cooler", body: "", item_type: "cocktail",
    metadata: { ingredients: ["lime", "ginger beer", "mint"], strength: "none" },
  });
  assertFalse(ok.isError, ok.text);
  const madeIt = await s.call("update_item", { item_id: BOOK.mojito, made_it: { on: "2026-10-20", rating: 4 } });
  assertFalse(madeIt.isError, madeIt.text);
  const change = await s.call("update_item", { item_id: BOOK.mojito, metadata: { ingredients: ["50 ml white rum", "mint", "lime"], strength: "regular" } });
  assert(change.isError, "changing a cocktail's fields under 21");
  await s.close();
});

Deno.test("saving at 21 or over: unchanged", async () => {
  const s = await openSession(world(true));
  const out = await s.call("save_item", {
    space: "Cocktails", title: "Margarita", body: "", item_type: "cocktail",
    metadata: { ingredients: ["2 oz tequila", "1 oz lime", "1 oz triple sec"], strength: "regular" },
  });
  assertFalse(out.isError, out.text);
  await s.close();
});

Deno.test("the drinks space: Mocktails under 21, Cocktails from 21, set when spaces are listed", async () => {
  for (const [is21, name] of [[false, "Mocktails"], [true, "Cocktails"]] as const) {
    const s = await openSession(world(is21));
    const listed = JSON.parse((await s.call("list_spaces", {})).text) as { spaces: { path: string; built_in?: string }[] };
    assertEquals(listed.spaces.find((x) => x.built_in === "cocktails")?.path, name);
    await s.close();
  }
});

/** A model that picks the drinks whose titles match, or answers `raw`. */
function deps(w: World, pick: RegExp[] | string) {
  const prompts: ChatRequest[] = [];
  return {
    prompts,
    deps: {
      clientFor: () => w.client(),
      llm: () => ({
        async *stream(_route: string, req: ChatRequest): AsyncGenerator<StreamEvent> {
          prompts.push(req);
          let text = typeof pick === "string" ? pick : "";
          if (Array.isArray(pick)) {
            const first = req.messages[0];
            const lines = (first.role === "user" ? String(first.content) : "").split("\n");
            const ns = pick.map((re) => lines.find((l) => re.test(l))?.match(/^(\d+)\./)?.[1]).filter(Boolean);
            text = JSON.stringify({ choices: ns.map((n) => ({ n: Number(n), why: "add a shot of vodka" })) });
          }
          yield {
            type: "done", turn: { role: "assistant", text, toolCalls: [] }, stop: "end",
            usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50, costCents: 0.02 },
          } as StreamEvent;
        },
      }),
      log: () => {},
    },
  };
}

Deno.test("suggestions under 21: mocktails only, whatever was asked; a why line naming alcohol is dropped", async () => {
  const w = world(false);
  const d = deps(w, [/Gin basil/, /Virgin cucumber/, /Mojito/]);
  const ctx = { db: w.client(), token: "t", userId: "eval-user", can: true };
  const out = await suggestForChat(d.deps, ctx, SUGGEST_COCKTAIL, { have: "gin, lime", strength: "regular" });
  const facts = JSON.parse(out.text);
  assertEquals(facts.suggestions.map((x: { title: string }) => x.title), ["Virgin cucumber cooler"]);
  assertEquals(facts.mocktails_only, true);
  assert(facts.message.endsWith(MOCKTAILS_ONLY));
  assertFalse("why" in facts.suggestions[0], "\"add a shot of vodka\" is dropped");
  assertFalse(JSON.stringify(d.prompts[0].messages).includes("Gin basil"), "the drinks with alcohol never reach the model");
  assert(JSON.stringify(d.prompts[0].messages).includes("no alcohol"));
});

Deno.test("A new idea under 21: one that names alcohol is refused; a mocktail comes back with strength none", async () => {
  const w = world(false);
  const ctx = { db: w.client(), token: "t", userId: "eval-user", can: true };
  const boozy = deps(w, '{"title":"Vodka lemonade","ingredients":["50 ml vodka","lemonade"],"steps":["Mix"]}');
  assertEquals(JSON.parse((await suggestForChat(boozy.deps, ctx, SUGGEST_COCKTAIL, { new_idea: true })).text).status, "no_idea");
  const fine = deps(w, '{"title":"Ginger fizz","ingredients":["ginger beer","lime","mint"],"steps":["Build over ice"]}');
  const out = await suggestForChat(fine.deps, ctx, SUGGEST_COCKTAIL, { new_idea: true });
  const facts = JSON.parse(out.text);
  assertEquals([facts.status, facts.strength, facts.mocktails_only], ["new_idea", "none", true]);
  assert(facts.message.includes("Save to Mocktails"));
  assertEquals(checkIdea('{"title":"Vodka lemonade","ingredients":["50 ml vodka"],"steps":["Mix"]}', "cocktail", true), null);
});

Deno.test("21 or over: cocktails as before, no mocktails line", async () => {
  const w = world(true);
  const d = deps(w, [/Gin basil/]);
  const out = await suggestForChat(d.deps, { db: w.client(), token: "t", userId: "eval-user", can: true }, SUGGEST_COCKTAIL, { have: "gin" });
  const facts = JSON.parse(out.text);
  assertEquals(facts.suggestions[0].title, "Gin basil smash");
  assertFalse("mocktails_only" in facts);
});

Deno.test("the chat's own answers: the under-21 line is in the prompt only under 21, and never the age", () => {
  const under = systemPrompt("Wilma", "INSTRUCTIONS", new Date("2026-10-21T08:00:00Z"), undefined, undefined, [], true);
  const adult = systemPrompt("Wilma", "INSTRUCTIONS", new Date("2026-10-21T08:00:00Z"));
  assert(under.includes(UNDER_21_LINE));
  assertFalse(adult.includes("under 21"));
  assertEquals(under.replace("\n" + UNDER_21_LINE + "\n", ""), adult, "nothing else changes");
  const chat = Deno.readTextFileSync(new URL("../../supabase/functions/chat/chat.ts", import.meta.url));
  assert(chat.includes("systemPrompt(assistantName, tools.instructions, new Date(), here, tz, about, !adult)"));
});
