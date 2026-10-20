// Fill in the recipe (docs/recipes-plan.md step 3, D43): a recipe website's Recipe block read on the
// phone (the shapes big sites use: an @graph from WordPress recipe plugins, a list, HowToStep and
// HowToSection steps), TikTok's caption sent to the route only when it holds no password, only empty
// boxes filled, and plain words for every way it can fail.
import { describe, expect, it, jest } from '@jest/globals';

import {
  captionFromOembed, fillForm, fillFromLink, FILL_WORDS, isoMinutes, recipeFromHtml, type RecipeTextAnswer, recipeTextClient,
  tiktokOembedUrl, toRecipeTextAnswer,
} from './recipeImport';
import { EMPTY_RECIPE, type RecipeForm } from './recipes';

const page = (...blocks: unknown[]) =>
  `<html><head><title>Banana bread</title>${blocks
    .map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`)
    .join('')}</head><body>…</body></html>`;

// A WordPress recipe plugin's block: the recipe inside an @graph, steps as HowToStep, a yield list.
const WORDPRESS = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Grandma’s kitchen' },
    {
      '@type': 'Recipe',
      name: 'Banana bread',
      recipeIngredient: ['3 ripe bananas', '75 g butter, melted', '150 g sugar', '1 egg', '190 g flour', '1 tsp baking soda'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Heat the oven to 175&deg;C.' },
        { '@type': 'HowToStep', text: 'Mash the bananas &amp; mix in the butter.' },
        { '@type': 'HowToStep', name: 'Bake', text: 'Bake for <strong>60 minutes</strong>.' },
      ],
      prepTime: 'PT15M',
      cookTime: 'PT1H',
      recipeYield: ['8', '8 slices'],
    },
  ],
};

// Another big site's shape: a list at the top, @type as a list, steps in sections, totalTime.
const SECTIONS = [
  { '@type': 'BreadcrumbList' },
  {
    '@type': ['Recipe', 'NewsArticle'],
    recipeIngredient: ['400 g shrimp', '4 cloves garlic'],
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'Prep', itemListElement: [{ '@type': 'HowToStep', text: 'Peel the shrimp.' }] },
      { '@type': 'HowToSection', name: 'Cook', itemListElement: [{ '@type': 'HowToStep', text: 'Cook 2 minutes per side.' }] },
    ],
    totalTime: 'PT20M',
    recipeYield: 'Serves 2-3',
  },
];

describe('recipeFromHtml', () => {
  it('reads a WordPress-style block: ingredients, steps (entities and tags cleaned), prep + cook time, servings', () => {
    expect(recipeFromHtml(page({ '@type': 'Organization' }, WORDPRESS))).toEqual({
      ingredients: ['3 ripe bananas', '75 g butter, melted', '150 g sugar', '1 egg', '190 g flour', '1 tsp baking soda'],
      steps: ['Heat the oven to 175°C.', 'Mash the bananas & mix in the butter.', 'Bake for 60 minutes.'],
      minutes: 75,
      serves: 8,
    });
  });

  it('reads a list with sections of steps and a total time', () => {
    expect(recipeFromHtml(page(SECTIONS))).toEqual({
      ingredients: ['400 g shrimp', '4 cloves garlic'],
      steps: ['Peel the shrimp.', 'Cook 2 minutes per side.'],
      minutes: 20,
      serves: 2,
    });
  });

  it('reads steps given as one text, split into paragraphs', () => {
    const r = recipeFromHtml(page({ '@type': 'Recipe', recipeInstructions: '<p>Stir with ice.</p><p>Strain into a glass.</p>' }));
    expect(r).toEqual({ steps: ['Stir with ice.', 'Strain into a glass.'] });
  });

  it('none: no block, a broken block, a block without a recipe, or a recipe with nothing in it', () => {
    expect(recipeFromHtml('<html><title>Pasta</title></html>')).toBeNull();
    expect(recipeFromHtml(page('{ not json'))).toBeNull();
    expect(recipeFromHtml(page({ '@type': 'Article', name: 'Ten pasta tips' }))).toBeNull();
    expect(recipeFromHtml(page({ '@type': 'Recipe', name: 'Pasta', totalTime: 'PT10M' }))).toBeNull();
  });

  it('a broken block before a good one is skipped', () => {
    expect(recipeFromHtml(page('{ broken', SECTIONS))?.ingredients).toEqual(['400 g shrimp', '4 cloves garlic']);
  });

  it('cuts to the limits and leaves out a line that looks like a password (rule 9)', () => {
    const r = recipeFromHtml(page({
      '@type': 'Recipe',
      recipeIngredient: [...Array.from({ length: 70 }, (_, n) => `item ${n}`), 42],
      recipeInstructions: ['Mix', 'The wifi password is Sunflower2024!', 'x'.repeat(1200)],
      recipeYield: 500,
      totalTime: 'P2D',
    }));
    expect(r?.ingredients).toHaveLength(60);
    expect(r?.steps).toEqual(['Mix', 'x'.repeat(1000)]);
    expect(r).not.toHaveProperty('serves');
    expect(r).not.toHaveProperty('minutes');
  });

  it('ISO durations in minutes', () => {
    expect(isoMinutes('PT1H30M')).toBe(90);
    expect(isoMinutes('PT45M')).toBe(45);
    expect(isoMinutes('P0DT0H20M')).toBe(20);
    expect(isoMinutes('PT10M30S')).toBe(10);
    expect(isoMinutes('P1D')).toBe(1440);
    expect(isoMinutes('20 minutes')).toBeNull();
    expect(isoMinutes('PT')).toBeNull();
    expect(isoMinutes(20)).toBeNull();
  });
});

describe('TikTok', () => {
  it('the public oEmbed address for a video, and the caption from its answer', () => {
    expect(tiktokOembedUrl('https://www.tiktok.com/@cook/video/1?lang=en')).toBe(
      'https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40cook%2Fvideo%2F1%3Flang%3Den',
    );
    expect(captionFromOembed(JSON.stringify({ title: ' Shrimp 🍤 400g shrimp… ', author_name: 'Cook' }))).toBe('Shrimp 🍤 400g shrimp…');
    expect(captionFromOembed(JSON.stringify({ title: '' }))).toBeNull();
    expect(captionFromOembed('<html>')).toBeNull();
    expect(captionFromOembed(JSON.stringify({ title: 'x'.repeat(5000) }))?.length).toBe(4000);
  });
});

describe('toRecipeTextAnswer (the route’s answer)', () => {
  it('fields, read defensively', () => {
    expect(toRecipeTextAnswer(200, { fields: { ingredients: ['mint', 3], steps: ['Shake'], minutes: 0, strength: 'none' } }, 'cocktail')).toEqual({
      fields: { ingredients: ['mint'], steps: ['Shake'], strength: 'none' },
    });
    expect(toRecipeTextAnswer(200, { fields: { strength: 'none' } }, 'recipe')).toEqual({ none: 'no_answer' });
  });

  it('none, and problems', () => {
    expect(toRecipeTextAnswer(200, { fields: null, reason: 'credential' }, 'recipe')).toEqual({ none: 'credential' });
    expect(toRecipeTextAnswer(200, { fields: null, reason: 'not_a_recipe' }, 'recipe')).toEqual({ none: 'not_a_recipe' });
    expect(toRecipeTextAnswer(200, { fields: null, reason: 'odd' }, 'recipe')).toEqual({ none: 'no_answer' });
    expect(toRecipeTextAnswer(429, { error: 'allowance_used' }, 'recipe')).toEqual({ problem: 'allowance_used' });
    expect(toRecipeTextAnswer(503, null, 'recipe')).toEqual({ problem: 'connection' });
  });
});

describe('recipeTextClient', () => {
  it('posts the caption as recipe_from_text with the session, retrying once after a refresh', async () => {
    const calls: { auth: string; body: unknown }[] = [];
    const replies = [{ status: 401, body: {} }, { status: 200, body: { fields: { ingredients: ['shrimp'] } } }];
    const f = jest.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) });
      const r = replies.shift()!;
      return { status: r.status, json: async () => r.body };
    });
    const client = recipeTextClient({ url: 'https://x/functions/v1/chat', token: async () => 'old', refresh: async () => 'new', fetch: f });
    expect(await client.fromText('recipe', 'Shrimp: shrimp, garlic')).toEqual({ fields: { ingredients: ['shrimp'] } });
    expect(calls).toEqual([
      { auth: 'Bearer old', body: { mode: 'recipe_from_text', type: 'recipe', text: 'Shrimp: shrimp, garlic' } },
      { auth: 'Bearer new', body: { mode: 'recipe_from_text', type: 'recipe', text: 'Shrimp: shrimp, garlic' } },
    ]);
  });

  it('a network failure is a connection problem, not a crash', async () => {
    const client = recipeTextClient({
      url: 'u', token: async () => 't', refresh: async () => null,
      fetch: async () => { throw new Error('offline'); },
    });
    expect(await client.fromText('recipe', 'x')).toEqual({ problem: 'connection' });
  });
});

describe('fillForm', () => {
  it('fills only the empty boxes, and says what it filled', () => {
    const form: RecipeForm = { ...EMPTY_RECIPE, steps: 'My own step', link: 'https://x.example/r' };
    const out = fillForm(form, { ingredients: ['a', 'b'], steps: ['theirs'], minutes: 20, serves: 4, strength: 'light' }, 'recipe');
    expect(out.form).toEqual({ ...form, ingredients: 'a\nb', minutes: '20', serves: '4' });
    expect(out.filled).toEqual(['ingredients', 'time', 'serves']);
    expect(fillForm(EMPTY_RECIPE, { strength: 'none' }, 'cocktail').form.strength).toBe('none');
  });
});

describe('fillFromLink (the tap)', () => {
  const form = (link: string): RecipeForm => ({ ...EMPTY_RECIPE, link });
  const pageFetch = (status: number, text: string) => jest.fn(async () => ({ ok: status === 200, text: async () => text }));
  const never = jest.fn(async (): Promise<RecipeTextAnswer> => ({ problem: 'connection' }));

  it('a recipe website: read on the phone, no AI request', async () => {
    const f = pageFetch(200, page(WORDPRESS));
    const fromText = jest.fn(never);
    const out = await fillFromLink(form('https://grandmas.example/banana-bread'), 'recipe', { fetch: f, fromText });
    expect('form' in out && out.form.ingredients.split('\n')).toHaveLength(6);
    expect('message' in out && out.message).toBe(FILL_WORDS.filled(['ingredients', 'steps', 'time', 'serves'], 'page'));
    expect(f).toHaveBeenCalledWith('https://grandmas.example/banana-bread', expect.objectContaining({ headers: { accept: 'text/html' } }));
    expect(fromText).not.toHaveBeenCalled();
  });

  it('a page with no recipe block, or one that does not open', async () => {
    expect(await fillFromLink(form('https://blog.example/p'), 'recipe', { fetch: pageFetch(200, '<html></html>'), fromText: never }))
      .toEqual({ error: FILL_WORDS.noRecipeOnPage });
    expect(await fillFromLink(form('https://blog.example/p'), 'recipe', { fetch: pageFetch(404, ''), fromText: never }))
      .toEqual({ error: FILL_WORDS.noPage });
    const offline = jest.fn(async () => { throw new Error('offline'); });
    expect(await fillFromLink(form('https://blog.example/p'), 'recipe', { fetch: offline, fromText: never }))
      .toEqual({ error: FILL_WORDS.noPage });
  });

  it('TikTok: the caption from oEmbed goes to the route; its fields fill the boxes', async () => {
    const f = pageFetch(200, JSON.stringify({ title: 'Shrimp 🍤 400g shrimp, garlic. Cook 2 min #dinner' }));
    const fromText = jest.fn(async (): Promise<RecipeTextAnswer> => ({ fields: { ingredients: ['400 g shrimp', 'garlic'], steps: ['Cook 2 minutes'] } }));
    const out = await fillFromLink(form('https://www.tiktok.com/@cook/video/1'), 'recipe', { fetch: f, fromText });
    expect(f).toHaveBeenCalledWith(tiktokOembedUrl('https://www.tiktok.com/@cook/video/1'), expect.objectContaining({ headers: { accept: 'application/json' } }));
    expect(fromText).toHaveBeenCalledWith('recipe', 'Shrimp 🍤 400g shrimp, garlic. Cook 2 min #dinner');
    expect(out).toEqual({
      form: { ...form('https://www.tiktok.com/@cook/video/1'), ingredients: '400 g shrimp\ngarlic', steps: 'Cook 2 minutes' },
      message: FILL_WORDS.filled(['ingredients', 'steps'], 'caption'),
    });
  });

  it('TikTok: a caption that looks like it holds a password is never sent (rule 9)', async () => {
    const f = pageFetch(200, JSON.stringify({ title: 'Paloma! Bar wifi password is Agave!2024' }));
    const fromText = jest.fn(never);
    expect(await fillFromLink(form('https://www.tiktok.com/@bar/video/2'), 'cocktail', { fetch: f, fromText })).toEqual({ error: FILL_WORDS.credential });
    expect(fromText).not.toHaveBeenCalled();
  });

  it('TikTok: no caption, not a recipe, the allowance used, no connection', async () => {
    const tiktok = form('https://www.tiktok.com/@cook/video/1');
    const caption = pageFetch(200, JSON.stringify({ title: 'Monday mood' }));
    expect(await fillFromLink(tiktok, 'recipe', { fetch: pageFetch(200, '{}'), fromText: never })).toEqual({ error: FILL_WORDS.noCaption });
    const answer = (a: RecipeTextAnswer) => jest.fn(async () => a);
    expect(await fillFromLink(tiktok, 'recipe', { fetch: caption, fromText: answer({ none: 'not_a_recipe' }) })).toEqual({ error: FILL_WORDS.notARecipe });
    expect(await fillFromLink(tiktok, 'recipe', { fetch: caption, fromText: answer({ none: 'no_answer' }) })).toEqual({ error: FILL_WORDS.noAnswer });
    expect(await fillFromLink(tiktok, 'recipe', { fetch: caption, fromText: answer({ problem: 'allowance_used' }) })).toEqual({ error: FILL_WORDS.allowance });
    expect(await fillFromLink(tiktok, 'recipe', { fetch: caption, fromText: answer({ problem: 'connection' }) })).toEqual({ error: FILL_WORDS.connection });
  });

  it('Facebook and Instagram are not read at all; a missing link asks for one', async () => {
    const f = jest.fn(pageFetch(200, ''));
    expect(await fillFromLink(form('https://www.facebook.com/watch/?v=1'), 'recipe', { fetch: f, fromText: never }))
      .toEqual({ error: FILL_WORDS.signInSite('Facebook') });
    expect(await fillFromLink(form('https://www.instagram.com/reel/abc'), 'recipe', { fetch: f, fromText: never }))
      .toEqual({ error: FILL_WORDS.signInSite('Instagram') });
    expect(f).not.toHaveBeenCalled();
    expect(await fillFromLink(form(''), 'recipe', { fetch: f, fromText: never })).toEqual({ error: FILL_WORDS.noLink });
  });

  it('boxes already full: nothing changes', async () => {
    const full: RecipeForm = { ...EMPTY_RECIPE, link: 'https://x.example/r', ingredients: 'mine', steps: 'mine', minutes: '5', serves: '1' };
    expect(await fillFromLink(full, 'recipe', { fetch: pageFetch(200, page(WORDPRESS)), fromText: never }))
      .toEqual({ form: full, message: FILL_WORDS.nothingNew });
  });
});
