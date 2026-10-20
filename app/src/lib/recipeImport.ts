// Fill in the recipe (docs/recipes-plan.md step 3, D43), only when the user taps it, on a recipe or
// cocktail note with a link:
//   - a recipe website: the phone reads the page and its standard Recipe block (schema.org, the one
//     Google's recipe cards use). Plain code: no AI, nothing to Wilma's server.
//   - TikTok: the phone reads the video's caption from TikTok's public oEmbed address (as Get title
//     reads YouTube's), and sends only that text to the chat function's recipe_from_text route, where
//     one AI request turns it into fields that the server checks. Counted against the AI allowance.
//   - Facebook and Instagram: not readable without a sign-in, so Wilma says so; a screenshot works.
//   - A screenshot or photo (step 4): the user picks one, the phone shrinks it (at most 2000 px, a
//     new JPEG: its location and camera details are not copied), and only that picture goes to the
//     recipe_from_image route, where one AI request reads the recipe and the server checks it.
// Only empty boxes are filled, so nothing the user typed is lost; the user checks the result and
// taps Save (save_item / update_item check everything again). A caption or a line that looks like a
// password is never sent or filled in (rule 9).
import { findCredential } from './credentials';
import { decodeEntities, linkSource } from './linkInfo';
import { EMPTY_RECIPE, isWebLink, MAX_INGREDIENT, MAX_INGREDIENTS, MAX_STEP, MAX_STEPS, recipeOf, type RecipeForm, type RecipeMetadata, type RecipeType } from './recipes';
import { WilmaError } from './wilma';

/** The fields Fill in can give (never the link or the made-it times: those are the user's). */
export type FilledFields = Pick<RecipeMetadata, 'ingredients' | 'steps' | 'minutes' | 'serves' | 'strength'>;

// ---- A recipe website's Recipe block -----------------------------------------------------------

/** Named characters recipe pages use that decodeEntities does not know (°, ½, dashes, quotes). */
const RECIPE_ENTITIES: Record<string, string> = {
  deg: '°', frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü',
};

/** Text from a page: entities decoded, tags and extra spaces gone (no space left before punctuation). */
const plain = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/&([a-z0-9]+);/gi, (m, e: string) => RECIPE_ENTITIES[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

const isRecipeNode = (n: Record<string, unknown>) => {
  const t = n['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
};

/** The first Recipe object in a JSON-LD value: itself, in a list, or in an @graph. */
function findRecipe(v: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || !v || typeof v !== 'object') return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const hit = findRecipe(x, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const o = v as Record<string, unknown>;
  if (isRecipeNode(o)) return o;
  return findRecipe(o['@graph'], depth + 1);
}

/** Steps from recipeInstructions: a text, a list of texts, HowToStep and HowToSection objects. */
function instructionLines(v: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length >= MAX_STEPS * 2) return;
  if (typeof v === 'string') {
    // One text: its paragraphs or list items, each a step.
    const parts = v.split(/<\/(?:p|li)>|<br\s*\/?>|\r?\n/i).map(plain).filter(Boolean);
    out.push(...parts);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) instructionLines(x, out, depth + 1);
    return;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.itemListElement !== undefined) return instructionLines(o.itemListElement, out, depth + 1);
    const text = typeof o.text === 'string' ? o.text : typeof o.name === 'string' ? o.name : '';
    const t = plain(text);
    if (t) out.push(t);
  }
}

