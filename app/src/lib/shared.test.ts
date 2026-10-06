import { describe, expect, it } from '@jest/globals';

import { draftFromShared, nothingUsable, parseShared, placeFromShared, sourceFor, type Shared } from './shared';

const CACHE = 'file:///data/user/0/com.zaf.wilma/cache/';

describe('parseShared', () => {
  it("keeps Android's content:// link and the module's cache copy", () => {
    // The shape ExpoShareIntentModule.kt sends for ACTION_SEND_MULTIPLE.
    const s = parseShared({
      type: 'file',
      files: [
        { contentUri: 'content://media/external/images/media/41', filePath: '/data/user/0/com.zaf.wilma/cache/PXL_1.jpg', fileName: 'PXL_1.jpg', fileSize: '2567402', mimeType: 'image/jpeg', width: '800', height: '600' },
        { contentUri: 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fnet.vsdx', filePath: '/storage/emulated/0/Download/net.vsdx', fileName: 'net.vsdx', fileSize: null, mimeType: 'application/octet-stream' },
      ],
    });
    expect(s.files).toEqual([
      { uri: 'content://media/external/images/media/41', copy: 'file:///data/user/0/com.zaf.wilma/cache/PXL_1.jpg', name: 'PXL_1.jpg', mimeType: 'image/jpeg', size: 2567402 },
      { uri: 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fnet.vsdx', copy: 'file:///storage/emulated/0/Download/net.vsdx', name: 'net.vsdx', mimeType: 'application/octet-stream', size: null },
    ]);
    expect(s.text).toBeNull();
  });

  it("skips the stray entry in Android's single-file answer", () => {
    const s = parseShared({ files: [{ contentUri: 'content://x/1', filePath: null, fileName: 'a.png', mimeType: 'image/png' }, { first: 'type', second: 'file' }] });
    expect(s.files).toEqual([{ uri: 'content://x/1', copy: null, name: 'a.png', mimeType: 'image/png', size: null }]);
  });

  it('reads shared text and the title Android passes along', () => {
    expect(parseShared({ type: 'text', text: 'https://example.com/a', meta: { title: ' Pasta night ' } })).toEqual({
      files: [],
      text: 'https://example.com/a',
      title: 'Pasta night',
    });
  });

  it("reads iOS's JSON string answer", () => {
    const s = parseShared(
      JSON.stringify({ files: [{ path: 'file:///group/x/IMG_1.jpg', fileName: 'IMG_1.jpg', mimeType: 'image/jpeg', fileSize: 10 }], type: 'media' }),
    );
    expect(s.files).toEqual([{ uri: 'file:///group/x/IMG_1.jpg', copy: null, name: 'IMG_1.jpg', mimeType: 'image/jpeg', size: 10 }]);
    const w = parseShared(JSON.stringify({ weburls: [{ url: 'https://example.com', meta: '{"title":"Example"}' }], type: 'weburl' }));
    expect(w).toMatchObject({ text: 'https://example.com', title: 'Example' });
  });

  it('gives nothing for empty or unreadable answers', () => {
    for (const v of [null, undefined, '', 'not json', 42, { files: null }, { text: '   ' }]) {
      const s = parseShared(v);
      expect(s).toEqual({ files: [], text: null, title: null });
      expect(nothingUsable(s)).toBe(true);
    }
  });
});

describe('draftFromShared', () => {
  const s = (over: Partial<Shared>): Shared => ({ files: [], text: null, title: null, ...over });

  it("uses the sending app's title", () => {
    expect(draftFromShared(s({ text: 'https://example.com/pasta', title: 'Pasta night' }))).toEqual({ title: 'Pasta night', body: 'https://example.com/pasta' });
  });

  it('names a bare link after its site', () => {
    expect(draftFromShared(s({ text: 'https://www.example.com/a/b?c=1' }))).toEqual({ title: 'Link from example.com', body: 'https://www.example.com/a/b?c=1' });
  });

  it('uses the first line of shared text, shortened', () => {
    expect(draftFromShared(s({ text: 'Check this recipe https://example.com/r\nmore' })).title).toBe('Check this recipe');
    const long = 'x'.repeat(200);
    expect(draftFromShared(s({ text: long })).title).toHaveLength(80);
  });

  it('leaves the title empty for files', () => {
    expect(draftFromShared(s({ files: [{ uri: 'content://x', copy: null }], text: 'caption from the app' }))).toEqual({ title: '', body: 'caption from the app' });
  });
});

describe('sourceFor', () => {
  it("uses the module's copy only when it is inside the app's cache", () => {
    expect(sourceFor({ uri: 'content://m/1', copy: `${CACHE}PXL_1.jpg` }, CACHE)).toEqual({ how: 'use', uri: `${CACHE}PXL_1.jpg` });
    expect(sourceFor({ uri: 'content://m/1', copy: `${CACHE}PXL_1.jpg` }, CACHE.slice(0, -1))).toEqual({ how: 'use', uri: `${CACHE}PXL_1.jpg` });
  });

  it('copies from the content:// link when the copy is a storage path Wilma may not read', () => {
    expect(sourceFor({ uri: 'content://s/1', copy: 'file:///storage/emulated/0/Download/net.vsdx' }, CACHE)).toEqual({ how: 'copy', uri: 'content://s/1' });
    expect(sourceFor({ uri: 'content://s/1', copy: `${CACHE}../files/x` }, CACHE)).toEqual({ how: 'copy', uri: 'content://s/1' });
    expect(sourceFor({ uri: 'content://s/1', copy: null }, CACHE)).toEqual({ how: 'copy', uri: 'content://s/1' });
  });

  it('reads anything else in place', () => {
    expect(sourceFor({ uri: 'file:///group/x/IMG_1.jpg', copy: null }, CACHE)).toEqual({ how: 'read', uri: 'file:///group/x/IMG_1.jpg' });
  });
});

describe('placeFromShared (Share in Google Maps -> Wilma)', () => {
  const s = (over: Partial<Shared>): Shared => ({ files: [], text: null, title: null, ...over });

  it("reads the owner's phone: the short link as text, the name as title", () => {
    expect(placeFromShared(s({ text: 'https://maps.app.goo.gl/JMCEPYcXfULRqPyc6', title: 'Hinode Sushi' }))).toEqual({
      name: 'Hinode Sushi',
      mapsUrl: 'https://maps.app.goo.gl/JMCEPYcXfULRqPyc6',
      address: '',
    });
    expect(placeFromShared(s({ text: 'https://maps.app.goo.gl/tmAtgRia88Gw9wbN9' }))).toEqual({
      name: '',
      mapsUrl: 'https://maps.app.goo.gl/tmAtgRia88Gw9wbN9',
      address: '',
    });
  });

  it('reads "Name / address / link" lines', () => {
    expect(placeFromShared(s({ text: 'Tawlet\nArmenia St, Mar Mikhael\nBeirut\nhttps://maps.app.goo.gl/AbC123' }))).toEqual({
      name: 'Tawlet',
      mapsUrl: 'https://maps.app.goo.gl/AbC123',
      address: 'Armenia St, Mar Mikhael, Beirut',
    });
    expect(placeFromShared(s({ title: 'Tawlet', text: 'Tawlet\nArmenia St\nhttps://maps.app.goo.gl/AbC123' }))).toEqual({
      name: 'Tawlet',
      mapsUrl: 'https://maps.app.goo.gl/AbC123',
      address: 'Armenia St',
    });
  });

  it('is not a place without a Google Maps link, or with files', () => {
    expect(placeFromShared(s({ text: 'https://example.com/maps.app.goo.gl' }))).toBeNull();
    expect(placeFromShared(s({ text: 'http://maps.app.goo.gl/AbC123' }))).toBeNull();
    expect(placeFromShared(s({ text: 'lunch tomorrow?' }))).toBeNull();
    expect(placeFromShared(s({ text: null }))).toBeNull();
    expect(placeFromShared(s({ text: 'https://maps.app.goo.gl/AbC123', files: [{ uri: 'content://x', copy: null }] }))).toBeNull();
  });
});
