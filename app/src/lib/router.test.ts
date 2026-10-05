import { describe, expect, it } from '@jest/globals';

import { oneTypo, parseLookup, pickLookup, secretNames, type Route, type SecretName } from './router';
import type { SecretMeta, Space } from './wilma';

const space = (id: string, path: string, restricted = false): Space => ({ id, path, description: null, restricted });
const secret = (id: string, name: string, secretType = 'login', spacePath?: string): SecretName => ({
  id,
  name,
  secretType,
  ...(spacePath ? { space: spacePath } : {}),
});

const SPACES = [
  space('s-recipes', 'Recipes'),
  space('s-work', 'Work'),
  space('s-gartner', 'Work/Gartner'),
  space('s-logins', 'Logins'),
  space('s-hidden', 'Health', true),
  space('s-hidden-child', 'Health/Clinic'),
  space('s-delete', 'Delete'),
];
const SECRETS = [
  secret('k-wifi', 'Wi-Fi', 'wifi', 'Home'),
  secret('k-bank', 'Bank login', 'login', 'Logins'),
  secret('k-gmail', 'Gmail', 'login', 'Logins'),
  secret('k-netflix', 'Netflix', 'login', 'Logins'),
  secret('k-bmo', 'Bank of Montreal online banking', 'login', 'Logins'),
];

/** The whole router, with every secret the server could return. */
function route(text: string, spaces = SPACES, secrets = SECRETS): Route {
  const lookup = parseLookup(text);
  return lookup ? pickLookup(lookup, spaces, secrets) : { to: 'wilma' };
}
const toSpace = (id: string) => expect.objectContaining({ to: 'space', space: expect.objectContaining({ id }) });
const toSecret = (id: string) => expect.objectContaining({ to: 'secret', secret: expect.objectContaining({ id }) });
const WILMA = { to: 'wilma' };

describe('the plan’s examples', () => {
  it('opens a space by its name, also inside a short request', () => {
    expect(route('recipes')).toEqual(toSpace('s-recipes'));
    expect(route('open the Recipes space')).toEqual(toSpace('s-recipes'));
    expect(route('Recipe')).toEqual(toSpace('s-recipes'));
  });

  it('shows a secret’s card for its name, also inside a question', () => {
    expect(route("what's my wifi password")).toEqual(toSecret('k-wifi'));
    expect(route('What’s my Wi-Fi password?')).toEqual(toSecret('k-wifi'));
    expect(route('wi fi')).toEqual(toSecret('k-wifi'));
    expect(route('bank')).toEqual(toSecret('k-bank'));
    expect(route('I forgot my bank password')).toEqual(toSecret('k-bank'));
    expect(route('gmail')).toEqual(toSecret('k-gmail'));
  });

  it('sends values, write words and sentences to Wilma', () => {
    expect(route('my gmail password is hunter2')).toEqual(WILMA);
    expect(route('delete bank login')).toEqual(WILMA);
    expect(route('how much did I pay for the roof')).toEqual(WILMA);
    expect(route('bank of montreal')).toEqual(WILMA);
  });
});

describe('step A: parseLookup', () => {
  it('gives the words to look for, as typed, without the fillers', () => {
    expect(parseLookup('what is my Wi-Fi password')).toEqual({ query: 'Wi-Fi password', common: ['wifi', 'password'], vault: ['wifi'] });
    expect(parseLookup('Open Recipes')?.query).toBe('Recipes');
  });

  it('never passes on a value being given (nothing goes to the vault search)', () => {
    for (const text of [
      'my gmail password is hunter2',
      'the wifi is hunter2',
      'wifi password was Sunshine99',
      'wifi: hunter2',
      'pin=1234',
      'Bank PIN is 4321',
      'the alarm code was 2468',
    ]) {
      expect(parseLookup(text)).toBeNull();
    }
    // A question is not a value.
    expect(parseLookup('what is my bank pin')).not.toBeNull();
    expect(parseLookup('where are my recipes')).not.toBeNull();
  });

  it('sends every write word to Wilma, in any form', () => {
    for (const text of ['save recipes', 'Delete', 'remove bank', 'rename Work', 'new space', 'forget my wifi', 'Update Gmail', 'add to recipes', 'saves']) {
      expect(parseLookup(text)).toBeNull();
    }
  });

  it('sends questions and sentences to Wilma before any name is read', () => {
    for (const text of ['how much did I pay for the roof', 'when is the dentist', 'why recipes', 'who has the spare key', 'do I have a bank pin']) {
      expect(parseLookup(text)).toBeNull();
    }
  });

  it('sends empty, long and too wordy messages to Wilma', () => {
    expect(parseLookup('')).toBeNull();
    expect(parseLookup('   ')).toBeNull();
    expect(parseLookup('my password')).not.toBeNull(); // "password" is only a vault filler
    expect(parseLookup('show me my')).toBeNull();
    expect(parseLookup('one two three four five')).not.toBeNull();
    expect(parseLookup('one two three four five six')).toBeNull();
    expect(parseLookup('x'.repeat(201))).toBeNull();
  });
});

