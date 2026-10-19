// Links shared to Wilma (owner, 2026-10-19): the site's name, and the page's own title read only
// when the user taps Get title (YouTube through its oEmbed address).
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { cleanTitle, decodeEntities, fetchLinkTitle, firstUrl, linkSource, titleFromHtml, titleSource } from './linkInfo';

describe('linkSource and firstUrl', () => {
  it('knows the social sites, mobile and short links included', () => {
    expect(linkSource('https://www.youtube.com/watch?v=abc')).toBe('YouTube');
    expect(linkSource('https://youtu.be/abc')).toBe('YouTube');
    expect(linkSource('https://m.facebook.com/story.php?id=1')).toBe('Facebook');
    expect(linkSource('https://fb.watch/xyz/')).toBe('Facebook');
    expect(linkSource('https://www.instagram.com/p/1/')).toBe('Instagram');
    expect(linkSource('https://vm.tiktok.com/1')).toBe('TikTok');
    expect(linkSource('https://x.com/a/status/1')).toBe('X');
    expect(linkSource('https://www.reddit.com/r/a')).toBe('Reddit');
    expect(linkSource('https://pin.it/abc')).toBe('Pinterest');
    expect(linkSource('https://example.com/x')).toBeNull();
    expect(linkSource('https://notyoutube.com.evil.example/x')).toBeNull();
    expect(linkSource('not a link')).toBeNull();
  });

  it('finds the first link in shared text, without trailing punctuation', () => {
    expect(firstUrl('Watch this! https://youtu.be/abc).')).toBe('https://youtu.be/abc');
    expect(firstUrl('no link here')).toBeNull();
    expect(firstUrl(null)).toBeNull();
  });
});

describe('titles', () => {
  it('reads og:title first, then <title>, entities decoded', () => {
    expect(titleFromHtml('<html><head><meta property="og:title" content="Sourdough &amp; Rye" /><title>Other</title>')).toBe('Sourdough & Rye');
    expect(titleFromHtml('<meta content="Reversed order" property="og:title">')).toBe('Reversed order');
    expect(titleFromHtml('<title>  Best\n bread &#8211; ever </title>')).toBe('Best bread – ever');
    expect(decodeEntities('&#x1F35E; &quot;x&quot;')).toBe('🍞 "x"');
  });

  it('says nothing for a sign-in wall or the bare site name', () => {
    expect(titleFromHtml('<title>Log in or sign up to view</title>')).toBe('Log in or sign up to view');
    expect(titleFromHtml('<title>Facebook</title>')).toBeNull();
    expect(titleFromHtml('<title>Log in | Instagram</title>')).toBeNull();
    expect(titleFromHtml('<p>no title</p>')).toBeNull();
    expect(cleanTitle('x'.repeat(300))).toHaveLength(200);
  });

  it('asks YouTube by its oEmbed address, any other page by itself', () => {
    expect(titleSource('https://youtu.be/abc')).toEqual({
      url: 'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabc', kind: 'oembed',
    });
    expect(titleSource('https://example.com/a')).toEqual({ url: 'https://example.com/a', kind: 'html' });
  });

  it('fetches only the one address, and gives null on failure', async () => {
    const asked: string[] = [];
    const ok = (body: string) => async (url: string) => {
      asked.push(url);
      return { ok: true, text: async () => body };
    };
    expect(await fetchLinkTitle('https://youtu.be/abc', ok('{"title":"How to bake bread"}'))).toBe('How to bake bread');
    expect(await fetchLinkTitle('https://example.com/a', ok('<title>A page</title>'))).toBe('A page');
    expect(asked).toEqual(['https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabc', 'https://example.com/a']);
    expect(await fetchLinkTitle('https://youtu.be/abc', ok('not json'))).toBeNull();
    expect(await fetchLinkTitle('https://example.com', async () => ({ ok: false, text: async () => '' }))).toBeNull();
    expect(await fetchLinkTitle('https://example.com', async () => { throw new Error('offline'); })).toBeNull();
    expect(await fetchLinkTitle('javascript:alert(1)', ok('<title>x</title>'))).toBeNull();
  });

  it('the Share screen fetches only on the Get title tap, and never keeps a password-like title', () => {
    const screen = readFileSync(resolve(__dirname, '..', 'app/share.tsx'), 'utf8');
    expect(screen).toContain('onPress={() => void getTitle()}');
    expect(screen).toContain('found && !findCredential(found)');
    expect(screen.match(/fetchLinkTitle\(/g)).toHaveLength(1);
  });
});
