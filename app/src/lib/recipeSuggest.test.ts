// What's for dinner? and Make a cocktail (recipes step 6): what the screen sends (no names, no
// field the server refuses), how each answer is checked, the words shown, and I have / My bar kept
// on this phone only.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  historyLine, lastMadeText, limitText, loadHave, noneFitText, saveHave, saveIdea, shortLine, suggestBody, suggestClient,
  toIdeaAnswer, toSuggestAnswer, toSuggestion, usageText, type JsonFetch, type Suggestion,
} from './recipeSuggest';
import { WilmaError } from './wilma';

const CURRY = { id: 'i1', title: 'Chickpea curry', type: 'recipe', why: 'uses your chickpeas', missing: ['coconut milk'], minutes: 30, rating: 5, last_made: '2026-07-04' };

describe('what the screen sends', () => {
  it("a meal: time, kind, who as roles and ages, what they have; Anything and No rush are left out", () => {
    expect(suggestBody('meal', { have: '  chicken, rice ', minutes: 45, kind: 'vegetarian', who: { adults: 2, child_ages: [6, 9] } })).toEqual({
      mode: 'meal', have: 'chicken, rice', minutes: 45, kind: 'vegetarian', who: { adults: 2, child_ages: [6, 9] },
    });
    expect(suggestBody('meal', { have: '', kind: 'anything', who: { adults: 0, child_ages: [] } })).toEqual({ mode: 'meal' });
  });

  it('a cocktail: strength and mood only (no time, kind or who)', () => {
    expect(suggestBody('cocktail', { have: 'gin', strength: 'none', mood: 'fruity', minutes: 20, kind: 'light', who: { adults: 2, child_ages: [] } })).toEqual({
      mode: 'cocktail', have: 'gin', strength: 'none', mood: 'fruity',
    });
  });

  it('Another idea leaves out the ones shown; A new idea asks for one', () => {
    expect(suggestBody('meal', { have: '' }, { avoid: ['a', 'b'] })).toEqual({ mode: 'meal', avoid: ['a', 'b'] });
    expect(suggestBody('meal', { have: '' }, { newIdea: true })).toEqual({ mode: 'meal', new_idea: true });
  });

  it('only the fields the server takes: nothing that could carry a name', () => {
    const body = suggestBody('meal', { have: 'x', minutes: 20, kind: 'kid_friendly', who: { adults: 1, child_ages: [4] } }, { avoid: ['a'], newIdea: true });
    expect(Object.keys(body).sort()).toEqual(['avoid', 'have', 'kind', 'minutes', 'mode', 'new_idea', 'who']);
    expect(Object.keys(body.who!).sort()).toEqual(['adults', 'child_ages']);
  });
});

