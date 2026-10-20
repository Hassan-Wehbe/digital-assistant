// What's for dinner? and Make a cocktail (recipes step 6, docs/recipes-plan.md; design D43): the
// suggestions the `chat` function's suggestion route answers ({"mode":"meal"|"cocktail"};
// supabase/functions/chat/recipe_suggest.ts), checked here field by field, the client that asks for
// them, and the words the screen shows.
//
// The route picks from the user's own recipes in searchable spaces only (rule 3); who is eating goes
// as roles and ages only (Q12: the household's names never leave the phone). "I have" and "My bar"
// are typed and remembered on this phone only (Q6). A new idea (Q7) is never saved until Save to
// Recipes is tapped.
import { recipeOf, type RecipeType, type Strength, STRENGTHS } from './recipes';
import type { FilledFields } from './recipeImport';
import type { SettingsStore } from './calendarSettings';
import { WilmaError } from './wilma';

export type SuggestMode = 'meal' | 'cocktail';
export type MealKind = 'anything' | 'vegetarian' | 'kid_friendly' | 'light';
export type Mood = 'classic' | 'fruity' | 'surprise';

export const typeOf = (mode: SuggestMode): RecipeType => (mode === 'meal' ? 'recipe' : 'cocktail');

/** The chips, as the mockups (owner, 2026-10-20). `minutes` absent: No rush. */
export const TIMES: { label: string; minutes?: number }[] = [{ label: '20 min', minutes: 20 }, { label: '45 min', minutes: 45 }, { label: 'No rush' }];
export const KINDS: { value: MealKind; label: string }[] = [
  { value: 'anything', label: 'Anything' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'kid_friendly', label: 'Kid-friendly' },
  { value: 'light', label: 'Light' },
];
export const MOODS: { value: Mood; label: string }[] = [
  { value: 'classic', label: 'A classic' },
  { value: 'fruity', label: 'Fruity' },
  { value: 'surprise', label: 'Surprise me' },
];

/** The most "I have" text the server takes. */
export const MAX_HAVE = 300;

export interface SuggestChoices {
  have: string;
  minutes?: number;
  kind?: MealKind;
  strength?: Strength;
  mood?: Mood;
  who?: { adults: number; child_ages: number[] };
}

/** What the screen sends (the server refuses any other field; none of them can carry a name). */
export interface SuggestBody {
  mode: SuggestMode;
  have?: string;
  minutes?: number;
  kind?: MealKind;
  strength?: Strength;
  mood?: Mood;
  who?: { adults: number; child_ages: number[] };
  new_idea?: true;
  avoid?: string[];
}

export function suggestBody(mode: SuggestMode, c: SuggestChoices, extra: { avoid?: string[]; newIdea?: boolean } = {}): SuggestBody {
  const body: SuggestBody = { mode };
  const have = c.have.trim().slice(0, MAX_HAVE);
  if (have) body.have = have;
  if (mode === 'meal') {
    if (c.minutes) body.minutes = c.minutes;
    if (c.kind && c.kind !== 'anything') body.kind = c.kind;
    if (c.who && (c.who.adults || c.who.child_ages.length)) body.who = { adults: c.who.adults, child_ages: [...c.who.child_ages] };
  } else {
    if (c.strength) body.strength = c.strength;
    if (c.mood) body.mood = c.mood;
  }
  if (extra.newIdea) body.new_idea = true;
  if (extra.avoid?.length) body.avoid = extra.avoid.slice(0, 50);
  return body;
}

export interface Suggestion {
  id: string;
  title: string;
  type: RecipeType;
  why: string;
  missing?: string[];
  minutes?: number;
  serves?: number;
  strength?: Strength;
  rating?: number;
  last_made?: string;
  source_url?: string;
  source_site?: string;
}

export interface Usage {
  used?: number;
  limit?: number;
}

export type SuggestAnswer =
  | { suggestions: Suggestion[]; usage: Usage }
  | { none: 'none_fit' | 'credential' | 'no_answer'; recipes?: number }
  | { problem: 'limit' | 'allowance_used' | 'connection'; usage?: Usage };

