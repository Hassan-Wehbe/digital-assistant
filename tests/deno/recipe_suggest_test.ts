// What's for dinner? and Make a cocktail (docs/recipes-plan.md step 5, D43): the short list (code,
// searchable spaces only, link notes in the built-in space count, too slow or alcoholic ones
// dropped), what the model is told (numbered facts, roles and ages, never an id or a name), the
// checks on its answers (numbers only from the list, a credential-like line dropped, a new idea
// checked like a recipe), and the route with a scripted model: the daily count, the AI allowance,
// "I have" words that look like a password never sent, nothing counted when nothing fits.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatRequest, StreamEvent } from "../../supabase/functions/_shared/llm/index.ts";
import {
  askLine, type Candidate, checkChoices, checkIdea, firstLink, recipeLine, type RecipeRow, recipeSuggest, readRecipes, shortlist,
  type SuggestBody, type SuggestLog, suggestPrompt,
} from "../../supabase/functions/chat/recipe_suggest.ts";
import { createHandler } from "../../supabase/functions/chat/chat.ts";

const TODAY = "2026-10-20";
const R = (id: string, title: string, fields: RecipeRow["fields"] = {}, tags: string[] = [], type: RecipeRow["type"] = "recipe"): RecipeRow =>
  ({ id: `00000000-0000-4000-8000-0000000000${id}`, title, type, fields, tags });

const ROWS: RecipeRow[] = [
  R("01", "Garlic butter shrimp", { ingredients: ["400 g shrimp", "4 cloves garlic", "butter"], minutes: 15, made: [{ on: "2026-09-01", rating: 5 }] }),
  R("02", "Slow beef stew", { ingredients: ["beef", "carrots", "onion"], minutes: 180 }),
  R("03", "Chickpea curry", { ingredients: ["chickpeas", "coconut milk", "spinach", "rice"], minutes: 30 }, ["vegetarian", "weeknight"]),
  R("04", "Lentil soup", { ingredients: ["red lentils", "carrots"], minutes: 25, made: [{ on: "2026-10-18", rating: 4 }] }),
  R("05", "Creamy pasta (TikTok)", {}, []),
];

const ask = (a: Partial<SuggestBody> = {}): SuggestBody => ({ mode: "meal", ...a });

// ---- The short list ------------------------------------------------------------------------------

Deno.test("short list: too slow dropped; what they have, ratings and not made lately rank first", () => {
  const list = shortlist(ROWS, ask({ minutes: 45, have: "rice, spinach, chickpeas" }), TODAY);
  assertFalse(list.some((c) => c.title === "Slow beef stew"), "180 minutes is over 45");
  assertEquals(list[0].title, "Chickpea curry", "three of their ingredients");
  assert(list.some((c) => c.title === "Creamy pasta (TikTok)"), "a link-only recipe (time unknown) still counts");
  const lentil = list.find((c) => c.title === "Lentil soup")!;
  const shrimp = list.find((c) => c.title === "Garlic butter shrimp")!;
  assert(shrimp.score > lentil.score, "rated 5 and not made lately beats made two days ago");
});

Deno.test("short list: what was just shown is left out; vegetarian ranks the tagged ones first", () => {
  const list = shortlist(ROWS, ask({ kind: "vegetarian", avoid: [ROWS[2].id] }), TODAY);
  assertFalse(list.some((c) => c.id === ROWS[2].id));
  assertEquals(shortlist(ROWS, ask({ kind: "vegetarian" }), TODAY)[0].title, "Chickpea curry");
});

