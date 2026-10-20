// Recipes and cocktails (docs/recipes-plan.md step 2): the server checks a recipe's fields, adds
// them to search, keeps "made it" newest first, leaves the note's own text alone, and still refuses
// credentials in any of them (rule 9). A link note with no fields is still a recipe.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMade, isWebLink, normalizeRecipe, RecipeError, recipeText, recipeType, withRecipe,
} from "../../supabase/functions/mcp/lib/recipes.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";

const TODAY = "2026-10-20";

// ---- normalizeRecipe ---------------------------------------------------------------------------

Deno.test("only recipe and cocktail are recipe types", () => {
  assertEquals(recipeType("Recipe"), "recipe");
  assertEquals(recipeType(" cocktail "), "cocktail");
  assertEquals(recipeType("note"), null);
  assertEquals(recipeType(undefined), null);
});

Deno.test("a recipe with no fields is fine: a link note is still a recipe", () => {
  assertEquals(normalizeRecipe({}, "recipe", TODAY), {});
  assertEquals(normalizeRecipe(undefined, "cocktail", TODAY), {});
});

Deno.test("fields are tidied: lines, bullets, step numbers, numbers as text", () => {
  const r = normalizeRecipe({
    ingredients: "- 400 g shrimp\n\n• 4  cloves garlic\n* 3 tbsp butter\n",
    steps: ["1. Melt the butter.", "Step 2: Add 1.5 cups stock.", "3) Cook 1-2 minutes per side.", "  "],
    minutes: "25",
    serves: 4,
    source_url: "https://www.tiktok.com/@cook/video/123",
    source_site: " TikTok ",
  }, "recipe", TODAY);
  assertEquals(r, {
    ingredients: ["400 g shrimp", "4 cloves garlic", "3 tbsp butter"],
    steps: ["Melt the butter.", "Add 1.5 cups stock.", "Cook 1-2 minutes per side."],
    minutes: 25,
    serves: 4,
    source_url: "https://www.tiktok.com/@cook/video/123",
    source_site: "TikTok",
  });
});

Deno.test("a step that only starts with a quantity keeps it", () => {
  const r = normalizeRecipe({ steps: ["1.5 cups of stock go in last", "2 eggs, beaten, then fold", "10 minutes in the oven"] }, "recipe", TODAY);
  assertEquals(r.steps, ["1.5 cups of stock go in last", "2 eggs, beaten, then fold", "10 minutes in the oven"]);
});

Deno.test("a cocktail's strength reads everyday words; a recipe has none", () => {
  assertEquals(normalizeRecipe({ strength: "Mocktail" }, "cocktail", TODAY).strength, "none");
  assertEquals(normalizeRecipe({ strength: "non-alcoholic" }, "cocktail", TODAY).strength, "none");
  assertEquals(normalizeRecipe({ strength: "low" }, "cocktail", TODAY).strength, "light");
  assertEquals(normalizeRecipe({ strength: "Strong" }, "cocktail", TODAY).strength, "regular");
  assertThrows(() => normalizeRecipe({ strength: "light" }, "recipe", TODAY), RecipeError, "only for cocktails");
  assertThrows(() => normalizeRecipe({ strength: "tipsy" }, "cocktail", TODAY), RecipeError, "strength must be one of");
});

Deno.test("made: newest first, a rating 1-5, never in the future", () => {
  const r = normalizeRecipe({ made: [{ on: "2026-07-01", rating: 4 }, { on: "2026-10-19" }] }, "recipe", TODAY);
  assertEquals(r.made, [{ on: "2026-10-19" }, { on: "2026-07-01", rating: 4 }]);
  assertThrows(() => normalizeRecipe({ made: [{ on: "2026-11-30" }] }, "recipe", TODAY), RecipeError, "in the future");
  assertThrows(() => normalizeRecipe({ made: [{ on: "2026-10-01", rating: 6 }] }, "recipe", TODAY), RecipeError, "rating");
  assertThrows(() => normalizeRecipe({ made: [{ on: "2026-10-01", who: "Sam" }] }, "recipe", TODAY), RecipeError, 'unknown field "who"');
  assertThrows(() => normalizeRecipe({ made: [{ rating: 5 }] }, "recipe", TODAY), RecipeError, 'must have a date');
});