export type IdeaAnswer =
  | { idea: { title: string; fields: FilledFields }; usage: Usage }
  | { none: 'credential' | 'no_answer' }
  | { problem: 'limit' | 'allowance_used' | 'connection'; usage?: Usage };

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
const whole = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One suggestion as the server sends it; null when its id, title or kind is missing. */
export function toSuggestion(raw: unknown): Suggestion | null {
  const r = obj(raw);
  const id = text(r?.id, 100);
  const title = text(r?.title, 500);
  if (!r || !id || !title || (r.type !== 'recipe' && r.type !== 'cocktail')) return null;
  const out: Suggestion = { id, title, type: r.type, why: text(r.why, 200) ?? '' };
  const missing = Array.isArray(r.missing) ? r.missing.flatMap((m) => (text(m, 60) ? [text(m, 60)!] : [])).slice(0, 6) : [];
  if (missing.length) out.missing = missing;
  const minutes = whole(r.minutes, 1, 1440);
  if (minutes) out.minutes = minutes;
  const serves = whole(r.serves, 1, 100);
  if (serves) out.serves = serves;
  if (typeof r.strength === 'string' && (STRENGTHS as readonly string[]).includes(r.strength)) out.strength = r.strength as Strength;
  const rating = whole(r.rating, 1, 5);
  if (rating) out.rating = rating;
  if (typeof r.last_made === 'string' && DATE.test(r.last_made)) out.last_made = r.last_made;
  const url = text(r.source_url, 1000);
  if (url && /^https?:\/\//i.test(url)) out.source_url = url;
  const site = text(r.source_site, 60);
  if (site) out.source_site = site;
  return out;
}

const usageOf = (v: unknown): Usage => {
  const u = obj(v);
  const used = whole(u?.used, 0, 100000);
  const limit = whole(u?.limit, 0, 100000);
  return { ...(used !== undefined ? { used } : {}), ...(limit !== undefined ? { limit } : {}) };
};

/** A failed request's problem, or null when it answered (200). */
function problemOf(status: number, b: Record<string, unknown>): { problem: 'limit' | 'allowance_used' | 'connection'; usage?: Usage } | null {
  if (status === 429 && b.error === 'limit') return { problem: 'limit', usage: usageOf(b) };
  if (status === 429 && b.error === 'allowance_used') return { problem: 'allowance_used' };
  return status === 200 ? null : { problem: 'connection' };
}

export function toSuggestAnswer(status: number, body: unknown): SuggestAnswer {
  const b = obj(body) ?? {};
  const problem = problemOf(status, b);
  if (problem) return problem;
  const list = Array.isArray(b.suggestions) ? b.suggestions.flatMap((s) => (toSuggestion(s) ? [toSuggestion(s)!] : [])).slice(0, 3) : [];
  if (list.length) return { suggestions: list, usage: usageOf(b.usage) };
  const recipes = whole(b.recipes, 0, 100000);
  const none = b.reason === 'none_fit' || b.reason === 'credential' ? b.reason : 'no_answer';
  return recipes !== undefined ? { none, recipes } : { none };
}

export function toIdeaAnswer(status: number, body: unknown, type: RecipeType): IdeaAnswer {
  const b = obj(body) ?? {};
  const problem = problemOf(status, b);
  if (problem) return problem;
  const idea = obj(b.idea);
  const title = text(idea?.title, 500);
  const read = idea && title ? recipeOf({ item_type: type, metadata: obj(idea.fields) }) : null;
  if (!title || !read || (!read.ingredients && !read.steps)) return { none: b.reason === 'credential' ? 'credential' : 'no_answer' };
  const fields: FilledFields = {};
  for (const k of ['ingredients', 'steps', 'minutes', 'serves', 'strength'] as const) {
    if (read[k] !== undefined) (fields as Record<string, unknown>)[k] = read[k];
  }
  return { idea: { title, fields }, usage: usageOf(b.usage) };
}

export type JsonFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

export function suggestClient({ url, token, refresh, fetch: f = fetch as unknown as JsonFetch }: {
  url: string;
  token: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  fetch?: JsonFetch;
}) {
  async function post(body: SuggestBody, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
    const json = JSON.stringify(body);
    const send = (accessToken: string) =>
      f(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: json, signal });
    let accessToken = await token();
    if (!accessToken) throw new WilmaError('Please sign in again.', true);
    let res = await send(accessToken);
    if (res.status === 401) {
      accessToken = await refresh();
      if (!accessToken) throw new WilmaError(SESSION_ENDED, true);
      res = await send(accessToken);
      if (res.status === 401) throw new WilmaError(SESSION_ENDED, true);
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // an unreadable body is a connection problem
    }
    return { status: res.status, body: parsed };
  }
  /** Up to three of the user's own recipes. Never throws except when the session has ended. */
  async function suggest(body: SuggestBody, signal?: AbortSignal): Promise<SuggestAnswer> {
    try {
      const ask: SuggestBody = { ...body };
      delete ask.new_idea;
      const res = await post(ask, signal);
      return toSuggestAnswer(res.status, res.body);
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      return { problem: 'connection' };
    }
  }
  /** One new recipe, not from the user's (Q7); never saved here. Never throws except when the session has ended. */
  async function idea(body: SuggestBody, signal?: AbortSignal): Promise<IdeaAnswer> {
    try {
      const res = await post({ ...body, new_idea: true }, signal);
      return toIdeaAnswer(res.status, res.body, typeOf(body.mode));
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      return { problem: 'connection' };
    }
  }
  return { suggest, idea };
}