describe('the answers, checked here', () => {
  it('suggestions: each field checked, a bad one dropped, at most three', () => {
    const out = toSuggestAnswer(200, {
      suggestions: [
        CURRY,
        { id: 'i2', title: 'Orzo', type: 'recipe', why: 'quick', source_url: 'javascript:alert(1)', source_site: 'TikTok', rating: 9 },
        { title: 'No id', type: 'recipe', why: 'x' },
        { id: 'i3', title: 'Bad type', type: 'secret', why: 'x' },
        { id: 'i4', title: 'Four', type: 'recipe', why: '' },
        { id: 'i5', title: 'Five', type: 'recipe', why: '' },
      ],
      usage: { used: 3, limit: 10 },
    });
    if (!('suggestions' in out)) throw new Error('expected suggestions');
    expect(out.suggestions.map((s) => s.id)).toEqual(['i1', 'i2', 'i4']);
    expect(out.suggestions[0]).toEqual(CURRY);
    expect(out.suggestions[1]).toEqual({ id: 'i2', title: 'Orzo', type: 'recipe', why: 'quick', source_site: 'TikTok' });
    expect(out.usage).toEqual({ used: 3, limit: 10 });
  });

  it('nothing fits (with how many recipes), a password-like "I have", no answer', () => {
    expect(toSuggestAnswer(200, { suggestions: [], reason: 'none_fit', recipes: 12 })).toEqual({ none: 'none_fit', recipes: 12 });
    expect(toSuggestAnswer(200, { suggestions: [], reason: 'credential' })).toEqual({ none: 'credential' });
    expect(toSuggestAnswer(200, { suggestions: [], reason: 'no_answer', usage: { used: 1, limit: 10 } })).toEqual({ none: 'no_answer' });
    expect(toSuggestAnswer(200, 'garbage')).toEqual({ none: 'no_answer' });
  });

  it("the day's limit, the month's allowance, anything else a connection problem", () => {
    expect(toSuggestAnswer(429, { error: 'limit', used: 10, limit: 10 })).toEqual({ problem: 'limit', usage: { used: 10, limit: 10 } });
    expect(toSuggestAnswer(429, { error: 'allowance_used' })).toEqual({ problem: 'allowance_used' });
    expect(toSuggestAnswer(500, null)).toEqual({ problem: 'connection' });
    expect(toIdeaAnswer(429, { error: 'limit', used: 50, limit: 50 }, 'recipe')).toEqual({ problem: 'limit', usage: { used: 50, limit: 50 } });
  });

  it('a new idea: a title and checked fields; without either it is no answer', () => {
    const fields = { ingredients: ['250 g halloumi', '2 zucchini'], steps: ['Grill'], minutes: 20, serves: 4 };
    expect(toIdeaAnswer(200, { idea: { title: 'Halloumi skewers', fields }, new: true, usage: { used: 1, limit: 10 } }, 'recipe')).toEqual({
      idea: { title: 'Halloumi skewers', fields }, usage: { used: 1, limit: 10 },
    });
    expect(toIdeaAnswer(200, { idea: { title: 'Nothing in it', fields: {} } }, 'recipe')).toEqual({ none: 'no_answer' });
    expect(toIdeaAnswer(200, { idea: null, reason: 'credential' }, 'recipe')).toEqual({ none: 'credential' });
  });

  it('a suggestion with an unknown strength or a bad date keeps only what is valid', () => {
    expect(toSuggestion({ id: 'x', title: 'Mojito', type: 'cocktail', why: 'fresh', strength: 'strong', last_made: 'July' })).toEqual({
      id: 'x', title: 'Mojito', type: 'cocktail', why: 'fresh',
    });
  });
});

describe('the client', () => {
  const answer = (status: number, body: unknown) => ({ status, json: async () => body });

  it('posts with the token, retries once after a 401 with a fresh one, and checks the answer', async () => {
    const sent: { auth: string; body: unknown }[] = [];
    let first = true;
    const fetch: JsonFetch = async (_url, init) => {
      sent.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) });
      if (first) {
        first = false;
        return answer(401, {});
      }
      return answer(200, { suggestions: [CURRY], usage: { used: 1, limit: 10 } });
    };
    const client = suggestClient({ url: 'u', token: async () => 'old', refresh: async () => 'new', fetch });
    const out = await client.suggest({ mode: 'meal', have: 'chickpeas', new_idea: true });
    expect('suggestions' in out && out.suggestions[0].id).toBe('i1');
    expect(sent.map((s) => s.auth)).toEqual(['Bearer old', 'Bearer new']);
    expect(sent[1].body).toEqual({ mode: 'meal', have: 'chickpeas' });
  });

  it('A new idea sends new_idea; a failed request is a connection problem; an ended session throws', async () => {
    let body: unknown = null;
    const ok = suggestClient({
      url: 'u', token: async () => 't', refresh: async () => 't',
      fetch: async (_u, init) => {
        body = JSON.parse(init.body);
        return answer(200, { idea: { title: 'Virgin mojito', fields: { ingredients: ['mint', 'lime'], strength: 'none' } }, new: true });
      },
    });
    const idea = await ok.idea({ mode: 'cocktail', strength: 'none' });
    expect(body).toEqual({ mode: 'cocktail', strength: 'none', new_idea: true });
    expect('idea' in idea && idea.idea.fields).toEqual({ ingredients: ['mint', 'lime'], strength: 'none' });

    const down = suggestClient({ url: 'u', token: async () => 't', refresh: async () => 't', fetch: async () => { throw new Error('offline'); } });
    expect(await down.suggest({ mode: 'meal' })).toEqual({ problem: 'connection' });

    const ended = suggestClient({ url: 'u', token: async () => 't', refresh: async () => null, fetch: async () => answer(401, {}) });
    await expect(ended.suggest({ mode: 'meal' })).rejects.toBeInstanceOf(WilmaError);
  });
});

