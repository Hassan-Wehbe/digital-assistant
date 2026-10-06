import { describe, expect, it, jest } from '@jest/globals';

import { saveNote } from './saveNote';
import type { PickedFile, UploadDeps } from './upload';
import type { UploadLink, WilmaClient } from './wilma';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const USER = '00000000-0000-4000-a000-00000000000a';
const photo: PickedFile = { key: 'a', name: 'a.jpg', uri: 'file:///cache/a.jpg', size: 3, type: 'jpeg', mime: 'image/jpeg', text: null, caption: 'Dinner' };

function fakes() {
  const saveItem = jest.fn<WilmaClient['saveItem']>(async () => ({ id: 'new-1', space: 'Recipes' }));
  const uploadLink = jest.fn<WilmaClient['uploadLink']>(
    async (t): Promise<UploadLink> => ({
      upload_link: `https://x/upload#t=${TOKEN}`,
      expires_at: '',
      item: { id: 'item_id' in t ? t.item_id : 'new-2', title: 'T', created: !('item_id' in t) },
    }),
  );
  const deps: UploadDeps = {
    rpc: async (fn, args) =>
      fn === 'get_attachment_upload_request'
        ? { data: { user_id: USER, upload_ids: ['11111111-1111-4111-8111-111111111111'] }, error: null }
        : { data: { item_id: 'x', item_title: 'T', attachments: (args.p_files as { filename: string }[]) }, error: null },
    put: async () => {},
    remove: async () => {},
    embedPending: () => {},
  };
  return { wilma: { saveItem, uploadLink }, saveItem, uploadLink, deps };
}

describe('saveNote', () => {
  it('saves a note without files with save_item', async () => {
    const f = fakes();
    const onCreated = jest.fn();
    const out = await saveNote(f.wilma, { space: 'Recipes', title: 'Pasta', body: 'https://example.com' }, [], f.deps, { onCreated });
    expect(out).toEqual({ itemId: 'new-1', failed: [] });
    expect(f.saveItem).toHaveBeenCalledWith({ space: 'Recipes', title: 'Pasta', body: 'https://example.com' });
    expect(onCreated).toHaveBeenCalledWith('new-1');
    expect(f.uploadLink).not.toHaveBeenCalled();
  });

  it('creates the note and uploads in one step when there are files', async () => {
    const f = fakes();
    const onCreated = jest.fn();
    const out = await saveNote(f.wilma, { space: 'Recipes', title: 'Pasta', body: '' }, [photo], f.deps, { onCreated });
    expect(f.uploadLink).toHaveBeenCalledWith({ space: 'Recipes', title: 'Pasta', note: '' });
    expect(onCreated).toHaveBeenCalledWith('new-2');
    expect(out).toEqual({ itemId: 'new-2', failed: [] });
    expect(f.saveItem).not.toHaveBeenCalled();
  });

  it('adds files to an existing note without creating one', async () => {
    const f = fakes();
    const out = await saveNote(f.wilma, { itemId: 'old-7' }, [photo], f.deps);
    expect(f.uploadLink).toHaveBeenCalledWith({ item_id: 'old-7' });
    expect(out.itemId).toBe('old-7');
    expect(f.saveItem).not.toHaveBeenCalled();
  });

  it('reports the note as created before an upload fails, so a retry reuses it', async () => {
    const f = fakes();
    f.deps.put = async () => {
      throw new Error('offline');
    };
    const onCreated = jest.fn();
    await expect(saveNote(f.wilma, { space: 'Recipes', title: 'Pasta', body: '' }, [photo], f.deps, { onCreated })).rejects.toThrow(/Nothing was uploaded/);
    expect(onCreated).toHaveBeenCalledWith('new-2');
  });
});

describe('saveNote: places', () => {
  const place = { address: 'Armenia St, Beirut', kind: 'restaurant' as const, status: 'want' as const };

  it('saves a place with save_item, with its fields', async () => {
    const f = fakes();
    const out = await saveNote(f.wilma, { space: 'Restaurants', title: 'Tawlet', body: '', place }, [], f.deps);
    expect(f.saveItem).toHaveBeenCalledWith({ space: 'Restaurants', title: 'Tawlet', body: '', item_type: 'place', metadata: place });
    expect(out).toEqual({ itemId: 'new-1', failed: [] });
    expect(f.uploadLink).not.toHaveBeenCalled();
  });

  it('with photos, saves the place first (the server checks its fields), then adds the photos to it', async () => {
    const f = fakes();
    const onCreated = jest.fn();
    const out = await saveNote(f.wilma, { space: 'Restaurants', title: 'Tawlet', body: '', place }, [photo], f.deps, { onCreated });
    expect(f.saveItem).toHaveBeenCalledWith({ space: 'Restaurants', title: 'Tawlet', body: '', item_type: 'place', metadata: place });
    expect(f.uploadLink).toHaveBeenCalledWith({ item_id: 'new-1' });
    expect(onCreated).toHaveBeenCalledWith('new-1');
    expect(out).toEqual({ itemId: 'new-1', failed: [] });
  });
});
