// Recipes and cocktails (docs/recipes-plan.md step 2, design D43): an item with item_type "recipe"
// or "cocktail" whose metadata holds what Wilma needs to suggest it later. All fields are
// optional: a link note with only a title is still a recipe. As for places (places.ts), the
// server, not the model, decides the shape: save_item / update_item pass the metadata through
// normalizeRecipe, which rejects unknown fields, bad links and out-of-range values with a message
// the model can act on. The note's own text (body) stays as the user wrote it; the fields are
// added to what meaning search reads (withRecipe). Credential-looking values are refused before
// this, by rejectCredentials (every metadata value, rule 9).

export const RECIPE_TYPES = ["recipe", "cocktail"] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

/** A cocktail's strength: "none" is a drink with no alcohol (a mocktail). */
export const STRENGTHS = ["regular", "light", "none"] as const;
export const MAX_INGREDIENTS = 60;
export const MAX_STEPS = 40;
export const MAX_MADE = 50;

export interface RecipeMade {
  on: string;
  rating?: number;
}

export interface RecipeMetadata {
  ingredients?: string[];
  steps?: string[];
  minutes?: number;
  serves?: number;
  source_url?: string;
  source_site?: string;
  strength?: (typeof STRENGTHS)[number];
  made?: RecipeMade[];
}

const FIELDS = ["ingredients", "steps", "minutes", "serves", "source_url", "source_site", "strength", "made"];

export class RecipeError extends Error {}

const fail = (type: RecipeType, msg: string): never => {
  throw new RecipeError(`${type === "cocktail" ? "Cocktail" : "Recipe"} not saved: ${msg}`);
};

/** "recipe" or "cocktail" for those item types; null for every other. */
export function recipeType(itemType: string | null | undefined): RecipeType | null {
  const t = (itemType ?? "").trim().toLowerCase();
  return (RECIPE_TYPES as readonly string[]).includes(t) ? t as RecipeType : null;
}

function text(type: RecipeType, v: unknown, field: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return fail(type, `${field} must be text`);
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length > max) return fail(type, `${field} is longer than ${max} characters`);
  return t || undefined;
}

/**
 * Lines of text: a list, or one text with a line per entry. Blank lines are dropped; a leading
 * bullet ("- ", "• ") or, for steps, a number ("1. ", "2) ", "Step 3: "; not "1.5 cups") is the list's, not the text's.
 */
function lines(type: RecipeType, v: unknown, field: string, maxItems: number, maxLen: number, numbered: boolean): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const raw = typeof v === "string" ? v.split(/\r?\n/) : v;
  if (!Array.isArray(raw)) return fail(type, `${field} must be a list of lines`);
  // Blank lines are dropped, but a list mostly of them is refused before any work.
  if (raw.length > maxItems * 3) return fail(type, `${field} has more than ${maxItems} lines`);
  const out: string[] = [];
  for (const [n, x] of raw.entries()) {
    let t = text(type, x, `${field} line ${n + 1}`, maxLen);
    if (!t) continue;
    t = t.replace(/^[-*•·]\s+/, "");
    if (numbered) t = t.replace(/^(step\s*)?\d{1,2}\s*[.):](\s+|$)/i, "");
    if (t) out.push(t);
  }
  if (out.length > maxItems) return fail(type, `${field} has more than ${maxItems} lines`);
  return out.length ? out : undefined;
}

