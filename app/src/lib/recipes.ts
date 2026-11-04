// Recipes and cocktails (docs/recipes-plan.md step 2, design D43): a note of type "recipe" or
// "cocktail" can hold ingredients, steps, the time, how many it serves, the link it came from, a
// cocktail's strength and when it was made. All optional: a link with a title is still a recipe.
// The server checks every field again (supabase/functions/mcp/lib/recipes.ts, and rule 9's
// password check); this file turns the form into those fields and reads them back for the screen.
import { linkSource } from './linkInfo';
import { localDate } from './places';

export type RecipeType = 'recipe' | 'cocktail';
export const STRENGTHS = ['regular', 'light', 'none'] as const;
export type Strength = (typeof STRENGTHS)[number];
export const STRENGTH_LABELS: Record<Strength, string> = { regular: 'Regular', light: 'Light', none: 'No alcohol' };

export const MAX_INGREDIENTS = 60;
export const MAX_INGREDIENT = 200;
export const MAX_STEPS = 40;
export const MAX_STEP = 1000;
export const MAX_LINK = 1000;

export interface RecipeMade {
  on: string;
  rating?: number;
}

/** What the label says for one serving: calories in kcal, the rest in grams (owner, 2026-11-04). */
export const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrition = Partial<Record<Nutrient, number>>;
export const NUTRIENT_LABELS: Record<Nutrient, string> = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fiber' };
export const NUTRIENT_UNITS: Record<Nutrient, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g' };
export const NUTRIENT_MAX: Record<Nutrient, number> = { calories: 5000, protein: 500, carbs: 500, fat: 500, fiber: 200 };

export interface RecipeMetadata {
  ingredients?: string[];
  steps?: string[];
  minutes?: number;
  serves?: number;
  /** Per serving. */
  nutrition?: Nutrition;
  source_url?: string;
  source_site?: string;
  strength?: Strength;
  made?: RecipeMade[];
}

/** "recipe" or "cocktail" for those note types; null for every other. */
export function recipeType(itemType: string | null | undefined): RecipeType | null {
  const t = (itemType ?? '').trim().toLowerCase();
  return t === 'recipe' || t === 'cocktail' ? t : null;
}

/** The kind a new note in this space starts as: the built-in Recipes and Cocktails spaces only. */
export function kindForSpace(space: { built_in?: string | null } | undefined): RecipeType | null {
  if (space?.built_in === 'recipes') return 'recipe';
  if (space?.built_in === 'cocktails') return 'cocktail';
  return null;
}

/** A web link the app can open: http(s), with no user name or password in it. */
export function isWebLink(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !!u.hostname;
  } catch {
    return false;
  }
}

const strings = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return out.length ? out : undefined;
};
const whole = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

/** Per-serving numbers, read defensively: only well-formed ones (0 up to each limit). */
export function nutritionOf(v: unknown): Nutrition | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const out: Nutrition = {};
  for (const k of NUTRIENTS) {
    const x = r[k];
    if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= NUTRIENT_MAX[k]) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A recipe note's fields, read defensively (a recipe saved before these fields, or by hand, may
 * hold anything): only well-formed values are shown. Null for any other note type.
 */
export function recipeOf(item: { item_type: string; metadata?: Record<string, unknown> | null }): RecipeMetadata | null {
  const type = recipeType(item.item_type);
  if (!type) return null;
  const m = item.metadata ?? {};
  const out: RecipeMetadata = {};
  const ingredients = strings(m.ingredients);
  if (ingredients) out.ingredients = ingredients;
  const steps = strings(m.steps);
  if (steps) out.steps = steps;
  const minutes = whole(m.minutes, 1, 1440);
  if (minutes) out.minutes = minutes;
  const serves = whole(m.serves, 1, 100);
  if (serves) out.serves = serves;
  const nutrition = nutritionOf(m.nutrition);
  if (nutrition) out.nutrition = nutrition;
  if (typeof m.source_url === 'string' && isWebLink(m.source_url)) out.source_url = m.source_url;
  if (typeof m.source_site === 'string' && m.source_site.trim()) out.source_site = m.source_site.trim();
  if (type === 'cocktail' && (STRENGTHS as readonly unknown[]).includes(m.strength)) out.strength = m.strength as Strength;
  if (Array.isArray(m.made)) {
    const made = m.made
      .filter((x): x is { on: string; rating?: unknown } => !!x && typeof x === 'object' && typeof (x as { on?: unknown }).on === 'string')
      .map((x) => {
        const rating = whole(x.rating, 1, 5);
        return rating ? { on: x.on, rating } : { on: x.on };
      });
    if (made.length) out.made = made;
  }
  return out;
}