Deno.test("wrong fields are refused with a reason the model can act on", () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ cuisine: "Italian" }, 'unknown recipe field "cuisine"'],
    [{ minutes: 0 }, "minutes must be a whole number from 1 to 1440"],
    [{ minutes: 2.5 }, "minutes must be a whole number"],
    [{ serves: 500 }, "serves must be a whole number from 1 to 100"],
    [{ ingredients: 42 }, "ingredients must be a list of lines"],
    [{ ingredients: [{ name: "egg" }] }, "ingredients line 1 must be text"],
    [{ ingredients: Array.from({ length: 61 }, (_, n) => `item ${n}`) }, "more than 60 lines"],
    [{ ingredients: Array.from({ length: 500 }, () => "") }, "more than 60 lines"],
    [{ steps: ["x".repeat(1001)] }, "steps line 1 is longer than 1000 characters"],
    [{ source_url: "javascript:alert(1)" }, "source_url must be a web link"],
    [{ source_url: "https://me:secret@example.com/r" }, "source_url must be a web link"],
    [{ made: "yesterday" }, "made must be a list"],
  ];
  for (const [input, message] of bad) {
    assertThrows(() => normalizeRecipe(input, "recipe", TODAY), RecipeError, message, JSON.stringify(input));
  }
  assertThrows(() => normalizeRecipe({ glass: "coupe" }, "cocktail", TODAY), RecipeError, 'Cocktail not saved: unknown cocktail field "glass"');
});

Deno.test("only http(s) links without a name or password count as web links", () => {
  assert(isWebLink("https://www.bbcgoodfood.com/recipes/banana-bread"));
  assert(isWebLink("http://example.com/r"));
  assert(!isWebLink("ftp://example.com/r"));
  assert(!isWebLink("https://user@example.com/r"));
  assert(!isWebLink("not a link"));
});

Deno.test("addMade puts the time first, keeps the other fields, and defaults to today", () => {
  const current = { ingredients: ["shrimp"], made: [{ on: "2026-09-01", rating: 3 }] };
  assertEquals(addMade(current, { rating: 5 }, "recipe", TODAY), {
    ingredients: ["shrimp"], made: [{ on: TODAY, rating: 5 }, { on: "2026-09-01", rating: 3 }],
  });
  assertEquals(addMade({}, { on: "2026-10-18" }, "cocktail", TODAY), { made: [{ on: "2026-10-18" }] });
  // At most 50: the oldest goes.
  const many = { made: Array.from({ length: 50 }, (_, n) => ({ on: `2026-01-${String((n % 28) + 1).padStart(2, "0")}` })) };
  assertEquals(addMade(many, {}, "recipe", TODAY).made!.length, 50);
});

Deno.test("recipeText reads like the recipe, for meaning search; nothing when there are no fields", () => {
  const text = recipeText({
    ingredients: ["2 oz gin", "1 oz Campari"], steps: ["Stir with ice", "Strain"], minutes: 5, serves: 1,
    strength: "regular", source_site: "TikTok", made: [{ on: "2026-10-19" }, { on: "2026-09-01", rating: 5 }],
  });
  assertEquals(text, [
    "Ingredients:", "- 2 oz gin", "- 1 oz Campari", "Steps:", "1. Stir with ice", "2. Strain", "Time: 5 min", "Serves 1",
    "Regular strength", "From TikTok", "Made 2 times, last on 2026-10-19, rated 5/5",
  ].join("\n"));
  assertEquals(withRecipe("My note", {}), "My note");
  assertEquals(withRecipe("My note", null), "My note");
  assertEquals(withRecipe("", { minutes: 10 }), "Time: 10 min");
  assertEquals(withRecipe("My note", { strength: "none" }), "My note\n\nNo alcohol");
});

// ---- Through the tools -------------------------------------------------------------------------

