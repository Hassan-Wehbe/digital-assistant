import { describe, expect, it } from '@jest/globals';

import { newSpace } from './spaces';

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