function int(type: RecipeType, v: unknown, field: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    return fail(type, `${field} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/** A calendar date, YYYY-MM-DD, not more than a day after `today` (the user's date). */
function date(type: RecipeType, v: unknown, field: string, today: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return fail(type, `${field} must be a date like 2026-10-12`);
  const d = v.trim();
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return fail(type, `${field} is not a real date`);
  if (t.getTime() > new Date(`${today}T00:00:00Z`).getTime() + 24 * 3600_000) return fail(type, `${field} is in the future`);
  if (t.getUTCFullYear() < 1900) return fail(type, `${field} is too far in the past`);
  return d;
}

/** A web link the app can open: http(s) only, with no user name or password in it. */
export function isWebLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && !!u.hostname;
}

function strength(type: RecipeType, v: unknown): RecipeMetadata["strength"] {
  if (v === undefined || v === null || v === "") return undefined;
  if (type !== "cocktail") return fail(type, "strength is only for cocktails");
  if (typeof v !== "string") return fail(type, "strength must be text");
  const s = v.trim().toLowerCase().replace(/[\s_-]+/g, " ")
    .replace(/^(no alcohol|non alcoholic|alcohol free|mocktail|virgin|zero|zero proof)$/, "none")
    .replace(/^(low|low alcohol|weak)$/, "light")
    .replace(/^(normal|full|strong)$/, "regular");
  if (!(STRENGTHS as readonly string[]).includes(s)) return fail(type, `strength must be one of ${STRENGTHS.join(", ")}`);
  return s as RecipeMetadata["strength"];
}

function made(type: RecipeType, v: unknown, today: string): RecipeMade[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return fail(type, "made must be a list");
  if (v.length > MAX_MADE) return fail(type, `made has more than ${MAX_MADE} entries`);
  const out = v.map((x, n): RecipeMade => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return fail(type, `made ${n + 1} must have a date ("on")`);
    const r = x as Record<string, unknown>;
    const extra = Object.keys(r).find((k) => !["on", "rating"].includes(k));
    if (extra) return fail(type, `made ${n + 1} has an unknown field "${extra}" (use on, rating)`);
    const on = date(type, r.on, `made ${n + 1} date`, today) ?? fail(type, `made ${n + 1} must have a date ("on")`);
    const rating = int(type, r.rating, `made ${n + 1} rating`, 1, 5);
    return rating === undefined ? { on } : { on, rating };
  });
  // Newest first.
  out.sort((a, b) => b.on.localeCompare(a.on));
  return out.length ? out : undefined;
}

/**
 * The checked, tidied metadata of a recipe or cocktail. Throws RecipeError with a short reason
 * when a field is unknown or wrong. `today` is the user's date (YYYY-MM-DD), for "made" dates.
 */
export function normalizeRecipe(
  input: Record<string, unknown> | null | undefined,
  type: RecipeType,
  today = new Date().toISOString().slice(0, 10),
): RecipeMetadata {
  const m = input ?? {};
  if (typeof m !== "object" || Array.isArray(m)) fail(type, "metadata must be an object");
  const unknown = Object.keys(m).find((k) => !FIELDS.includes(k));
  if (unknown) fail(type, `unknown ${type} field "${unknown}" (known: ${FIELDS.join(", ")})`);

  const out: RecipeMetadata = {};
  const ingredients = lines(type, m.ingredients, "ingredients", MAX_INGREDIENTS, 200, false);
  if (ingredients) out.ingredients = ingredients;
  const steps = lines(type, m.steps, "steps", MAX_STEPS, 1000, true);
  if (steps) out.steps = steps;
  const minutes = int(type, m.minutes, "minutes", 1, 1440);
  if (minutes !== undefined) out.minutes = minutes;
  const serves = int(type, m.serves, "serves", 1, 100);
  if (serves !== undefined) out.serves = serves;
  const url = text(type, m.source_url, "source_url", 1000);
  if (url) {
    if (!isWebLink(url)) fail(type, "source_url must be a web link (https://...)");
    out.source_url = url;
  }
  const site = text(type, m.source_site, "source_site", 60);
  if (site) out.source_site = site;
  const s = strength(type, m.strength);
  if (s) out.strength = s;
  const ms = made(type, m.made, today);
  if (ms) out.made = ms;
  return out;
}

/** "I made the shrimp again, 5 stars": the time goes first; the rest of the fields stay. */
export function addMade(
  current: Record<string, unknown> | null | undefined,
  entry: { on?: string; rating?: number },
  type: RecipeType,
  today: string,
): RecipeMetadata {
  const m = { ...(current ?? {}) };
  const past = Array.isArray(m.made) ? [...m.made] : [];
  if (past.length >= MAX_MADE) past.splice(MAX_MADE - 1);
  m.made = [{ on: entry.on ?? today, ...(entry.rating !== undefined ? { rating: entry.rating } : {}) }, ...past];
  return normalizeRecipe(m, type, today);
}

const STRENGTH_WORDS: Record<string, string> = { regular: "Regular strength", light: "Light", none: "No alcohol" };

/** The fields as plain lines, added to the text that meaning search reads (item_chunk). */
export function recipeText(m: RecipeMetadata): string {
  const last = m.made?.[0];
  const rated = m.made?.find((x) => x.rating !== undefined)?.rating;
  const parts = [
    m.ingredients && `Ingredients:\n${m.ingredients.map((x) => `- ${x}`).join("\n")}`,
    m.steps && `Steps:\n${m.steps.map((x, n) => `${n + 1}. ${x}`).join("\n")}`,
    m.minutes && `Time: ${m.minutes} min`,
    m.serves && `Serves ${m.serves}`,
    m.strength && STRENGTH_WORDS[m.strength],
    m.source_site && `From ${m.source_site}`,
    last && `Made ${m.made!.length === 1 ? "once" : `${m.made!.length} times`}, last on ${last.on}${rated ? `, rated ${rated}/5` : ""}`,
  ];
  return parts.filter(Boolean).join("\n");
}

/** The body as meaning search reads it: a recipe's fields follow the text. */
export function withRecipe(body: string, recipe: RecipeMetadata | null): string {
  if (!recipe) return body;
  const fields = recipeText(recipe);
  if (!fields) return body;
  return body.trim() ? `${body}\n\n${fields}` : fields;
}

// ---- Drinks and age (docs/age-plan.md step 2, D44) -------------------------------------------
// Alcohol only from 21 (is_21() in the database, the caller's own row; not asked yet counts as
// under 21). Under 21 a drink saves only with strength "none" and with no alcohol named in its
// title, ingredients or steps; the suggestion route (chat/recipe_suggest.ts) uses the same words.

// Drinks that only sound alcoholic are taken out before looking (ginger beer, non-alcoholic wine).
const NOT_ALCOHOL = /\b(ginger|root|birch)\s+beer\b|\bginger\s+ale\b|\b(non[- ]?alcoholic|alcohol[- ]free|zero[- ]proof|0\s?%|de[- ]?alcoholi[sz]ed)\s+[a-z]+(\s+[a-z]+)?|\bwine\s+vinegar\b|\b(rum|vanilla|almond|brandy)\s+(extract|essence|flavou?ring)\b|\bbitter\s+lemon\b|\bnon[- ]?alcoholic\b|\balcohol[- ]free\b|\bvirgin\b/gi;
// Spirits, wine, beer and liqueurs by name.
const ALCOHOL = /\b(vodka|gin|rum|tequila|mezcal|whisk(e)?y|bourbon|scotch|rye\s+whisk|brandy|cognac|armagnac|calvados|pisco|cacha[cç]a|absinthe|wine|prosecco|champagne|cava|sparkling\s+wine|vermouth|sherry|port|beer|lager|ale|stout|cider|sake|soju|liqueurs?|schnapps|amaretto|kahl[uú]a|baileys|cointreau|triple\s+sec|grand\s+marnier|cura[cç]ao|campari|aperol|chartreuse|limoncello|sambuca|ouzo|arak|raki|pastis|jagermeister|j[aä]germeister|midori|frangelico|drambuie|chambord|st[- ]germain|elderflower\s+liqueur|bitters|spirits?|liquor|alcohol(ic)?|booze)\b/i;

/** Whether a drink's words name alcohol (after taking out ginger beer, non-alcoholic wine and the like). */
export function namesAlcohol(...texts: (string | undefined | null)[]): boolean {
  return ALCOHOL.test(texts.filter(Boolean).join("\n").replace(NOT_ALCOHOL, " "));
}

/** Whether a drink, as saved, is one with alcohol: its strength is not "none", or its words name alcohol. */
export function drinkHasAlcohol(title: string, m: RecipeMetadata | null): boolean {
  return m?.strength !== "none" || namesAlcohol(title, ...(m?.ingredients ?? []), ...(m?.steps ?? []));
}

export const UNDER_21 =
  "Cocktails with alcohol are for 21 and over. Save it as a mocktail (strength \"none\", no alcohol in it), or not at all.";

/** The caller is 21 or over (is_21(); false when not asked yet or on any error: the safe side). */
export async function isAdult21(db: { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("is_21");
    return !error && data === true;
  } catch {
    return false;
  }
}