describe('the words', () => {
  const s = (over: Partial<Suggestion>): Suggestion => ({ id: 'x', title: 'T', type: 'recipe', why: 'why', ...over });

  it('when it was last made and your rating', () => {
    expect(lastMadeText('2026-07-04', '2026-10-20')).toBe('last made in July');
    expect(lastMadeText('2025-12-01', '2026-10-20')).toBe('last made in December 2025');
    expect(lastMadeText('2026-10-20', '2026-10-20')).toBe('made today');
    expect(historyLine(s({ rating: 5, last_made: '2026-07-04' }), '2026-10-20')).toBe('You rated it 5 · last made in July');
    expect(historyLine(s({ last_made: '2026-08-02' }), '2026-10-20')).toBe('Last made in August');
    expect(historyLine(s({}), '2026-10-20')).toBeNull();
  });

  it("the smaller cards' line", () => {
    expect(shortLine(s({ minutes: 45, missing: ['lemons'] }))).toBe('45 min · missing: lemons');
    expect(shortLine(s({ source_site: 'TikTok' }))).toBe('Link only (TikTok)');
    expect(shortLine(s({}))).toBe('why');
  });

  it('the count, the limit, and nothing fits', () => {
    expect(usageText({ used: 3, limit: 10 })).toBe('3 of 10 today');
    expect(usageText({})).toBeNull();
    expect(limitText({ used: 10, limit: 10 })).toBe("That's all 10 suggestions for today. More tomorrow.");
    expect(noneFitText('meal', 12, { have: '', minutes: 20, kind: 'vegetarian' })).toBe('None of your 12 recipes fits 20 minutes and vegetarian.');
    expect(noneFitText('cocktail', 1, { have: '', strength: 'none' })).toBe("Your one cocktail doesn't fit no alcohol.");
    expect(noneFitText('meal', 0, { have: '' })).toMatch(/^Your Recipes space is empty\./);
  });
});

describe('I have and My bar, on this phone only', () => {
  it('kept per account and kind; an unreadable store is empty', async () => {
    const data = new Map<string, string>();
    const store = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v) };
    await saveHave(store, 'meal', 'u1', ' chicken, rice ');
    await saveHave(store, 'cocktail', 'u1', 'gin');
    expect(await loadHave(store, 'meal', 'u1')).toBe('chicken, rice');
    expect(await loadHave(store, 'cocktail', 'u1')).toBe('gin');
    expect(await loadHave(store, 'meal', 'u2')).toBe('');
    const broken = { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } };
    expect(await loadHave(broken, 'meal', 'u1')).toBe('');
    await expect(saveHave(broken, 'meal', 'u1', 'x')).resolves.toBeUndefined();
  });
});

