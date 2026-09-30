/**
 * @jest-environment node
 */
// The app's file rules must match the upload page's (docs/files/filetypes.js):
// both implementations run on the same files here and must agree.
import { describe, expect, it } from '@jest/globals';
import { deflateRawSync } from 'zlib';

import * as page from '../../../docs/files/filetypes.js';
import * as app from './filetypes';

// A minimal zip writer (deflated entries), enough for .vsdx test files.
function zip(files: [string, string][]): Uint8Array {
  const le = (n: number, len: number) => {
    const b = Buffer.alloc(len);
    if (n) b.writeUIntLE(n, 0, len);
    return b;
  };
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nm = Buffer.from(name);
    const local = Buffer.concat([le(0x04034b50, 4), le(20, 2), le(0, 2), le(8, 2), le(0, 8), le(data.length, 4),
      le(raw.length, 4), le(nm.length, 2), le(0, 2), nm, data]);
    central.push(Buffer.concat([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(8, 2), le(0, 8),
      le(data.length, 4), le(raw.length, 4), le(nm.length, 2), le(0, 8), le(0, 4), le(offset, 4), nm]));
    parts.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  return new Uint8Array(Buffer.concat([...parts, cd, le(0x06054b50, 4), le(0, 4), le(files.length, 2),
    le(files.length, 2), le(cd.length, 4), le(offset, 4), le(0, 2)]));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const VSDX = zip([
  ['visio/document.xml', '<VisioDocument/>'],
  ['visio/pages/pages.xml',
    "<Pages><Page ID='0' Name='Call flow &amp; queues'><Rel r:id='rId1'/></Page><Page ID='1' NameU='Backup'><Rel r:id='rId2'/></Page></Pages>"],
  ['visio/pages/_rels/pages.xml.rels',
    "<Relationships><Relationship Id='rId1' Target='page1.xml'/><Relationship Id='rId2' Target='page2.xml'/></Relationships>"],
  ['visio/pages/page1.xml',
    '<PageContents><Shapes><Shape><Text>Ingress SBC</Text></Shape><Shape><Text><cp IX="0"/>Overflow\nqueue &#x2192; Zoë</Text></Shape><Shape><Text>Ingress SBC</Text></Shape></Shapes></PageContents>'],
  ['visio/pages/page2.xml', '<PageContents><Shapes><Shape><Text>Standby site</Text></Shape></Shapes></PageContents>'],
  ['visio/pages/page3.xml', '<PageContents><Shapes><Shape><Text>Unlisted page</Text></Shape></Shapes></PageContents>'],
]);
const NOT_VISIO = zip([['word/document.xml', '<w:document/>']]);

describe('file checks match the upload page', () => {
  const cases: [string, Uint8Array, number][] = [
    ['photo.png', PNG, 1000],
    ['Photo.JPG', JPEG, 1000],
    ['scan.jpeg', JPEG, 1000],
    ['routing.vsdx', VSDX, VSDX.length],
    ['old.vsd', OLE, 1000],
    ['fake.png', JPEG, 1000],
    ['renamed.jpg', PNG, 1000],
    ['doc.vsdx', OLE, 1000],
    ['notes.pdf', PNG, 1000],
    ['noext', PNG, 1000],
    ['huge.jpg', JPEG, 20 * 1024 * 1024 + 1],
    ['empty.png', new Uint8Array(), 0],
    [`${'x'.repeat(200)}.png`, PNG, 1000],
  ];
  it.each(cases)('%s', (name, head, size) => {
    expect(app.checkFile(name, head, size)).toEqual(page.checkFile(name, head, size));
  });

  it('gives the same storage names', () => {
    for (const name of ['Routing v2.vsdx', 'Zoë’s café.JPG', '../../etc/passwd.png', '...png', 'a/b\\c.jpeg',
      `${'long '.repeat(40)}.png`, 'résumé (final).vsd', 'no-ext']) {
      expect(app.storageName(name)).toBe(page.storageName(name));
    }
  });
});

describe('Visio text matches the upload page', () => {
  it('reads pages, shapes and connectors the same way', async () => {
    const mine = app.extractVsdxText(VSDX);
    expect(mine).toBe(await page.extractVsdxText(VSDX));
    expect(mine).toContain('Page: Call flow & queues');
    expect(mine).toContain('queue → Zoë');
    expect(mine).toContain('Unlisted page');
    expect(mine.match(/Ingress SBC/g)).toHaveLength(1);
  });

  it('refuses a zip that is not a Visio drawing', async () => {
    expect(() => app.extractVsdxText(NOT_VISIO)).toThrow('not a Visio drawing');
    await expect(page.extractVsdxText(NOT_VISIO)).rejects.toThrow('not a Visio drawing');
  });

  it('refuses a part larger than the limit before inflating it', () => {
    const [entry] = app.zipEntries(VSDX);
    expect(() => app.zipRead(VSDX, { ...entry, size: 10 }, 5)).toThrow('too large');
  });
});
