import { describe, expect, it } from '@jest/globals';

import { editError, LOOKS_LIKE_SECRET, MAX_BODY, MAX_TITLE, noteChanges } from './noteEdit';

const current = { title: 'Lentil soup', body: 'Red lentils, cumin.' };

describe('noteChanges', () => {
  it('sends only what changed, with the title trimmed', () => {
    expect(noteChanges(current, { title: '  Lentil soup ', body: 'Red lentils, cumin.' })).toEqual({ changes: {} });
    expect(noteChanges(current, { title: 'Red lentil soup', body: 'Red lentils, cumin.' })).toEqual({
      changes: { title: 'Red lentil soup' },
    });
    expect(noteChanges(current, { title: 'Lentil soup', body: 'Red lentils, cumin, lemon.' })).toEqual({
      changes: { body: 'Red lentils, cumin, lemon.' },
    });
  });

  it('an empty text is a change from a note that had text, and none from one that had none', () => {
    expect(noteChanges(current, { title: 'Lentil soup', body: '' })).toEqual({ changes: { body: '' } });
    expect(noteChanges({ title: 'T', body: null }, { title: 'T', body: '' })).toEqual({ changes: {} });
  });

  it('refuses an empty or too long title, and a too long text', () => {
    expect(noteChanges(current, { title: '   ', body: '' })).toEqual({ error: 'Give the note a title.' });
    expect(noteChanges(current, { title: 'x'.repeat(MAX_TITLE + 1), body: '' })).toHaveProperty('error');
    expect(noteChanges(current, { title: 'T', body: 'x'.repeat(MAX_BODY + 1) })).toHaveProperty('error');
  });
});

describe('editError', () => {
  it('turns the server\'s credential refusal into a plain sentence, never repeating it', () => {
    const refusal = 'Not saved: the body looks like it contains a password. Wilma keeps passwords ...';
    expect(editError(refusal)).toBe(LOOKS_LIKE_SECRET);
    expect(editError('Could not reach Wilma. Check your connection and try again.')).toBe(
      'Could not reach Wilma. Check your connection and try again.',
    );
  });
});