describe('step B: pickLookup', () => {
  it('normalises case, accents, punctuation and Arabic marks', () => {
    const spaces = [space('a', 'Café Notes'), space('b', 'وصفات')];
    expect(route('cafe notes', spaces, [])).toEqual(toSpace('a'));
    expect(route('CAFÉ-NOTES', spaces, [])).toEqual(toSpace('a'));
    expect(route('وَصَفات', spaces, [])).toEqual(toSpace('b'));
  });

  it('finds a nested space by its own name or its path', () => {
    expect(route('gartner')).toEqual(toSpace('s-gartner'));
    expect(route('work gartner')).toEqual(toSpace('s-gartner'));
    expect(route('Work/Gartner')).toEqual(toSpace('s-gartner'));
    expect(route('work')).toEqual(toSpace('s-work'));
  });

  it('keeps vault words in space names ("Logins")', () => {
    expect(route('logins')).toEqual(toSpace('s-logins'));
    expect(route('open logins')).toEqual(toSpace('s-logins'));
  });

  it('finds a secret named with a vault word only ("PIN")', () => {
    expect(route('my pin', [], [secret('p', 'PIN', 'pin')])).toEqual(toSecret('p'));
  });

  it('sends two exact matches to Wilma (two secrets, or a space and a secret)', () => {
    expect(route('bank', SPACES, [...SECRETS, secret('k-bank2', 'Bank PIN', 'pin')])).toEqual(WILMA);
    expect(route('gmail', [...SPACES, space('s-gmail', 'Gmail')])).toEqual(WILMA);
    expect(route('notes', [space('a', 'Work/Notes'), space('b', 'Home/Notes')], [])).toEqual(WILMA);
  });

  it('never matches what is not there, or only part of a name', () => {
    expect(route('soup')).toEqual(WILMA);
    expect(route('montreal')).toEqual(WILMA);
    expect(route('net')).toEqual(WILMA);
  });

  it('forgives one typo in names of six or more letters only', () => {
    expect(route('netflx')).toEqual(toSecret('k-netflix'));
    expect(route('nteflix')).toEqual(toSecret('k-netflix'));
    expect(route('recipez')).toEqual(toSpace('s-recipes'));
    expect(route('gmial')).toEqual(WILMA); // five letters: no typo allowed
    expect(route('wrok')).toEqual(WILMA);
  });

  it('prefers an exact name to a typo, and refuses a typo that fits two names', () => {
    const secrets = [secret('a', 'Garden'), secret('b', 'Gardens two')];
    expect(route('garden', [], secrets)).toEqual(toSecret('a'));
    expect(route('gardem', [], [secret('a', 'Garden'), secret('b', 'Gardet')])).toEqual(WILMA);
  });
});

describe('restricted spaces (CLAUDE.md rule 3)', () => {
  it('a restricted space and every space inside it behave as if they did not exist', () => {
    const unknown = route('zzzz-no-such-space');
    expect(route('health')).toEqual(unknown);
    expect(route('Health')).toEqual(WILMA);
    expect(route('open health space')).toEqual(WILMA);
    expect(route('clinic')).toEqual(WILMA);
    expect(route('health clinic')).toEqual(WILMA);
    expect(route('healt')).toEqual(WILMA);
  });

  it('a restricted space with the same name as another thing hides nothing and blocks nothing', () => {
    // Only the visible one is a candidate: no "two matches" because of the hidden one.
    expect(route('health', [...SPACES, space('s-health2', 'Fitness/Health')], [])).toEqual(toSpace('s-health2'));
  });

  it('never matches a secret in a restricted space, even if the server returned it', () => {
    const hidden = [secret('h1', 'Clinic portal', 'login', 'Health'), secret('h2', 'Dentist', 'login', 'health/Clinic')];
    expect(route('clinic portal', SPACES, hidden)).toEqual(WILMA);
    expect(route('dentist', SPACES, hidden)).toEqual(WILMA);
  });

  it('the answer carries nothing about restricted spaces', () => {
    const r = route('gartner');
    expect(JSON.stringify(r)).not.toMatch(/restricted|hidden|health/i);
  });
});

describe('no secrets in the router (CLAUDE.md rules 1, 2, 4)', () => {
  it('secretNames keeps only id, name, kind and space path', () => {
    const meta: SecretMeta & { reveal_link?: string } = {
      id: 'k1',
      name: 'Bank login',
      url: 'https://bank.example',
      secret_type: 'login',
      space: 'Logins',
      created_at: '2026-10-01',
      updated_at: '2026-10-02',
      last_accessed_at: null,
      reveal_link: 'https://example.invalid/vault/reveal#t=abc',
    };
    expect(secretNames([meta])).toEqual([{ id: 'k1', name: 'Bank login', secretType: 'login', space: 'Logins' }]);
    expect(JSON.stringify(secretNames([meta]))).not.toMatch(/https|#t=|bank\.example/);
  });

  it('a route to a secret holds only what secretNames gave it', () => {
    const r = route('bank');
    expect(r).toEqual({ to: 'secret', secret: { id: 'k-bank', name: 'Bank login', secretType: 'login', space: 'Logins' } });
  });
});

describe('oneTypo', () => {
  it('counts one change, missing, extra or swapped letter', () => {
    expect(oneTypo('netflix', 'netflix')).toBe(true);
    expect(oneTypo('netflix', 'netflx')).toBe(true);
    expect(oneTypo('netflix', 'netfliix')).toBe(true);
    expect(oneTypo('netflix', 'netflox')).toBe(true);
    expect(oneTypo('netflix', 'nteflix')).toBe(true);
    expect(oneTypo('netflix', 'ntflx')).toBe(false);
    expect(oneTypo('netflix', 'xetflox')).toBe(false);
    expect(oneTypo('وصفات', 'وصفاة')).toBe(true);
  });
});
