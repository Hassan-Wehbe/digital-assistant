// Recipes and cocktails (docs/recipes-plan.md step 2, D43): the form turns into the fields the
// server checks again, a recipe's fields are read back defensively, and the note shows a summary,
// a made-it line and a link button that names the site.
import { describe, expect, it } from '@jest/globals';

import {
  EMPTY_RECIPE, isWebLink, kindForSpace, linkButton, madeArgs, madeLine, recipeForm, recipeMetadata, recipeOf, recipeSummary,
  recipeType, sameRecipe, sharedRecipe,
} from './recipes';

describe('recipe types', () => {
  it('are recipe and cocktail only', () => {
    expect(recipeType('Recipe')).toBe('recipe');
    expect(recipeType(' cocktail')).toBe('cocktail');
    expect(recipeType('note')).toBeNull();
    expect(recipeType(null)).toBeNull();
  });

  it('a new note in the built-in Recipes or Cocktails space starts as one; any other space as a note', () => {
    expect(kindForSpace({ built_in: 'recipes' })).toBe('recipe');
    expect(kindForSpace({ built_in: 'cocktails' })).toBe('cocktail');
    expect(kindForSpace({ built_in: 'tasks' })).toBeNull();
    expect(kindForSpace({ built_in: null })).toBeNull();
    expect(kindForSpace(undefined)).toBeNull();
  });
});

describe('recipeOf', () => {
  it('reads well-formed fields and leaves out the rest', () => {
    expect(recipeOf({
      item_type: 'recipe',
      metadata: {
        ingredients: ['shrimp', '', 3], steps: 'not a list', minutes: 25, serves: 0, source_url: 'javascript:alert(1)',
        source_site: ' TikTok ', strength: 'none', made: [{ on: '2026-10-19', rating: 5 }, { on: '2026-09-01', rating: 9 }, 'x'],
      },
    })).toEqual({
      ingredients: ['shrimp'], minutes: 25, source_site: 'TikTok',
      made: [{ on: '2026-10-19', rating: 5 }, { on: '2026-09-01' }],
    });
  });

  it('a cocktail keeps its strength; a recipe saved with no fields is an empty recipe; a note is not one', () => {
    expect(recipeOf({ item_type: 'cocktail', metadata: { strength: 'light' } })).toEqual({ strength: 'light' });
    expect(recipeOf({ item_type: 'recipe', metadata: null })).toEqual({});
    expect(recipeOf({ item_type: 'note', metadata: { ingredients: ['x'] } })).toBeNull();
  });
});

describe('recipeMetadata (the form)', () => {
  const form = (change: Partial<typeof EMPTY_RECIPE>) => ({ ...EMPTY_RECIPE, ...change });

  it('an empty form is a recipe with no fields (a link note)', () => {
    expect(recipeMetadata(EMPTY_RECIPE, 'recipe')).toEqual({ metadata: {} });
  });

  it('tidies lines, drops bullets and list numbers, keeps quantities', () => {
    expect(recipeMetadata(form({
      ingredients: '- 400 g shrimp\n\n• 4  cloves garlic\n',
      steps: '1. Melt the butter.\nStep 2: Add 1.5 cups stock.\n1.5 cups more if thick\n',
      minutes: ' 25 ', serves: '4',
      link: 'https://www.tiktok.com/@cook/video/1',
    }), 'recipe')).toEqual({
      metadata: {
        ingredients: ['400 g shrimp', '4 cloves garlic'],
        steps: ['Melt the butter.', 'Add 1.5 cups stock.', '1.5 cups more if thick'],
        minutes: 25, serves: 4,
        source_url: 'https://www.tiktok.com/@cook/video/1', source_site: 'TikTok',
      },
    });
  });

  it('keeps the made-it times, and the site name while the link stays the same', () => {
    const base = { source_url: 'https://example.com/r', source_site: 'Grandma’s blog', made: [{ on: '2026-10-01', rating: 4 }] };
    expect(recipeMetadata(form({ link: 'https://example.com/r' }), 'recipe', base)).toEqual({
      metadata: { source_url: 'https://example.com/r', source_site: 'Grandma’s blog', made: [{ on: '2026-10-01', rating: 4 }] },
    });
    expect(recipeMetadata(form({ link: 'https://other.example/r' }), 'recipe', base)).toEqual({
      metadata: { source_url: 'https://other.example/r', made: [{ on: '2026-10-01', rating: 4 }] },
    });
  });

  it('refuses what the server would refuse, in plain words', () => {
    const bad: [Partial<typeof EMPTY_RECIPE>, RegExp][] = [
      [{ minutes: '0' }, /Time \(minutes\) must be a whole number from 1 to 1440/],
      [{ minutes: '2.5' }, /whole number/],
      [{ serves: '500' }, /Serves must be a whole number from 1 to 100/],
      [{ ingredients: Array.from({ length: 61 }, (_, n) => `item ${n}`).join('\n') }, /Up to 60 ingredients/],
      [{ ingredients: 'x'.repeat(201) }, /at most 200 characters/],
      [{ steps: Array.from({ length: 41 }, (_, n) => `step ${n}`).join('\n') }, /Up to 40 steps/],
      [{ link: 'javascript:alert(1)' }, /web address/],
      [{ link: 'https://me:secret@example.com' }, /web address/],
      [{ strength: 'light' }, /Only a cocktail has a strength/],
    ];
    for (const [change, message] of bad) {
      const out = recipeMetadata(form(change), 'recipe');
      expect('error' in out && out.error).toMatch(message);
    }
    expect(recipeMetadata(form({ strength: 'none' }), 'cocktail')).toEqual({ metadata: { strength: 'none' } });
  });

  it('round-trips through the form unchanged', () => {
    const m = { ingredients: ['gin', 'Campari'], steps: ['Stir', 'Strain'], minutes: 5, serves: 1, source_url: 'https://www.tiktok.com/@a/video/1', source_site: 'TikTok', strength: 'regular' as const, made: [{ on: '2026-10-19' }] };
    const out = recipeMetadata(recipeForm(m), 'cocktail', m);
    expect('metadata' in out && sameRecipe(out.metadata, m)).toBe(true);
    expect(sameRecipe(m, { ...m, minutes: 6 })).toBe(false);
    expect(sameRecipe({}, null)).toBe(true);
  });
});