// ---- The form ----------------------------------------------------------------------------------

export interface RecipeForm {
  /** One per line. */
  ingredients: string;
  /** One per line, in order. */
  steps: string;
  minutes: string;
  serves: string;
  link: string;
  strength: Strength | null;
  /** Per serving, as typed (calories, protein, carbs, fat, fiber). */
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
}

export const EMPTY_RECIPE: RecipeForm = {
  ingredients: '', steps: '', minutes: '', serves: '', link: '', strength: null,
  calories: '', protein: '', carbs: '', fat: '', fiber: '',
};

export function recipeForm(m: RecipeMetadata | null): RecipeForm {
  if (!m) return EMPTY_RECIPE;
  return {
    ingredients: (m.ingredients ?? []).join('\n'),
    steps: (m.steps ?? []).join('\n'),
    minutes: m.minutes ? String(m.minutes) : '',
    serves: m.serves ? String(m.serves) : '',
    link: m.source_url ?? '',
    strength: m.strength ?? null,
    calories: m.nutrition?.calories !== undefined ? String(m.nutrition.calories) : '',
    protein: m.nutrition?.protein !== undefined ? String(m.nutrition.protein) : '',
    carbs: m.nutrition?.carbs !== undefined ? String(m.nutrition.carbs) : '',
    fat: m.nutrition?.fat !== undefined ? String(m.nutrition.fat) : '',
    fiber: m.nutrition?.fiber !== undefined ? String(m.nutrition.fiber) : '',
  };
}

/** Lines of a box: blank ones dropped, a bullet or (for steps) a list number ("1. ", "2) ") dropped. */
function lines(text: string, numbered: boolean): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => {
      let t = l.trim().replace(/\s+/g, ' ').replace(/^[-*•·]\s+/, '');
      if (numbered) t = t.replace(/^(step\s*)?\d{1,2}\s*[.):](\s+|$)/i, '');
      return t;
    })
    .filter(Boolean);
}

function count(text: string, label: string, min: number, max: number): { n?: number } | { error: string } {
  const t = text.trim();
  if (!t) return {};
  const n = Number(t);
  if (!/^\d+$/.test(t) || n < min || n > max) return { error: `${label} must be a whole number from ${min} to ${max}.` };
  return { n };
}

/**
 * The fields to save, or why they cannot be saved. "Made it" times are kept from `base` (the form
 * does not show them), and so is the site's name when the link stays the same.
 */
