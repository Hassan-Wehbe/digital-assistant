// What's for dinner? and Make a cocktail in the chat (docs/recipes-plan.md step 7, D43):
// suggest_meal and suggest_cocktail run the suggestion route on the user's own recipes (the
// evaluation's pretend account with its cookbook), with a scripted model. A restricted recipe never
// reaches the model, the facts or a card (rule 3); the household goes as ages only and a name
// field is refused; a password-like "I have" never reaches the model (rule 9); A new idea is marked
// new and nothing is saved; the AI request is counted with the chat message, not recorded twice.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatRequest, StreamEvent } from "../../supabase/functions/_shared/llm/index.ts";
import { ACTION_NAMES, ChatActions } from "../../supabase/functions/chat/actions.ts";
import { SUGGEST_COCKTAIL, SUGGEST_MEAL, suggestForChat } from "../../supabase/functions/chat/recipe_chat.ts";
import type { SuggestLog } from "../../supabase/functions/chat/recipe_suggest.ts";
import { addCookbook, BOOK, World } from "../eval/world.ts";

/** A model that picks the recipes whose titles match, by their number in the prompt, or answers `raw`. */
function setup(pick: RegExp[] | string, prepare?: (w: World) => void) {
  const world = new World();
  addCookbook(world);
  prepare?.(world);
  const rpcs: string[] = [];
  const prompts: ChatRequest[] = [];
  const logs: SuggestLog[] = [];
  const inner = world.client();
  const db = {
    from: (t: string) => inner.from(t),
    rpc: (name: string, args?: Record<string, unknown>) => {
      rpcs.push(name);
      return inner.rpc(name, args);
    },
  } as unknown as SupabaseClient;
  const deps = {
    clientFor: () => db,
    llm: () => ({
      async *stream(_route: string, req: ChatRequest): AsyncGenerator<StreamEvent> {
        prompts.push(req);
        let text = typeof pick === "string" ? pick : "";
        if (Array.isArray(pick)) {
          const first = req.messages[0];
          const lines = (first.role === "user" ? String(first.content) : "").split("\n");
          const ns = pick.map((re) => lines.find((l) => re.test(l))?.match(/^(\d+)\./)?.[1]).filter(Boolean);
          text = JSON.stringify({ choices: ns.map((n) => ({ n: Number(n), why: "fits what you have", missing: ["coconut milk"] })) });
        }
        yield {
          type: "done", turn: { role: "assistant", text, toolCalls: [] }, stop: "end",
          usage: { inputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 80, costCents: 0.05 },
        } as StreamEvent;
      },
    }),
    log: (e: SuggestLog) => logs.push(e),
    now: () => Date.parse("2026-10-20T18:00:00Z"),
  };
  const ctx = { db, token: "tok", userId: "eval-user", tz: "Asia/Beirut", can: true };
  return { world, db, deps, ctx, rpcs, prompts, logs };
}

Deno.test("suggest_meal: the user's own recipes as a card and facts; counted with the message, not recorded twice", async () => {
  const s = setup([/Chickpea and spinach curry/, /Red lentil soup/]);
  const out = await suggestForChat(s.deps, s.ctx, SUGGEST_MEAL, { have: "chickpeas, spinach, rice" });
  assertFalse(out.isError);
  const facts = JSON.parse(out.text);
  assertEquals(facts.status, "shown");
  assertEquals(facts.suggestions.map((x: { title: string }) => x.title), ["Chickpea and spinach curry", "Red lentil soup"]);
  assertEquals(facts.suggestions[0].id, BOOK.curry, "the id, for \"another one\"");
  assertEquals(facts.suggestions[0].rating, 5);
  assert(facts.message.includes("Never add a recipe that is not here"));
  assertEquals(out.events.length, 1);
  assertEquals(out.events[0].type, "recipe_suggestions");
  assertEquals((out.events[0].suggestions as { id: string }[]).map((x) => x.id), [BOOK.curry, "00000000-0000-4000-8000-0000000000b2"]);
  assertEquals(out.costCents, 0.05, "the message's cost includes the suggestion's AI request");
  assert(s.rpcs.includes("use_recipe_suggestion"), "the same daily count as the screens");
  assertFalse(s.rpcs.includes("record_ai_usage"), "recorded once, with the chat message");
  assertEquals(s.world.suggestionsUsed, 1);
});

Deno.test("suggest_meal: a restricted recipe never reaches the model, the facts or a card (rule 3)", async () => {
  const s = setup([/lasagna/i, /Chickpea/]);
  const out = await suggestForChat(s.deps, s.ctx, SUGGEST_MEAL, { have: "beef mince, ricotta" });
  const prompt = JSON.stringify(s.prompts[0].messages);
  assertFalse(/lasagna|ricotta sheets|passata/i.test(prompt));
  assertFalse(out.text.includes("lasagna") || out.text.includes(BOOK.lasagna));
  assertFalse(JSON.stringify(out.events).includes(BOOK.lasagna));
});