describe('on the note', () => {
  it('a summary line and a made-it line', () => {
    expect(recipeSummary({ minutes: 25, serves: 4 })).toBe('25 min · serves 4');
    expect(recipeSummary({ strength: 'none' })).toBe('No alcohol');
    expect(recipeSummary({})).toBe('');
    expect(madeLine({ made: [{ on: '2026-10-19' }, { on: '2026-09-01', rating: 5 }] })).toBe('Made 2 times · last on 2026-10-19 · ★5');
    expect(madeLine({ made: [{ on: '2026-10-19', rating: 3 }] })).toBe('Made once · last on 2026-10-19 · ★3');
    expect(madeLine({})).toBeNull();
  });

  it('made it is today on the phone, with the rating only when one was picked', () => {
    const now = new Date(2026, 9, 20, 21, 30);
    expect(madeArgs(5, now)).toEqual({ on: '2026-10-20', rating: 5 });
    expect(madeArgs(null, now)).toEqual({ on: '2026-10-20' });
  });

  it('the link button names the site when Wilma knows it', () => {
    expect(linkButton({ source_url: 'https://www.tiktok.com/@a/video/1' })).toBe('Open on TikTok');
    expect(linkButton({ source_url: 'https://example.com/r', source_site: 'BBC Good Food' })).toBe('Open on BBC Good Food');
    expect(linkButton({ source_url: 'https://example.com/r' })).toBe('Open the link');
  });

  it('only http(s) links without a name or password open', () => {
    expect(isWebLink('https://www.bbcgoodfood.com/recipes/x')).toBe(true);
    expect(isWebLink('ftp://example.com')).toBe(false);
    expect(isWebLink('https://user@example.com')).toBe(false);
    expect(isWebLink('not a link')).toBe(false);
  });
});

describe('sharedRecipe (Share → Wilma into Recipes or Cocktails)', () => {
  it('keeps the shared link as the source and names the site', () => {
    expect(sharedRecipe('https://www.tiktok.com/@cook/video/1')).toEqual({ source_url: 'https://www.tiktok.com/@cook/video/1', source_site: 'TikTok' });
    expect(sharedRecipe('https://www.bbcgoodfood.com/recipes/x')).toEqual({ source_url: 'https://www.bbcgoodfood.com/recipes/x' });
  });

  it('no link, or one that is not a plain web link, gives a recipe with no fields', () => {
    expect(sharedRecipe(null)).toEqual({});
    expect(sharedRecipe('https://me:pw@example.com/r')).toEqual({});
    expect(sharedRecipe(`https://example.com/${'x'.repeat(1000)}`)).toEqual({});
  });
});