const g = globalThis as Record<string, unknown>;
g.Supabase ??= { ai: { Session: class { run() { return Promise.resolve(new Array(384).fill(0.05)); } } } };
g.EdgeRuntime ??= { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const RECIPES = "22222222-2222-4222-8222-222222222222";
const COCKTAILS = "33333333-3333-4333-8333-333333333333";
const ITEM = "11111111-1111-4111-8111-111111111111";

function fakeDb(current?: Record<string, unknown>) {
  const rpcs: { name: string; params: Record<string, unknown> }[] = [];
  const db = {
    from: () => ({
      select: () =>
        Promise.resolve({
          data: [
            { id: RECIPES, name: "Recipes", description: null, parent_id: null, is_restricted: false, built_in: "recipes" },
            { id: COCKTAILS, name: "Cocktails", description: null, parent_id: null, is_restricted: false, built_in: "cocktails" },
          ],
          error: null,
        }),
    }),
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      if (name === "get_item") return Promise.resolve({ data: current ?? null, error: null });
      if (name === "save_item") return Promise.resolve({ data: ITEM, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { db, rpcs };
}

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db, userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerSaveItem, registerUpdateItem]) r(server, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const out = await res.json();
  return { isError: !!out.result.isError, text: out.result.content[0].text as string };
}

const chunkText = (params: Record<string, unknown>) =>
  (params.p_chunks as { content: string }[]).map((c) => c.content).join("\n");

Deno.test("save_item stores a checked recipe, keeps the note's text, and makes its fields searchable", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Recipes", title: "Garlic butter shrimp", body: "Mom's version, from TikTok.", item_type: "Recipe",
    metadata: { ingredients: ["400 g shrimp", "4 cloves garlic"], steps: "1. Melt butter\n2. Cook 2 minutes per side", minutes: 15 },
  });
  assertEquals(out.isError, false, out.text);
  const save = rpcs.find((r) => r.name === "save_item")!;
  assertEquals(save.params.p_metadata, {
    ingredients: ["400 g shrimp", "4 cloves garlic"], steps: ["Melt butter", "Cook 2 minutes per side"], minutes: 15,
  });
  assertEquals(save.params.p_body, "Mom's version, from TikTok.", "the note's own text is unchanged");
  assertEquals(save.params.p_space_id, RECIPES);
  const text = chunkText(save.params);
  assert(text.includes("- 400 g shrimp") && text.includes("2. Cook 2 minutes per side") && text.includes("Time: 15 min"), text);
});

Deno.test("save_item: a link-only recipe saves with empty fields", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Recipes", title: "Creamy pasta (TikTok)", body: "https://www.tiktok.com/@cook/video/1", item_type: "recipe",
  });
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "save_item")!.params.p_metadata, {});
});

Deno.test("save_item: a mocktail is a cocktail with no alcohol", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Cocktails", title: "Virgin mojito", body: "", item_type: "cocktail",
    metadata: { ingredients: ["mint", "lime", "soda"], strength: "no alcohol" },
  });
  assertEquals(out.isError, false, out.text);
  const save = rpcs.find((r) => r.name === "save_item")!;
  assertEquals(save.params.p_metadata, { ingredients: ["mint", "lime", "soda"], strength: "none" });
  assertEquals(save.params.p_space_id, COCKTAILS);
  assert(chunkText(save.params).includes("No alcohol"));
});

Deno.test("save_item refuses a bad recipe before anything is written", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Recipes", title: "Soup", body: "", item_type: "recipe", metadata: { minutes: 0, cuisine: "x" },
  });
  assertEquals(out.isError, true);
  assert(out.text.includes('unknown recipe field "cuisine"'), out.text);
  assertEquals(rpcs.filter((r) => r.name === "save_item").length, 0);
});

Deno.test("a password in an ingredient or a step is refused, never echoed, and pointed to the vault (rule 9)", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Recipes", title: "Pasta", body: "", item_type: "recipe",
    metadata: { ingredients: ["pasta", "the wifi password is Sunflower2024!"] },
  });
  assertEquals(out.isError, true);
  assert(/vault/i.test(out.text), out.text);
  assert(!out.text.includes("Sunflower2024"), "the value never reaches the tool result");
  assertEquals(rpcs.filter((r) => r.name === "save_item").length, 0);

  const current = { title: "Pasta", summary: null, body_markdown: "", item_type: "recipe", metadata: {} };
  const { db: db2, rpcs: rpcs2 } = fakeDb(current);
  const up = await call(db2, "update_item", { item_id: ITEM, metadata: { steps: ["Boil water", "my PIN is 4821"] } });
  assertEquals(up.isError, true);
  assert(/vault/i.test(up.text), up.text);
  assert(!up.text.includes("4821"));
  assertEquals(rpcs2.filter((r) => r.name === "update_item").length, 0);
});

