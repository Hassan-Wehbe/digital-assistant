import { describe, expect, it, jest } from '@jest/globals';

import { describePicked, fileName, photoName, preparePicked } from './picked';
import { fileSize } from './wilma';

const NOW = new Date(2026, 8, 30, 14, 5);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe('names', () => {
  it('gives camera photos a readable name', () => {
    expect(photoName('image/jpeg', NOW)).toBe('Photo 2026-09-30 14.05.jpg');
    expect(photoName('image/png', NOW)).toBe('Photo 2026-09-30 14.05.png');
    expect(fileName({ uri: 'file:///x', name: null, mimeType: 'image/jpeg' }, NOW)).toBe('Photo 2026-09-30 14.05.jpg');
  });

  it("keeps the picker's name, adding an extension only when missing", () => {
    expect(fileName({ uri: 'x', name: 'IMG_1234.JPG' })).toBe('IMG_1234.JPG');
    expect(fileName({ uri: 'x', name: 'scan', mimeType: 'image/png' })).toBe('scan.png');
    expect(fileName({ uri: 'x', name: 'Routing v2.vsdx', mimeType: 'application/octet-stream' })).toBe('Routing v2.vsdx');
  });
});

describe('preparePicked', () => {
  it('accepts a JPEG and a PNG with the same rules as the upload page', async () => {
    const a = await preparePicked({ uri: 'file:///a', name: 'a.jpg' }, JPEG.length, async () => JPEG, NOW);
    expect(a).toMatchObject({ ok: true, file: { name: 'a.jpg', type: 'jpeg', mime: 'image/jpeg', text: null, caption: '' } });
    const b = await preparePicked({ uri: 'file:///b', name: null, mimeType: 'image/png' }, PNG.length, async () => PNG, NOW);
    expect(b).toMatchObject({ ok: true, file: { name: 'Photo 2026-09-30 14.05.png', type: 'png' } });
  });

  it('refuses a file whose contents do not match its name', async () => {
    const r = await preparePicked({ uri: 'x', name: 'fake.png' }, JPEG.length, async () => JPEG);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('fake.png: The file\'s contents are not a PNG picture') });
  });

  it('explains HEIC and other phone formats instead of failing silently', async () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    const r = await preparePicked({ uri: 'x', name: 'IMG_1.heic', mimeType: 'image/heic' }, heic.length, async () => heic);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/format Wilma does not take yet/);
  });

  it('refuses files over 20 MB without reading them', async () => {
    const read = jest.fn(async () => JPEG);
    const r = await preparePicked({ uri: 'x', name: 'big.jpg' }, 20 * 1024 * 1024 + 1, read);
    expect(r).toEqual({ ok: false, error: 'big.jpg: this file is larger than 20 MB.' });
    expect(read).not.toHaveBeenCalled();
  });

  it('describes files for the list', async () => {
    const r = await preparePicked({ uri: 'x', name: 'a.jpg' }, JPEG.length, async () => JPEG);
    if (!r.ok) throw new Error('expected ok');
    expect(describePicked({ ...r.file, size: 2.4 * 1024 * 1024 }, fileSize)).toBe('JPEG picture, 2.4 MB');
    expect(describePicked({ ...r.file, type: 'vsdx', text: 'Page: One\nIngress SBC' }, fileSize)).toMatch(/4 words of diagram text/);
    expect(describePicked({ ...r.file, type: 'vsd' }, fileSize)).toMatch(/older Visio format/);
  });
});