Deno.test("short list: no alcohol keeps only cocktails known to have none; light drops the regular ones", () => {
  const drinks = [
    R("11", "Negroni", { strength: "regular" }, [], "cocktail"),
    R("12", "Virgin mojito", {}, [], "cocktail"),
    R("13", "Spritz", { strength: "light" }, [], "cocktail"),
    R("14", "Paloma", {}, [], "cocktail"),
    R("15", "Shirley Temple", { strength: "none" }, [], "cocktail"),
    R("16", "Fizz", {}, ["mocktail"], "cocktail"),
  ];
  assertEquals(shortlist(drinks, { mode: "cocktail", strength: "none" }, TODAY).map((c) => c.title).sort(), ["Fizz", "Shirley Temple", "Virgin mojito"]);
  assertFalse(shortlist(drinks, { mode: "cocktail", strength: "light" }, TODAY).some((c) => c.title === "Negroni"));
  assertEquals(shortlist(drinks, { mode: "cocktail" }, TODAY).length, 6);
});

Deno.test("short list: at most 25", () => {
  const many = Array.from({ length: 40 }, (_, n) => R(String(n + 20).padStart(2, "0"), `Dish ${n}`));
  assertEquals(shortlist(many, ask(), TODAY).length, 25);
});

// ---- What the model is told ----------------------------------------------------------------------

Deno.test("the prompt: numbered facts, no ids; roles and ages only; a link note says so", () => {
  const cands = shortlist(ROWS, ask(), TODAY);
  const p = suggestPrompt(ask({ have: "rice", who: { adults: 2, child_ages: [9, 6] }, minutes: 30 }), cands, TODAY);
  assert(p.startsWith("Asked: A meal, ready in 30 minutes or less, for 2 adults, children aged 6 and 9.\nThey have: rice"), p);
  for (const r of ROWS) assertFalse(p.includes(r.id), "never an id");
  assert(p.includes("link only"), p);
  assert(recipeLine(1, ROWS[0], TODAY).includes("rated 5/5 · last made 49 days ago · ingredients: 400 g shrimp; 4 cloves garlic; butter"));
  assertEquals(askLine({ mode: "cocktail", strength: "none", mood: "fruity" }), "A cocktail, no alcohol, something fruity.");
});

// ---- The checks ----------------------------------------------------------------------------------

const CANDS: Candidate[] = ROWS.map((r, i) => ({ ...r, score: 5 - i }));

Deno.test("choices: numbers only from the list, each once, at most 3; why and missing checked", () => {
  const out = checkChoices(JSON.stringify({
    choices: [
      { n: 3, why: "30 minutes and you have the rice", missing: ["coconut milk"] },
      { n: 3, why: "again" },
      { n: 9, why: "invented" },
      { n: 1.5, why: "odd" },
      { n: 1, why: "Your favourite, rated 5", missing: ["the wifi password is Sunflower2024!"] },
      { n: 4, why: "my PIN is 4821" },
      { n: 2, why: "a fourth one" },
    ],
  }), CANDS)!;
  assertEquals(out.picks.map((p) => p.c.title), ["Chickpea curry", "Garlic butter shrimp", "Lentil soup"]);
  assertEquals(out.picks[0].missing, ["coconut milk"]);
  assertFalse("missing" in out.picks[1], "the credential-like line is dropped");
  assertEquals(out.picks[2].why, "", "a credential-like why is blanked");
  assertEquals(out.dropped, 5);
  assertEquals(checkChoices("Try the curry!", CANDS), null);
  assertEquals(checkChoices('{"choices": []}', CANDS), { picks: [], dropped: 0 });
});

Deno.test("a new idea is checked like a recipe, with a title", () => {
  assertEquals(
    checkIdea('{"title":"Lemon chicken","ingredients":["2 chicken breasts","1 lemon"],"steps":["1. Season","Roast 25 min"],"minutes":35,"serves":2}', "recipe"),
    { title: "Lemon chicken", fields: { ingredients: ["2 chicken breasts", "1 lemon"], steps: ["Season", "Roast 25 min"], minutes: 35, serves: 2 } },
  );
  assertEquals(checkIdea('{"ingredients":["x"]}', "recipe"), null, "no title");
  assertEquals(checkIdea('{"title":"password: Hunter2!","ingredients":["x"]}', "recipe"), null);
  assertEquals(checkIdea("not json", "recipe"), null);
});

