import { describe, expect, it } from '@jest/globals';

import { newSpace, spaceChanges, spaceName } from './spaces';

describe('newSpace', () => {
  it('trims and leaves out what was not given', () => {
    expect(newSpace({ name: '  Recipes ', description: '  ', parent: null, restricted: false })).toEqual({ name: 'Recipes' });
    expect(newSpace({ name: 'Gartner', parent: 's1', description: ' Client work ', restricted: true })).toEqual({
      name: 'Gartner',
      parent: 's1',
      description: 'Client work',
      restricted: true,
    });
  });

  it('refuses an empty or long name, a "/" and a long description', () => {
    expect(() => newSpace({ name: '  ' })).toThrow(/name/);
    expect(() => newSpace({ name: 'x'.repeat(101) })).toThrow(/100/);
    expect(() => newSpace({ name: 'Work/Gartner' })).toThrow(/"\/"/);
    expect(() => newSpace({ name: 'Work', description: 'x'.repeat(501) })).toThrow(/500/);
  });
});

describe('spaceChanges (Edit space)', () => {
  const current = { path: 'Work/Gartner', description: 'Client work' };

  it("the space's own name is the last part of its path", () => {
    expect(spaceName('Work/Gartner')).toBe('Gartner');
    expect(spaceName('Recipes')).toBe('Recipes');
  });

  it('sends only what changed, trimmed, and nothing about restricted or where it sits', () => {
    expect(spaceChanges(current, { name: ' Gartner ', description: 'Client work ' })).toEqual({ changes: {} });
    expect(spaceChanges(current, { name: 'Gartner 2026', description: 'Client work' })).toEqual({ changes: { name: 'Gartner 2026' } });
    expect(spaceChanges(current, { name: 'Gartner', description: 'Consulting' })).toEqual({ changes: { description: 'Consulting' } });
    expect(spaceChanges(current, { name: 'Gartner', description: '' })).toEqual({ changes: { description: '' } });
    expect(spaceChanges({ path: 'Home', description: null }, { name: 'Home', description: '' })).toEqual({ changes: {} });
  });

  it('refuses an empty or long name, a "/" and a long description', () => {
    expect(spaceChanges(current, { name: '  ', description: '' })).toEqual({ error: 'Give the space a name.' });
    expect(spaceChanges(current, { name: 'x'.repeat(101), description: '' })).toHaveProperty('error');
    expect(spaceChanges(current, { name: 'Work/Other', description: '' })).toHaveProperty('error');
    expect(spaceChanges(current, { name: 'Gartner', description: 'x'.repeat(501) })).toHaveProperty('error');
  });
});