Deno.test("suggest_meal: the household as ages only; a name field is refused before anything runs", async () => {
  const s = setup([/Chickpea/], (w) => {
    w.household = [
      { label: "Rania", kind: "adult", birth_year: null },
      { label: "Lea", kind: "child", birth_year: 2019 },
    ];
  });
  await suggestForChat(s.deps, s.ctx, SUGGEST_MEAL, {});
  const prompt = JSON.stringify(s.prompts[0].messages);
  assert(prompt.includes("1 adult") && prompt.includes("7"), `who is eating, as roles and ages: ${prompt}`);
  assertFalse(/Rania|Lea/.test(prompt), "never a name");

  const said = setup([/Chickpea/]);
  await suggestForChat(said.deps, said.ctx, SUGGEST_MEAL, { adults: 2, child_ages: [4] });
  assert(JSON.stringify(said.prompts[0].messages).includes("4"));

  const bad = setup([/Chickpea/]);
  const out = await suggestForChat(bad.deps, bad.ctx, SUGGEST_MEAL, { names: ["Lea"] });
  assert(out.isError);
  assert(out.text.includes("does not take names"));
  assertEquals(bad.prompts.length + bad.rpcs.length, 0);
});

Deno.test("suggest_meal: a password in \"I have\" never reaches the model, nothing is counted", async () => {
  const s = setup([/Chickpea/]);
  const out = await suggestForChat(s.deps, s.ctx, SUGGEST_MEAL, { have: "chicken, rice, my bank PIN is 4821" });
  assertEquals(JSON.parse(out.text).status, "credential");
  assertFalse(out.text.includes("4821"));
  assertEquals(out.events, []);
  assertEquals(s.prompts.length, 0);
  assertEquals(s.world.suggestionsUsed, 0);
});

Deno.test("suggest_cocktail: no alcohol never offers one with alcohol, even when the model names it", async () => {
  const s = setup([/Gin basil smash/, /Virgin cucumber cooler/, /Mojito/]);
  const out = await suggestForChat(s.deps, s.ctx, SUGGEST_COCKTAIL, { have: "mint, lime, tonic", strength: "none" });
  const titles = JSON.parse(out.text).suggestions.map((x: { title: string }) => x.title);
  assertEquals(titles, ["Virgin cucumber cooler"]);
  assertFalse(JSON.stringify(s.prompts[0].messages).includes("Gin basil"), "the short list already left it out");
});

Deno.test("A new idea: marked new, said to be new, a card to save; nothing is saved", async () => {
  const s = setup('{"title":"Shrimp sushi bowl","ingredients":["rice","cooked shrimp","cucumber"],"steps":["Cook the rice","Top it"],"minutes":30}');
  const items = s.world.items.length;
  const out = await suggestForChat(s.deps, s.ctx, SUGGEST_MEAL, { new_idea: true });
  const facts = JSON.parse(out.text);
  assertEquals([facts.status, facts.new, facts.title], ["new_idea", true, "Shrimp sushi bowl"]);
  assert(facts.message.includes("not one of their recipes"));
  assertEquals(out.events[0].type, "recipe_idea");
  assertEquals(s.world.items.length, items, "saved only by the user's tap on the card");
});

Deno.test("nothing fits: says how many they have and offers A new idea; no AI request, not counted", async () => {
  // Their only cocktail without alcohol was just shown: nothing else fits "No alcohol".
  const s = setup([/Virgin/]);
  const out = await suggestForChat(s.deps, s.ctx, SUGGEST_COCKTAIL, { strength: "none", avoid: [BOOK.virgin] });
  const facts = JSON.parse(out.text);
  assertEquals([facts.status, facts.saved], ["none_fit", 3]);
  assert(facts.message.includes("new_idea true"));
  assert(facts.message.includes("Never suggest a cocktail as theirs"));
  assertEquals(s.prompts.length, 0);
  assertEquals(s.world.suggestionsUsed, 0);
});

Deno.test("the day's limit; an older app gets facts and no card; ids for \"another one\" are only uuids", async () => {
  const s = setup([/Chickpea/], (w) => (w.suggestionsUsed = 10));
  const limited = JSON.parse((await suggestForChat(s.deps, s.ctx, SUGGEST_MEAL, {})).text);
  assertEquals(limited.status, "limit");
  assertEquals(s.prompts.length, 0);

  const old = setup([/Chickpea/]);
  const out = await suggestForChat(old.deps, { ...old.ctx, can: false }, SUGGEST_MEAL, { avoid: ["not-an-id", BOOK.stew] });
  assertEquals(out.events, []);
  assert(JSON.parse(out.text).message.includes("cannot show the cards"));
  assertFalse(JSON.stringify(old.prompts[0].messages).includes("Slow beef stew"), "the id passed back was left out");
});

Deno.test("the chat's actions: both tools are chat-only actions, run through the context", async () => {
  assert(ACTION_NAMES.has(SUGGEST_MEAL) && ACTION_NAMES.has(SUGGEST_COCKTAIL));
  const none = new ChatActions({ db: {} as SupabaseClient, distanceUnit: "km" });
  assert((await none.run(SUGGEST_MEAL, {})).isError);
  let seen = "";
  const actions = new ChatActions({
    db: {} as SupabaseClient, distanceUnit: "km",
    suggest: (name) => {
      seen = name;
      return Promise.resolve({ isError: false, text: "{}", events: [] });
    },
  });
  await actions.run(SUGGEST_COCKTAIL, { strength: "none" });
  assertEquals(seen, SUGGEST_COCKTAIL);
});