describe('the screen', () => {
  const screen = readFileSync(resolve(__dirname, '..', 'app/suggest.tsx'), 'utf8');

  it('holds a password-like I have on the phone, and sends who as roles and ages only', () => {
    expect(screen).toContain('findCredential(have)');
    expect(screen).toContain("disabled={busy || !!credential}");
    expect(screen).toContain('whoFrom(household.data');
    expect(screen).not.toMatch(/\.name\b/);
  });

  it('saves A new idea only on its button, into the built-in space', () => {
    expect(screen).toContain('await saveIdea(wilma, mode, title, fields)');
    expect(screen).not.toContain('wilma.saveItem(');
    expect(screen).toContain('onSave={() => void saveNewIdea(ideaTitle, fields)}');
  });
});

describe('in the chat (step 7)', () => {
  // Required here: chatStream and chatThread load the app's whole chat, as in outing.test.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toChatEvent } = require('./chatStream') as typeof import('./chatStream');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chatReducer, initialChat } = require('./chatThread') as typeof import('./chatThread');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toEntry } = require('./chatStore') as typeof import('./chatStore');

  it('the suggestions and A new idea are read from their events, checked as the screen checks them', () => {
    expect(toChatEvent({ type: 'recipe_suggestions', mode: 'meal', suggestions: [CURRY, { title: 'no id' }], usage: { used: 2, limit: 10 } })).toEqual({
      type: 'recipe_suggestions', mode: 'meal', suggestions: [CURRY], usage: { used: 2, limit: 10 },
    });
    expect(toChatEvent({ type: 'recipe_suggestions', mode: 'meal', suggestions: [] })).toBeNull();
    expect(toChatEvent({ type: 'recipe_suggestions', mode: 'dessert', suggestions: [CURRY] })).toBeNull();
    expect(toChatEvent({ type: 'recipe_idea', mode: 'cocktail', idea: { title: 'Virgin mojito', fields: { ingredients: ['mint', 'lime'], strength: 'none' } } })).toEqual({
      type: 'recipe_idea', mode: 'cocktail', title: 'Virgin mojito', fields: { ingredients: ['mint', 'lime'], strength: 'none' },
    });
    expect(toChatEvent({ type: 'recipe_idea', mode: 'meal', idea: { title: 'Empty', fields: {} } })).toBeNull();
  });

  it('become cards in the thread, and are never saved with the chat', () => {
    let s = chatReducer(initialChat(), { type: 'send', text: 'what should I cook tonight?' });
    s = chatReducer(s, { type: 'event', event: toChatEvent({ type: 'recipe_suggestions', mode: 'meal', suggestions: [CURRY], usage: {} })! });
    s = chatReducer(s, { type: 'event', event: toChatEvent({ type: 'recipe_idea', mode: 'meal', idea: { title: 'Halloumi skewers', fields: { steps: ['Grill'] } } })! });
    const cards = s.entries.filter((e) => e.kind === 'recipes' || e.kind === 'recipe_idea');
    expect(cards.map((e) => e.kind)).toEqual(['recipes', 'recipe_idea']);
    for (const card of cards) expect(toEntry({ ...card })).toBeNull();
  });

  it('Save to Recipes: into the built-in space only, as a recipe note with the checked fields', async () => {
    const saved: unknown[] = [];
    const wilma = {
      listSpaces: async () => [
        { id: 's1', path: 'Recipes', description: null, restricted: false, built_in: 'recipes' },
        { id: 's2', path: 'Cocktails', description: null, restricted: false, built_in: 'cocktails' },
      ],
      saveItem: async (item: unknown) => {
        saved.push(item);
        return { id: 'new-id', space: 'Recipes' };
      },
    };
    expect(await saveIdea(wilma, 'cocktail', 'Virgin mojito', { ingredients: ['mint'] })).toBe('new-id');
    expect(saved).toEqual([{ space: 'Cocktails', title: 'Virgin mojito', body: '', item_type: 'cocktail', metadata: { ingredients: ['mint'] } }]);
    await expect(saveIdea({ ...wilma, listSpaces: async () => [] }, 'meal', 'X', {})).rejects.toThrow("Your Recipes space wasn't found.");
  });
});