Deno.test("update_item made_it keeps the recipe's fields, adds the time first and re-indexes", async () => {
  const current = {
    title: "Shrimp", summary: null, body_markdown: "Quick one.", item_type: "recipe",
    metadata: { ingredients: ["shrimp"], made: [{ on: "2026-09-01" }] },
  };
  const { db, rpcs } = fakeDb(current);
  const out = await call(db, "update_item", { item_id: ITEM, made_it: { rating: 5 }, today: TODAY });
  assertEquals(out.isError, false, out.text);
  const up = rpcs.find((r) => r.name === "update_item")!;
  assertEquals(up.params.p_metadata, { ingredients: ["shrimp"], made: [{ on: TODAY, rating: 5 }, { on: "2026-09-01" }] });
  assertEquals(up.params.p_body, null, "the text is not touched");
  assert(chunkText(up.params).includes(`Made 2 times, last on ${TODAY}, rated 5/5`), chunkText(up.params));
  assertEquals(JSON.parse(out.text).recipe.made[0], { on: TODAY, rating: 5 });
});

Deno.test("update_item refuses made_it on other types, and a made date in the future", async () => {
  const note = { title: "Note", summary: null, body_markdown: "", item_type: "note", metadata: {} };
  const { db, rpcs } = fakeDb(note);
  const out = await call(db, "update_item", { item_id: ITEM, made_it: {} });
  assertEquals(out.isError, true);
  assert(out.text.includes("only for recipes and cocktails"), out.text);
  assertEquals(rpcs.filter((r) => r.name === "update_item").length, 0);

  const cocktail = { title: "Negroni", summary: null, body_markdown: "", item_type: "cocktail", metadata: {} };
  const { db: db2 } = fakeDb(cocktail);
  const future = await call(db2, "update_item", { item_id: ITEM, made_it: { on: "2027-01-01" }, today: TODAY });
  assertEquals(future.isError, true);
  assert(future.text.includes("in the future"), future.text);
});

Deno.test("update_item: a note becoming a recipe gets its metadata checked", async () => {
  const note = { title: "Pasta link", summary: null, body_markdown: "https://www.tiktok.com/@cook/video/1", item_type: "note", metadata: {} };
  const { db, rpcs } = fakeDb(note);
  const out = await call(db, "update_item", { item_id: ITEM, item_type: "recipe", metadata: { minutes: "20" } });
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "update_item")!.params.p_metadata, { minutes: 20 });
});

Deno.test("update_item: a text edit on a recipe saved before these checks still works", async () => {
  const legacy = { title: "Old soup", summary: null, body_markdown: "x", item_type: "recipe", metadata: { cuisine: "Italian" } };
  const { db, rpcs } = fakeDb(legacy);
  const out = await call(db, "update_item", { item_id: ITEM, body: "new text" });
  assertEquals(out.isError, false, out.text);
  const up = rpcs.find((r) => r.name === "update_item")!;
  assertEquals(up.params.p_metadata, null, "metadata untouched");
  assertEquals(chunkText(up.params), "Old soup\n\nnew text");
});

Deno.test("update_item: a text edit on a checked recipe keeps its fields in search", async () => {
  const current = { title: "Soup", summary: null, body_markdown: "x", item_type: "recipe", metadata: { serves: 4 } };
  const { db, rpcs } = fakeDb(current);
  const out = await call(db, "update_item", { item_id: ITEM, body: "Better soup." });
  assertEquals(out.isError, false, out.text);
  const up = rpcs.find((r) => r.name === "update_item")!;
  assertEquals(up.params.p_metadata, null, "metadata untouched");
  assert(chunkText(up.params).includes("Better soup.\n\nServes 4"), chunkText(up.params));
});

Deno.test("the save and update tools tell the model about recipe fields and made_it", () => {
  const { db } = fakeDb();
  const tools: Record<string, { description?: string }> = {};
  const fake = { registerTool: (name: string, spec: { description?: string }) => (tools[name] = spec) } as unknown as McpServer;
  for (const r of [registerSaveItem, registerUpdateItem]) r(fake, { db, userId: "u", accessToken: "t", assistantName: "Wilma" });
  assert(tools.save_item.description!.includes('item_type "recipe" or "cocktail"'));
  assert(tools.save_item.description!.includes("with the recipe as written in body"));
  assert(tools.update_item.description!.includes("made_it"));
});