/** An ISO 8601 duration ("PT1H30M", "P0DT45M") in whole minutes; null when it is not one. */
export function isoMinutes(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+(?:\.\d+)?S)?)?$/i.exec(v.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** How many it serves, from recipeYield (4, "4", "4 servings", "Serves 4-6", ["4", "4 servings"]). */
function servings(v: unknown): number | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  const n = typeof first === 'number' ? first : typeof first === 'string' ? Number(/\d+/.exec(first)?.[0]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined;
}

/** Lines cut to the limits, with any line that looks like a password left out (rule 9). */
const tidy = (lines: string[], max: number, maxLen: number) =>
  lines.map((l) => l.slice(0, maxLen)).filter((l) => l && !findCredential(l)).slice(0, max);

/**
 * The recipe a page describes in its JSON-LD Recipe block; null when it has none, or one with no
 * ingredients and no steps.
 */
export function recipeFromHtml(html: string): FilledFields | null {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, json] of blocks) {
    let value: unknown;
    try {
      value = JSON.parse(json.trim());
    } catch {
      continue;
    }
    const r = findRecipe(value);
    if (!r) continue;
    const rawIngredients = Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : [];
    const ingredients = tidy(rawIngredients.filter((x): x is string => typeof x === 'string').map(plain), MAX_INGREDIENTS, MAX_INGREDIENT);
    const stepLines: string[] = [];
    instructionLines(r.recipeInstructions, stepLines);
    const steps = tidy(stepLines, MAX_STEPS, MAX_STEP);
    if (!ingredients.length && !steps.length) continue;
    const total = isoMinutes(r.totalTime) ?? ((isoMinutes(r.prepTime) ?? 0) + (isoMinutes(r.cookTime) ?? 0) || null);
    const out: FilledFields = {};
    if (ingredients.length) out.ingredients = ingredients;
    if (steps.length) out.steps = steps;
    if (total && total >= 1 && total <= 1440) out.minutes = total;
    const serves = servings(r.recipeYield);
    if (serves) out.serves = serves;
    return out;
  }
  return null;
}

// ---- TikTok's caption --------------------------------------------------------------------------