export type SuggestClient = ReturnType<typeof suggestClient>;

// ---- What the screen says ----------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Last made today", "last made in July", "last made in July 2025"; null when never made. */
export function lastMadeText(on: string | undefined, today: string): string | null {
  if (!on || !DATE.test(on)) return null;
  if (on === today) return 'made today';
  const [y, m] = on.split('-').map(Number);
  const thisYear = Number(today.slice(0, 4));
  return `last made in ${MONTHS[m - 1]}${y === thisYear ? '' : ` ${y}`}`;
}

/** "You rated it 5 · last made in July", or null when neither is known. */
export function historyLine(s: Suggestion, today: string): string | null {
  const made = lastMadeText(s.last_made, today);
  const parts = [s.rating ? `You rated it ${s.rating}` : null, made].filter(Boolean) as string[];
  if (!parts.length) return null;
  const line = parts.join(' · ');
  return line[0].toUpperCase() + line.slice(1);
}

/** The smaller cards' line: "45 min · missing: lemons" or "Link only (TikTok)". */
export function shortLine(s: Suggestion): string {
  const missing = s.missing?.length ? `missing: ${s.missing.join(', ')}` : null;
  const parts = [s.minutes ? `${s.minutes} min` : null, missing].filter(Boolean) as string[];
  if (parts.length) return parts.join(' · ');
  if (s.source_site) return `Link only (${s.source_site})`;
  return s.why;
}

/** "3 of 10 today", or null when the server did not say. */
export function usageText(u: Usage | undefined): string | null {
  return u && u.used !== undefined && u.limit !== undefined ? `${u.used} of ${u.limit} today` : null;
}

/** What the screen says when none of the user's recipes fits (no AI request, not counted). */
export function noneFitText(mode: SuggestMode, recipes: number | undefined, c: SuggestChoices): string {
  const what = mode === 'meal' ? 'recipes' : 'cocktails';
  if (!recipes) {
    return mode === 'meal'
      ? 'Your Recipes space is empty. Save a recipe or a link, or try A new idea.'
      : 'Your Cocktails space is empty. Save a cocktail or a link, or try A new idea.';
  }
  const asked =
    mode === 'meal'
      ? [c.minutes ? `${c.minutes} minutes` : null, c.kind && c.kind !== 'anything' ? KINDS.find((k) => k.value === c.kind)!.label.toLowerCase() : null]
      : [c.strength === 'none' ? 'no alcohol' : c.strength === 'light' ? 'light' : null];
  const fits = asked.filter(Boolean).join(' and ');
  const n = recipes === 1 ? `Your one ${what.slice(0, -1)} doesn't` : `None of your ${recipes} ${what}`;
  return `${n} ${recipes === 1 ? 'fit' : 'fits'}${fits ? ` ${fits}` : ' what you asked'}.`;
}

export const NONE_TEXT: Record<'credential' | 'no_answer', string> = {
  credential: 'That looks like a password. Wilma never sends those; keep it in the Vault.',
  no_answer: "Wilma couldn't pick one this time. Try again, or try A new idea.",
};

export const PROBLEM_TEXT: Record<'allowance_used' | 'connection', string> = {
  allowance_used: "You've used this month's AI allowance. See Settings → Usage.",
  connection: "Wilma couldn't be reached. Check your connection and try again.",
};

/** The day's limit reached (Q10: 10 a day, 50 with Pro; the limits are the server's settings). */
export const limitText = (u: Usage | undefined): string =>
  u?.limit ? `That's all ${u.limit} suggestions for today. More tomorrow.` : "That's all the suggestions for today. More tomorrow.";

// ---- Remembered on this phone (Q6) --------------------------------------------------------------

const haveKey = (mode: SuggestMode, userId: string) => `wilma.${mode === 'meal' ? 'have' : 'bar'}.v1.${userId}`;

/** "I have" (meal) or "My bar" (cocktail) as last typed on this phone; empty when none or unreadable. */
export async function loadHave(store: SettingsStore, mode: SuggestMode, userId: string): Promise<string> {
  try {
    const v = await store.get(haveKey(mode, userId));
    return typeof v === 'string' ? v.slice(0, MAX_HAVE) : '';
  } catch {
    return '';
  }
}

/** Kept for next time; a failure only means it is not remembered. */
export async function saveHave(store: SettingsStore, mode: SuggestMode, userId: string, have: string): Promise<void> {
  try {
    await store.set(haveKey(mode, userId), have.trim().slice(0, MAX_HAVE));
  } catch {
    // not remembered; nothing else depends on it
  }
}