export function recipeMetadata(
  form: RecipeForm,
  type: RecipeType,
  base: RecipeMetadata | null = null,
): { metadata: RecipeMetadata } | { error: string } {
  const out: RecipeMetadata = {};
  const ingredients = lines(form.ingredients, false);
  if (ingredients.length > MAX_INGREDIENTS) return { error: `Up to ${MAX_INGREDIENTS} ingredients.` };
  if (ingredients.some((l) => l.length > MAX_INGREDIENT)) return { error: `Each ingredient can be at most ${MAX_INGREDIENT} characters.` };
  if (ingredients.length) out.ingredients = ingredients;

  const steps = lines(form.steps, true);
  if (steps.length > MAX_STEPS) return { error: `Up to ${MAX_STEPS} steps.` };
  if (steps.some((l) => l.length > MAX_STEP)) return { error: `Each step can be at most ${MAX_STEP} characters.` };
  if (steps.length) out.steps = steps;

  const minutes = count(form.minutes, 'Time (minutes)', 1, 1440);
  if ('error' in minutes) return minutes;
  if (minutes.n) out.minutes = minutes.n;
  const serves = count(form.serves, 'Serves', 1, 100);
  if ('error' in serves) return serves;
  if (serves.n) out.serves = serves.n;

  const nutrition: Nutrition = {};
  for (const k of NUTRIENTS) {
    const t = form[k].trim().replace(',', '.');
    if (!t) continue;
    const n = Number(t);
    if (!/^\d+(\.\d+)?$/.test(t) || n > NUTRIENT_MAX[k]) {
      return { error: `${NUTRIENT_LABELS[k]} must be a number from 0 to ${NUTRIENT_MAX[k]}.` };
    }
    nutrition[k] = Math.round(n * 10) / 10;
  }
  if (Object.keys(nutrition).length) out.nutrition = nutrition;

  const link = form.link.trim();
  if (link) {
    if (link.length > MAX_LINK || !isWebLink(link)) return { error: 'The link must be a web address (https://…), or leave it empty.' };
    out.source_url = link;
    const site = linkSource(link) ?? (base?.source_url === link ? base.source_site : undefined);
    if (site) out.source_site = site;
  }
  if (form.strength) {
    if (type !== 'cocktail') return { error: 'Only a cocktail has a strength.' };
    out.strength = form.strength;
  }
  if (base?.made?.length) out.made = base.made;
  return { metadata: out };
}

const KEYS: (keyof RecipeMetadata)[] = ['ingredients', 'steps', 'minutes', 'serves', 'nutrition', 'source_url', 'source_site', 'strength', 'made'];

/** The same fields (key order does not matter; list order does). */
export function sameRecipe(a: RecipeMetadata | null, b: RecipeMetadata | null): boolean {
  const key = (m: RecipeMetadata | null) => JSON.stringify(KEYS.map((k) => m?.[k] ?? null));
  return key(a) === key(b);
}

// ---- On the note -------------------------------------------------------------------------------

/** "450 kcal · 32 g protein · 40 g carbs · 12 g fat · 6 g fiber" (per serving; only what is known), or null. */
export function nutritionLine(m: RecipeMetadata): string | null {
  const n = m.nutrition;
  if (!n) return null;
  const parts = NUTRIENTS.filter((k) => n[k] !== undefined).map((k) =>
    k === 'calories' ? `${n[k]} kcal` : `${n[k]} g ${NUTRIENT_LABELS[k].toLowerCase()}`,
  );
  return parts.length ? parts.join(' · ') : null;
}

/** "25 min · serves 4 · No alcohol"; empty when none of those is known. */
export function recipeSummary(m: RecipeMetadata): string {
  return [
    m.minutes ? `${m.minutes} min` : null,
    m.serves ? `serves ${m.serves}` : null,
    m.strength ? STRENGTH_LABELS[m.strength] : null,
  ].filter(Boolean).join(' · ');
}

/** "Made 3 times · last on 2026-10-19 · ★5" (the newest rating), or null when never made. */
export function madeLine(m: RecipeMetadata): string | null {
  const made = m.made ?? [];
  if (!made.length) return null;
  const rating = made.find((x) => x.rating)?.rating;
  return [made.length === 1 ? 'Made once' : `Made ${made.length} times`, `last on ${made[0].on}`, rating ? `★${rating}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** What update_item's made_it gets: today on the phone, and the rating when one was picked. */
export function madeArgs(rating: number | null, now = new Date()): { on: string; rating?: number } {
  const on = localDate(now);
  return rating && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { on, rating } : { on };
}

/** A link shared into Recipes or Cocktails (Share → Wilma): kept as the recipe's source, its site named. */
export function sharedRecipe(link: string | null): RecipeMetadata {
  if (!link || link.length > MAX_LINK || !isWebLink(link)) return {};
  const site = linkSource(link);
  return site ? { source_url: link, source_site: site } : { source_url: link };
}

/** The link button's words: "Open on TikTok", or "Open the link" for a site Wilma doesn't name. */
export function linkButton(m: RecipeMetadata): string {
  const site = m.source_site ?? (m.source_url ? linkSource(m.source_url) : null);
  return site ? `Open on ${site}` : 'Open the link';
}
