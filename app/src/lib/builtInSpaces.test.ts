import { describe, expect, it } from '@jest/globals';

import { addTitle, builtInOf, yourSpaces } from './builtInSpaces';

const SPACES = [
  { id: '1', path: 'Tasks', built_in: 'tasks', restricted: false, description: null },
  { id: '2', path: 'Recipes', built_in: 'recipes', restricted: false, description: null },
  { id: '3', path: 'Recipes/Desserts', restricted: false, description: null },
  { id: '4', path: 'Places', built_in: 'places', restricted: false, description: null },
  { id: '5', path: 'Memories', built_in: 'memories', restricted: false, description: null },
  { id: '6', path: 'Mocktails', built_in: 'cocktails', restricted: false, description: null },
  { id: '7', path: 'Recipes old', restricted: false, description: null },
  { id: '8', path: 'Work', restricted: false, description: null },
];

describe('builtInOf', () => {
  it('names the built-in space a space is, or is under', () => {
    expect(builtInOf(SPACES[1], SPACES)).toBe('recipes');
    expect(builtInOf(SPACES[2], SPACES)).toBe('recipes');
    expect(builtInOf(SPACES[3], SPACES)).toBe('places');
  });
  it('is null for the user’s own spaces, even one whose name starts the same', () => {
    expect(builtInOf(SPACES[6], SPACES)).toBeNull();
    expect(builtInOf(SPACES[7], SPACES)).toBeNull();
    expect(builtInOf(undefined, SPACES)).toBeNull();
  });
});

describe('addTitle', () => {
  it('says what the ＋ adds', () => {
    expect(addTitle('tasks', 'Tasks')).toBe('＋ New task');
    expect(addTitle('places', 'Places')).toBe('＋ New place');
    expect(addTitle('recipes', 'Recipes/Desserts')).toBe('＋ New recipe');
    expect(addTitle('cocktails', 'Cocktails')).toBe('＋ New cocktail');
    expect(addTitle('cocktails', 'Mocktails')).toBe('＋ New mocktail');
    expect(addTitle('memories', 'Memories')).toBe('＋ Remember something');
  });
});

describe('yourSpaces', () => {
  it('lists Tasks, Places, Recipes, Cocktails, then Memories only with memory on', () => {
    expect(yourSpaces(SPACES, false).map((s) => s.path)).toEqual(['Tasks', 'Places', 'Recipes', 'Mocktails']);
    expect(yourSpaces(SPACES, true).map((s) => s.path)).toEqual(['Tasks', 'Places', 'Recipes', 'Mocktails', 'Memories']);
  });
  it('leaves out one that is missing or locked', () => {
    expect(yourSpaces(SPACES.filter((s) => s.id !== '4'), false).map((s) => s.path)).toEqual(['Tasks', 'Recipes', 'Mocktails']);
    expect(yourSpaces(SPACES.map((s) => (s.id === '1' ? { ...s, restricted: true } : s)), false)[0].path).toBe('Places');
  });
});