/** TikTok's public oEmbed address for a video link (no key; it answers with the caption as "title"). */
export const tiktokOembedUrl = (link: string) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`;

/** At most this much of a caption is sent (the route's limit). */
export const MAX_CAPTION = 4000;

/** The caption from TikTok's oEmbed answer; null when there is none. */
export function captionFromOembed(text: string): string | null {
  try {
    const title = (JSON.parse(text) as { title?: unknown }).title;
    if (typeof title !== 'string') return null;
    const t = title.trim();
    return t ? t.slice(0, MAX_CAPTION) : null;
  } catch {
    return null;
  }
}

// ---- The chat function's recipe_from_text route ------------------------------------------------

export type RecipeTextAnswer =
  | { fields: FilledFields }
  | { none: 'credential' | 'not_a_recipe' | 'no_answer' }
  | { problem: 'allowance_used' | 'connection' };

/** The route's answer, read defensively (only well-formed fields are used). */
export function toRecipeTextAnswer(status: number, body: unknown, type: RecipeType): RecipeTextAnswer {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (status === 429 && b.error === 'allowance_used') return { problem: 'allowance_used' };
  if (status !== 200) return { problem: 'connection' };
  if (b.fields === null) {
    return b.reason === 'credential' || b.reason === 'not_a_recipe' ? { none: b.reason } : { none: 'no_answer' };
  }
  const read = recipeOf({ item_type: type, metadata: b.fields as Record<string, unknown> | null });
  if (!read || (!read.ingredients && !read.steps)) return { none: 'no_answer' };
  const fields: FilledFields = {};
  for (const k of ['ingredients', 'steps', 'minutes', 'serves', 'strength'] as const) {
    if (read[k] !== undefined) (fields as Record<string, unknown>)[k] = read[k];
  }
  return { fields };
}

export type JsonFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

export function recipeTextClient({ url, token, refresh, fetch: f = fetch as unknown as JsonFetch }: {
  url: string;
  token: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  fetch?: JsonFetch;
}) {
  /** Turns a caption into fields. Never throws except when the session has ended (a signed-out WilmaError). */
  function fromText(type: RecipeType, text: string, signal?: AbortSignal): Promise<RecipeTextAnswer> {
    return ask(type, { mode: 'recipe_from_text', type, text: text.slice(0, MAX_CAPTION) }, signal);
  }
  /** Reads a recipe from a picture (JPEG, base64). Never throws except when the session has ended. */
  function fromImage(type: RecipeType, jpegBase64: string, signal?: AbortSignal): Promise<RecipeTextAnswer> {
    return ask(type, { mode: 'recipe_from_image', type, image: { media_type: 'image/jpeg', data: jpegBase64 } }, signal);
  }
  async function ask(type: RecipeType, body: Record<string, unknown>, signal?: AbortSignal): Promise<RecipeTextAnswer> {
    const json = JSON.stringify(body);
    const post = (accessToken: string) =>
      f(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: json, signal });
    let accessToken = await token();
    if (!accessToken) throw new WilmaError('Please sign in again.', true);
    try {
      let res = await post(accessToken);
      if (res.status === 401) {
        accessToken = await refresh();
        if (!accessToken) throw new WilmaError(SESSION_ENDED, true);
        res = await post(accessToken);
        if (res.status === 401) throw new WilmaError(SESSION_ENDED, true);
      }
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // an unreadable body is a connection problem below
      }
      return toRecipeTextAnswer(res.status, parsed, type);
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      return { problem: 'connection' };
    }
  }
  return { fromText, fromImage };
}

export type RecipeTextClient = ReturnType<typeof recipeTextClient>;

// ---- Filling the form --------------------------------------------------------------------------

export type FilledPart = 'ingredients' | 'steps' | 'time' | 'serves' | 'strength';
const PART_WORDS: Record<FilledPart, string> = { ingredients: 'ingredients', steps: 'steps', time: 'time', serves: 'servings', strength: 'strength' };

/** The form with the empty boxes filled from `fields`; what was filled, in order. */
export function fillForm(form: RecipeForm, fields: FilledFields, type: RecipeType): { form: RecipeForm; filled: FilledPart[] } {
  const out = { ...form };
  const filled: FilledPart[] = [];
  if (!form.ingredients.trim() && fields.ingredients?.length) {
    out.ingredients = fields.ingredients.join('\n');
    filled.push('ingredients');
  }
  if (!form.steps.trim() && fields.steps?.length) {
    out.steps = fields.steps.join('\n');
    filled.push('steps');
  }
  if (!form.minutes.trim() && fields.minutes) {
    out.minutes = String(fields.minutes);
    filled.push('time');
  }
  if (!form.serves.trim() && fields.serves) {
    out.serves = String(fields.serves);
    filled.push('serves');
  }
  if (type === 'cocktail' && !form.strength && fields.strength) {
    out.strength = fields.strength;
    filled.push('strength');
  }
  return { form: out, filled };
}

/** "ingredients, steps and time" */
export function partsWords(parts: FilledPart[]): string {
  const w = parts.map((p) => PART_WORDS[p]);
  return w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : (w[0] ?? '');
}

type PageFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

/** At most this much of a page is read (recipe pages are long; the Recipe block can be anywhere). */
export const MAX_RECIPE_PAGE_CHARS = 3_000_000;

export type FillOutcome = { form: RecipeForm; message: string } | { error: string };

export const FILL_WORDS = {
  noLink: 'Add the link it came from first.',
  signInSite: (site: string) => `${site} doesn’t let apps read its posts. Take a screenshot of the recipe and tap Read a screenshot instead.`,
  noPage: 'Couldn’t open the page. Check the connection and try again.',
  noRecipeOnPage: 'This page has no recipe Wilma can read. Copy the ingredients and steps into the boxes instead.',
  noCaption: 'TikTok didn’t share this video’s caption. Type the ingredients and steps in instead.',
  credential: 'The caption looks like it holds a password or a code, so Wilma won’t send it.',
  notARecipe: 'The caption doesn’t hold a recipe. Type the ingredients and steps in instead.',
  noAnswer: 'Wilma couldn’t read a recipe from the caption. Try again, or type it in.',
  allowance: 'This month’s AI allowance is used up, so Wilma can’t read the caption. A recipe website still works.',
  connection: 'Couldn’t reach Wilma. Check the connection and try again.',
  nothingNew: 'The boxes already have what Wilma found; nothing was changed.',
  filled: (parts: FilledPart[], from: 'page' | 'caption') =>
    `Filled in the ${partsWords(parts)} from the ${from === 'page' ? 'page' : 'caption'}. Check them, then Save.`,
} as const;

/**
 * The whole tap: read the link (the page, or TikTok's caption then one AI request), and fill the
 * empty boxes. Never throws except when the session has ended (a signed-out WilmaError).
 */
export async function fillFromLink(
  form: RecipeForm,
  type: RecipeType,
  deps: { fetch: PageFetch; fromText: RecipeTextClient['fromText'] },
  timeoutMs = 10_000,
): Promise<FillOutcome> {
  const link = form.link.trim();
  if (!link || !isWebLink(link)) return { error: FILL_WORDS.noLink };
  const site = linkSource(link);
  if (site === 'Facebook' || site === 'Instagram') return { error: FILL_WORDS.signInSite(site) };

  const read = async (url: string, accept: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await deps.fetch(url, { signal: ctrl.signal, headers: { accept } });
      return res.ok ? (await res.text()).slice(0, MAX_RECIPE_PAGE_CHARS) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  let fields: FilledFields;
  let from: 'page' | 'caption';
  if (site === 'TikTok') {
    const answer = await read(tiktokOembedUrl(link), 'application/json');
    const caption = answer ? captionFromOembed(answer) : null;
    if (!caption) return { error: FILL_WORDS.noCaption };
    // Rule 9: checked on the phone too, so such a caption is never sent at all.
    if (findCredential(caption)) return { error: FILL_WORDS.credential };
    const out = await deps.fromText(type, caption);
    if ('problem' in out) return { error: out.problem === 'allowance_used' ? FILL_WORDS.allowance : FILL_WORDS.connection };
    if ('none' in out) {
      return { error: out.none === 'credential' ? FILL_WORDS.credential : out.none === 'not_a_recipe' ? FILL_WORDS.notARecipe : FILL_WORDS.noAnswer };
    }
    fields = out.fields;
    from = 'caption';
  } else {
    const html = await read(link, 'text/html');
    if (html === null) return { error: FILL_WORDS.noPage };
    const found = recipeFromHtml(html);
    if (!found) return { error: FILL_WORDS.noRecipeOnPage };
    fields = found;
    from = 'page';
  }
  const { form: next, filled } = fillForm(form, fields, type);
  if (!filled.length) return { form, message: FILL_WORDS.nothingNew };
  return { form: next, message: FILL_WORDS.filled(filled, from) };
}

// ---- Step 4: a screenshot ----------------------------------------------------------------------

/** The longest side a picture is shrunk to before it is sent (recipe text stays readable). */
export const MAX_PICTURE_SIDE = 2000;

/** How to shrink a picture of this size: by its longer side, only when it is bigger. */
export function shrinkFor(width: number, height: number): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0) || Math.max(width, height) <= MAX_PICTURE_SIDE) return null;
  return width >= height ? { width: MAX_PICTURE_SIDE } : { height: MAX_PICTURE_SIDE };
}

/** What the phone's picker gives back: a shrunk JPEG as base64, nothing (cancelled), or why not. */
export type PickedPicture = { base64: string } | null | { error: string };

export const SCREENSHOT_WORDS = {
  noPicture: 'Wilma couldn’t open that picture. Try another one.',
  tooBig: 'That picture is too big to send. Try a screenshot of just the recipe.',
  notARecipe: 'Wilma couldn’t find a recipe in this picture.',
  noAnswer: 'Wilma couldn’t read a recipe from the picture. Try again, or a clearer screenshot.',
  allowance: 'This month’s AI allowance is used up, so Wilma can’t read the picture.',
  filled: (parts: FilledPart[]) => `Filled in the ${partsWords(parts)} from the picture. Check them, then Save.`,
} as const;

/** At most this much base64 is sent (the route's limit). */
export const MAX_PICTURE_BASE64 = 3_000_000;

/**
 * Read a screenshot: the user picks it (deps.pick shrinks it on the phone), only that picture goes to
 * the route, and the empty boxes are filled. Null when the user cancelled. Never throws except when
 * the session has ended.
 */
export async function fillFromScreenshot(
  form: RecipeForm,
  type: RecipeType,
  deps: { pick: () => Promise<PickedPicture>; fromImage: RecipeTextClient['fromImage'] },
): Promise<FillOutcome | null> {
  const picked = await deps.pick();
  if (picked === null) return null;
  if ('error' in picked) return { error: picked.error };
  if (!picked.base64) return { error: SCREENSHOT_WORDS.noPicture };
  if (picked.base64.length > MAX_PICTURE_BASE64) return { error: SCREENSHOT_WORDS.tooBig };
  const out = await deps.fromImage(type, picked.base64);
  if ('problem' in out) return { error: out.problem === 'allowance_used' ? SCREENSHOT_WORDS.allowance : FILL_WORDS.connection };
  if ('none' in out) return { error: out.none === 'not_a_recipe' ? SCREENSHOT_WORDS.notARecipe : SCREENSHOT_WORDS.noAnswer };
  const { form: next, filled } = fillForm(form, out.fields, type);
  if (!filled.length) return { form, message: FILL_WORDS.nothingNew };
  return { form: next, message: SCREENSHOT_WORDS.filled(filled) };
}

/** Whether the form's link can be filled in from (the button shows only then). */
export function canFill(form: RecipeForm = EMPTY_RECIPE): boolean {
  const link = form.link.trim();
  return !!link && isWebLink(link);
}