Deno.test("a note's first web link and its site", () => {
  assertEquals(firstLink("Saw this https://www.tiktok.com/@cook/video/1."), { url: "https://www.tiktok.com/@cook/video/1", site: "TikTok" });
  assertEquals(firstLink("https://blog.example/pasta"), { url: "https://blog.example/pasta" });
  assertEquals(firstLink("https://me:pw@example.com/x"), undefined);
  assertEquals(firstLink("no link"), undefined);
});

// ---- Reading the recipes and the route -----------------------------------------------------------

const SPACES = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Recipes", description: null, parent_id: null, is_restricted: false, built_in: "recipes" },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Cocktails", description: null, parent_id: null, is_restricted: false, built_in: "cocktails" },
  { id: "a0000000-0000-4000-8000-000000000003", name: "Private", description: null, parent_id: null, is_restricted: true, built_in: null },
  { id: "a0000000-0000-4000-8000-000000000004", name: "Work", description: null, parent_id: null, is_restricted: false, built_in: null },
];
const ITEMS = [
  { id: ROWS[0].id, title: "Garlic butter shrimp", item_type: "recipe", space_id: SPACES[0].id, metadata: { ingredients: ["shrimp", "garlic"], minutes: 15 }, body_markdown: "", deleted_at: null, item_tag: [{ tag: { name: "Weeknight" } }] },
  { id: ROWS[4].id, title: "Creamy pasta (TikTok)", item_type: "note", space_id: SPACES[0].id, metadata: {}, body_markdown: "https://www.tiktok.com/@cook/video/1", deleted_at: null, item_tag: [] },
  { id: "00000000-0000-4000-8000-0000000000a1", title: "Secret family sauce", item_type: "recipe", space_id: SPACES[2].id, metadata: { ingredients: ["tomatoes"] }, body_markdown: "", deleted_at: null, item_tag: [] },
  { id: "00000000-0000-4000-8000-0000000000a2", title: "Meeting notes", item_type: "note", space_id: SPACES[3].id, metadata: {}, body_markdown: "", deleted_at: null, item_tag: [] },
  { id: "00000000-0000-4000-8000-0000000000a3", title: "Team lunch pasta", item_type: "recipe", space_id: SPACES[3].id, metadata: { cuisine: "Italian", minutes: 20 }, body_markdown: "", deleted_at: null, item_tag: [] },
  { id: "00000000-0000-4000-8000-0000000000a4", title: "Old binned recipe", item_type: "recipe", space_id: SPACES[0].id, metadata: {}, body_markdown: "", deleted_at: "2026-10-01", item_tag: [] },
];

