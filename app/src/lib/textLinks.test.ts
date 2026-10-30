import { describe, expect, it } from '@jest/globals';

import { splitLinks } from './textLinks';

describe('splitLinks', () => {
  it('makes web links tappable and keeps the text exactly', () => {
    const text = 'Saw it here: https://www.tiktok.com/@chef/video/123. Also (http://example.com/a?b=1)!';
    const parts = splitLinks(text);
    expect(parts).toEqual([
      { text: 'Saw it here: ' },
      { text: 'https://www.tiktok.com/@chef/video/123', url: 'https://www.tiktok.com/@chef/video/123' },
      { text: '. Also (' },
      { text: 'http://example.com/a?b=1', url: 'http://example.com/a?b=1' },
      { text: ')!' },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(text);
  });

  it('leaves other links and links with a password as plain text', () => {
    for (const text of ['ftp://files.example.com/x', 'javascript:alert(1)', 'https://user:secret@example.com/']) {
      expect(splitLinks(text).every((p) => !('url' in p))).toBe(true);
    }
    expect(splitLinks('no links here')).toEqual([{ text: 'no links here' }]);
    expect(splitLinks('')).toEqual([]);
  });
});
