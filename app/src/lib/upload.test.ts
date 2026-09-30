import { describe, expect, it, jest } from '@jest/globals';

import { linkToken, uploadToLink, type PickedFile, type UploadDeps } from './upload';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const LINK = `https://hassan-wehbe.github.io/digital-assistant/files/upload#t=${TOKEN}`;
const USER = '00000000-0000-4000-a000-00000000000a';
const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

const file = (name: string, extra: Partial<PickedFile> = {}): PickedFile => ({
  key: name, name, uri: `file:///cache/${name}`, size: 100, type: 'jpeg', mime: 'image/jpeg', text: null, caption: '', ...extra,
});

type RpcFn = UploadDeps['rpc'];
type PutFn = UploadDeps['put'];

function deps(over: { put?: PutFn } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = jest.fn<RpcFn>(async (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'get_attachment_upload_request') return { data: { user_id: USER, upload_ids: IDS, max_files: 10 }, error: null };
    return {
      data: { item_id: 'item-1', item_title: 'Routing design', attachments: (args.p_files as { filename: string }[]).map((f) => ({ filename: f.filename })) },
      error: null,
    };
  });
  const put = jest.fn<PutFn>(over.put ?? (async () => {}));
  const remove = jest.fn<UploadDeps['remove']>(async () => {});
  const embedPending = jest.fn<UploadDeps['embedPending']>();
  const d = { rpc, put, remove, embedPending };
  return { d, deps: d as UploadDeps, calls };
}

describe('linkToken', () => {
  it('reads the token from the fragment only', () => {
    expect(linkToken(LINK)).toBe(TOKEN);
    expect(linkToken(`https://x/upload#a=1&t=${TOKEN}`)).toBe(TOKEN);
    expect(linkToken(`https://x/upload?t=${TOKEN}`)).toBeNull();
    expect(linkToken('https://x/upload#t=short')).toBeNull();
    expect(linkToken('https://x/upload#t=bad<script>chars12345678901')).toBeNull();
  });
});

describe('uploadToLink', () => {
  it('uploads each file to its reserved path, then records them with captions and Visio text', async () => {
    const { d, deps: u, calls } = deps();
    const out = await uploadToLink(LINK, [
      file('Whiteboard photo.jpg', { caption: '  Tuesday session  ' }),
      file('Routing v2.vsdx', { type: 'vsdx', mime: 'application/vnd.ms-visio.drawing', text: 'Page: Call flow' }),
    ], u);

    expect(d.put.mock.calls.map(([path]) => path)).toEqual([
      `${USER}/${IDS[0]}/Whiteboard_photo.jpg`,
      `${USER}/${IDS[1]}/Routing_v2.vsdx`,
    ]);
    expect(calls[0]).toEqual({ fn: 'get_attachment_upload_request', args: { p_token: TOKEN } });
    expect(calls[1].fn).toBe('complete_attachment_upload');
    expect(calls[1].args).toEqual({
      p_token: TOKEN,
      p_files: [
        { attachment_id: IDS[0], filename: 'Whiteboard photo.jpg', storage_name: 'Whiteboard_photo.jpg', caption: 'Tuesday session', extracted_text: null },
        { attachment_id: IDS[1], filename: 'Routing v2.vsdx', storage_name: 'Routing_v2.vsdx', caption: null, extracted_text: 'Page: Call flow' },
      ],
      p_description_for: null,
    });
    expect(d.embedPending).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ itemId: 'item-1', itemTitle: 'Routing design', attached: ['Whiteboard photo.jpg', 'Routing v2.vsdx'], failed: [] });
  });

  it('records the files that made it and reports the ones that did not', async () => {
    const { deps: u, calls } = deps({
      put: async (_path, f) => {
        if (f.name === 'b.jpg') throw new Error('network error');
      },
    });
    const out = await uploadToLink(LINK, [file('a.jpg'), file('b.jpg'), file('c.jpg')], u);
    expect((calls[1].args.p_files as { filename: string }[]).map((f) => f.filename)).toEqual(['a.jpg', 'c.jpg']);
    expect(out.failed).toEqual(['b.jpg: network error']);
  });

  it('removes the uploaded files again when the database refuses them', async () => {
    const { d, deps: u } = deps();
    d.rpc.mockImplementation(async (fn) =>
      fn === 'get_attachment_upload_request'
        ? { data: { user_id: USER, upload_ids: IDS }, error: null }
        : { data: null, error: { message: 'this link has expired', code: 'PT410' } },
    );
    await expect(uploadToLink(LINK, [file('a.jpg')], u)).rejects.toThrow('this link has expired');
    expect(d.remove).toHaveBeenCalledWith([`${USER}/${IDS[0]}/a.jpg`]);
    expect(d.embedPending).not.toHaveBeenCalled();
  });

  it('keeps the files when the answer is lost (they may be attached already)', async () => {
    const { d, deps: u } = deps();
    d.rpc.mockImplementation(async (fn) =>
      fn === 'get_attachment_upload_request'
        ? { data: { user_id: USER, upload_ids: IDS }, error: null }
        : { data: null, error: { message: 'Failed to fetch' } },
    );
    await expect(uploadToLink(LINK, [file('a.jpg')], u)).rejects.toThrow('may already be attached');
    expect(d.remove).not.toHaveBeenCalled();
  });

  it('stops before sending anything when the link is unusable', async () => {
    const { d, deps: u } = deps();
    d.rpc.mockImplementation(async () => ({ data: null, error: { message: 'this link has expired or was already used', code: 'PT410' } }));
    await expect(uploadToLink(LINK, [file('a.jpg')], u)).rejects.toThrow('expired');
    expect(d.put).not.toHaveBeenCalled();
    await expect(uploadToLink('https://x/upload', [file('a.jpg')], u)).rejects.toThrow('could not read');
  });

  it('never reuses a reserved id, and refuses more files than the link allows', async () => {
    const { d, deps: u } = deps();
    const out = await uploadToLink(LINK, [file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg')], u);
    expect(new Set(d.put.mock.calls.map(([p]) => p.split('/')[1])).size).toBe(3);
    expect(out.failed).toEqual(['4.jpg: too many files for one link']);
    const many = Array.from({ length: 11 }, (_, i) => file(`${i}.jpg`));
    await expect(uploadToLink(LINK, many, u)).rejects.toThrow('At most 10');
  });
});