function setup(answer: string, gate: Record<string, unknown> = { allowed: true, used: 3, limit: 10, pro: false }, usedFraction = 0.1) {
  const rpcs: string[] = [];
  const prompts: ChatRequest[] = [];
  const logs: SuggestLog[] = [];
  const chain = (rows: unknown[]) => {
    const q = {
      select: () => q, in: () => q, is: () => q, eq: () => q, limit: () => Promise.resolve({ data: rows, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    };
    return q;
  };
  const db = {
    from: (t: string) => chain(t === "space" ? SPACES : ITEMS),
    rpc: (name: string) => {
      rpcs.push(name);
      if (name === "searchable_space_ids") return Promise.resolve({ data: SPACES.filter((s) => !s.is_restricted).map((s) => s.id), error: null });
      if (name === "use_recipe_suggestion") return Promise.resolve({ data: gate, error: null });
      if (name === "my_ai_allowance") return Promise.resolve({ data: { used_fraction: usedFraction }, error: null });
      if (name === "record_ai_usage") return Promise.resolve({ data: {}, error: null });
      return Promise.resolve({ data: null, error: { code: "42883" } });
    },
  } as unknown as SupabaseClient;
  const deps = {
    clientFor: () => db,
    llm: () => ({
      async *stream(_route: string, req: ChatRequest): AsyncGenerator<StreamEvent> {
        prompts.push(req);
        yield {
          type: "done", turn: { role: "assistant", text: answer, toolCalls: [] }, stop: "end",
          usage: { inputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 120, costCents: 0.05 },
        } as StreamEvent;
      },
    }),
    log: (e: SuggestLog) => logs.push(e),
    now: () => Date.parse(`${TODAY}T18:00:00Z`),
  };
  return { db, deps, rpcs, prompts, logs };
}

Deno.test("reading: searchable spaces only (rule 3); link notes only in the built-in space; old fields kept leniently", async () => {
  const s = setup("{}");
  const rows = await readRecipes(s.db, "recipe");
  assertEquals(rows.map((r) => r.title).sort(), ["Creamy pasta (TikTok)", "Garlic butter shrimp", "Team lunch pasta"]);
  assertFalse(rows.some((r) => r.title === "Secret family sauce"), "a recipe in a restricted space is never read");
  assertFalse(rows.some((r) => r.title === "Meeting notes"), "a note elsewhere is not a recipe");
  assertEquals(rows.find((r) => r.title === "Creamy pasta (TikTok)")!.link, { url: "https://www.tiktok.com/@cook/video/1", site: "TikTok" });
  assertEquals(rows.find((r) => r.title === "Team lunch pasta")!.fields, { minutes: 20 }, "an unknown old field is left out, the rest kept");
  assertEquals(rows.find((r) => r.title === "Garlic butter shrimp")!.tags, ["weeknight"]);
});

// The short list's order here: the shrimp (has ingredients, matches "have"), then the two without
// ingredients, alphabetically: 2 Creamy pasta (TikTok), 3 Team lunch pasta.
const PICK = '{"choices":[{"n":1,"why":"Quick and a favourite"},{"n":2,"why":"From your TikTok"}]}';

Deno.test("route: suggestions come back with their facts; counted, the AI allowance checked, recorded", async () => {
  const s = setup(PICK);
  const out = await recipeSuggest(s.deps, "tok", "u1", { mode: "meal", have: "shrimp" });
  assertEquals(out.status, 200);
  const body = out.body as { suggestions: Record<string, unknown>[]; usage: unknown };
  assertEquals(body.suggestions.map((x) => x.title), ["Garlic butter shrimp", "Creamy pasta (TikTok)"]);
  assertEquals(body.suggestions[0], { id: ROWS[0].id, title: "Garlic butter shrimp", type: "recipe", why: "Quick and a favourite", minutes: 15 });
  assertEquals(body.usage, { used: 3, limit: 10 });
  assertEquals(s.rpcs.filter((r) => r !== "searchable_space_ids"), ["use_recipe_suggestion", "my_ai_allowance", "record_ai_usage"]);
  const prompt = JSON.stringify(s.prompts[0].messages);
  assertFalse(prompt.includes("Secret family sauce"), "a restricted recipe never reaches the model");
  assertFalse(JSON.stringify(s.logs).includes("shrimp"), "the log holds counts only");
});

Deno.test("route: a link note's link comes back so the app can open it", async () => {
  const s = setup('{"choices":[{"n":2,"why":"Saved from TikTok"}]}');
  const out = await recipeSuggest(s.deps, "tok", "u1", { mode: "meal" });
  const sug = (out.body as { suggestions: Record<string, unknown>[] }).suggestions[0];
  assertEquals([sug.title, sug.source_site, sug.source_url], ["Creamy pasta (TikTok)", "TikTok", "https://www.tiktok.com/@cook/video/1"]);
});

Deno.test("route: \"I have\" words that look like a password never reach the model, and nothing is counted", async () => {
  const s = setup(PICK);
  const out = await recipeSuggest(s.deps, "tok", "u1", { mode: "meal", have: "chicken, and my wifi password is Sunflower2024!" });
  assertEquals(out, { status: 200, body: { suggestions: [], reason: "credential" } });
  assertEquals(s.prompts.length, 0);
  assertEquals(s.rpcs, []);
});

Deno.test("route: nothing fits: no AI request, not counted, the count is of searchable recipes only", async () => {
  const s = setup(PICK);
  const out = await recipeSuggest(s.deps, "tok", "u1", { mode: "meal", minutes: 10, avoid: [ROWS[4].id] });
  assertEquals(out, { status: 200, body: { suggestions: [], reason: "none_fit", recipes: 3 } });
  assertEquals(s.prompts.length, 0);
  assertFalse(s.rpcs.includes("use_recipe_suggestion"));
});

Deno.test("route: over the day's limit, or the AI allowance used up", async () => {
  const s = setup(PICK, { allowed: false, reason: "limit", used: 10, limit: 10, pro: false });
  assertEquals(await recipeSuggest(s.deps, "tok", "u1", { mode: "meal" }), { status: 429, body: { error: "limit", used: 10, limit: 10 } });
  assertEquals(s.prompts.length, 0);
  const a = setup(PICK, undefined, 1);
  assertEquals(await recipeSuggest(a.deps, "tok", "u1", { mode: "meal" }), { status: 429, body: { error: "allowance_used" } });
  assertEquals(a.prompts.length, 0);
});

Deno.test("route: a new idea is one checked recipe, marked new, never saved; it avoids their titles", async () => {
  const s = setup('{"title":"Lemon chicken","ingredients":["2 chicken breasts","1 lemon"],"steps":["Roast 25 minutes"],"minutes":35}');
  const out = await recipeSuggest(s.deps, "tok", "u1", { mode: "meal", new_idea: true, have: "chicken" });
  assertEquals(out.body, {
    idea: { title: "Lemon chicken", fields: { ingredients: ["2 chicken breasts", "1 lemon"], steps: ["Roast 25 minutes"], minutes: 35 } },
    new: true,
    usage: { used: 3, limit: 10 },
  });
  assert(JSON.stringify(s.prompts[0].messages).includes("They already have: Garlic butter shrimp"));
  assertFalse(JSON.stringify(s.prompts[0].messages).includes("Secret family sauce"));
  assertEquals(s.prompts[0].system.includes("one they have not saved"), true);
});

Deno.test("route: an answer with no usable choice says so; a malformed body or a name field is refused", async () => {
  const s = setup('{"choices":[{"n":42}]}');
  const out = await recipeSuggest(s.deps, "tok", "u1", { mode: "meal" });
  assertEquals((out.body as { reason: string }).reason, "none_fit");
  for (const raw of [{ mode: "dessert" }, { mode: "meal", minutes: 2 }, { mode: "meal", who: { adults: 2, child_ages: [6], names: ["Sam"] } }, { mode: "meal", space: "Work" }]) {
    const b = setup(PICK);
    assertEquals((await recipeSuggest(b.deps, "tok", "u1", raw)).status, 400, JSON.stringify(raw));
    assertEquals(b.prompts.length + b.rpcs.length, 0);
  }
});

Deno.test("the chat function answers {mode: meal} and {mode: cocktail}, only when signed in", async () => {
  const s = setup(PICK);
  const h = createHandler({ verifyToken: (t) => Promise.resolve(t === "tok" ? "u" : null), clientFor: s.deps.clientFor, llm: s.deps.llm, log: () => {} });
  const call = (token: string, mode: string) =>
    h(new Request("http://localhost/chat", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ mode }) }));
  assertEquals((await call("nope", "meal")).status, 401);
  assertEquals((await call("tok", "meal")).status, 200);
  assertEquals((await call("tok", "cocktail")).status, 200);
});
