import { describe, expect, it, jest } from '@jest/globals';

import { APP_TOOLS, fileSize, wilmaClient, WilmaError } from './wilma';

const URL = 'https://example.supabase.co/functions/v1/mcp';

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const toolResult = (data: unknown, isError = false) => ({
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }], ...(isError ? { isError } : {}) },
});

function setup(responses: Response[], opts: { token?: string | null; refreshed?: string | null } = {}) {
  const fetch = jest.fn(async (_url: string, _init: RequestInit) => responses.shift()!);
  const refresh = jest.fn(async () => (opts.refreshed === undefined ? 'token-2' : opts.refreshed));
  const client = wilmaClient({
    url: URL,
    token: async () => (opts.token === undefined ? 'token-1' : opts.token),
    refresh,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { client, fetch, refresh };
}

describe('wilma client', () => {
  it("calls the tool with the user's token as a JSON-RPC tools/call", async () => {
    const spaces = [{ id: 's1', path: 'Recipes', description: null, restricted: false }];
    const { client, fetch } = setup([reply(200, toolResult({ spaces }))]);
    expect(await client.listSpaces()).toEqual(spaces);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body as string)).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'list_spaces', arguments: {} },
    });
  });

  it('passes search, item and attachment arguments through', async () => {
    const { client, fetch } = setup([
      reply(200, toolResult({ results: [] })),
      reply(200, toolResult({ id: 'i1', title: 'Soup' })),
      reply(200, toolResult({ download_link: 'https://x/signed', expires_at: 'soon' })),
    ]);
    await client.search({ query: 'soup', limit: 25 });
    await client.getItem('i1');
    await client.attachmentLink('a1');
    const params = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).params);
    expect(params).toEqual([
      { name: 'search_items', arguments: { query: 'soup', limit: 25 } },
      { name: 'get_item', arguments: { item_id: 'i1' } },
      { name: 'get_attachment_link', arguments: { attachment_id: 'a1' } },
    ]);
  });

  it("shows a tool's own error message", async () => {
    const { client } = setup([reply(200, toolResult('Item not found', true))]);
    await expect(client.getItem('i1')).rejects.toThrow('Item not found');
  });

  it('refreshes the session once after a 401 and retries with the new token', async () => {
    const { client, fetch, refresh } = setup([reply(401, { error: 'unauthorized' }), reply(200, toolResult({ spaces: [] }))]);
    expect(await client.listSpaces()).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe('Bearer token-2');
  });

  it('reports a signed-out state when the session cannot be refreshed', async () => {
    const { client, fetch } = setup([reply(401, {})], { refreshed: null });
    const err = await client.listSpaces().catch((e) => e);
    expect(err).toBeInstanceOf(WilmaError);
    expect(err.signedOut).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh fails for lack of a connection', async () => {
    const { client, refresh } = setup([reply(401, {})]);
    refresh.mockRejectedValueOnce(new Error('offline'));
    const err = await client.listSpaces().catch((e) => e);
    expect(err.message).toMatch('Could not reach Wilma');
    expect(err.signedOut).toBe(false);
  });

  it('does not call the server without a session', async () => {
    const { client, fetch } = setup([], { token: null });
    await expect(client.listSpaces()).rejects.toMatchObject({ signedOut: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns network and server failures into plain messages', async () => {
    const down = setup([]);
    down.fetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(down.client.listSpaces()).rejects.toThrow('Could not reach Wilma');

    const broken = setup([reply(500, 'oops')]);
    await expect(broken.client.listSpaces()).rejects.toThrow('error 500');

    const garbled = setup([reply(200, 'not json')]);
    await expect(garbled.client.listSpaces()).rejects.toThrow('could not read');
  });

  it('uses the knowledge tools and only the vault tools that return names and links', () => {
    expect([...APP_TOOLS].sort()).toEqual([
      'attach_file', 'create_space', 'delete_attachment', 'delete_item', 'delete_secret', 'delete_space', 'find_secret',
      'get_attachment_link', 'get_item', 'get_secret', 'list_deleted_items', 'list_spaces', 'purge_item', 'restore_item', 'save_item', 'save_secret',
      'search_items', 'update_secret',
    ]);
    expect(Object.keys(setup([]).client).sort()).toEqual(
      ['attachmentLink', 'createSpace', 'deleteAttachment', 'deleteItem', 'deleteSecret', 'deleteSpace', 'findSecrets', 'getItem', 'listSpaces',
        'newValueLink', 'purgeItem', 'recycleBin', 'restoreItem', 'revealLink', 'saveItem', 'saveSecret', 'search', 'updateSecret',
        'uploadLink'],
    );
  });

  it('creates a space with only the fields given', async () => {
    const { client, fetch } = setup([
      reply(200, toolResult({ id: 's9', path: 'Recipes', restricted: false })),
      reply(200, toolResult({ id: 's10', path: 'Work/Gartner', restricted: true })),
    ]);
    expect((await client.createSpace({ name: 'Recipes' })).path).toBe('Recipes');
    await client.createSpace({ name: 'Gartner', parent: 's1', description: 'Client work', restricted: true });
    const params = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).params);
    expect(params).toEqual([
      { name: 'create_space', arguments: { name: 'Recipes' } },
      { name: 'create_space', arguments: { name: 'Gartner', parent: 's1', description: 'Client work', restricted: true } },
    ]);
  });

  it('saves, changes and deletes secrets with metadata only (never a value)', async () => {
    const entry = { entry_link: 'https://x/vault/enter#t=abc', expires_at: 'soon' };
    const { client, fetch } = setup([
      reply(200, toolResult({ ...entry, secret: { id: 's2' } })),
      reply(200, toolResult({ ...entry, secret: { id: 's3' } })),
      reply(200, toolResult({ ...entry, secret: { id: 's1' } })),
      reply(200, toolResult({ secret: { id: 's1', name: 'Home router' } })),
      reply(200, toolResult({ secret: { id: 's1' } })),
      reply(200, toolResult({ deleted: true, id: 's1', name: 'Home router' })),
    ]);
    await client.saveSecret({ space: 'Logins', name: 'Router', secret_type: 'wifi', url: 'http://192.168.1.1' });
    await client.saveSecret({ space: 'Logins', name: 'Bank', secret_type: 'login', url: '' });
    await client.newValueLink('s1');
    await client.updateSecret('s1', { name: 'Home router' });
    await client.updateSecret('s1', { url: '' });
    await client.deleteSecret('s1');
    const params = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).params);
    expect(params).toEqual([
      { name: 'save_secret', arguments: { space: 'Logins', name: 'Router', secret_type: 'wifi', url: 'http://192.168.1.1' } },
      { name: 'save_secret', arguments: { space: 'Logins', name: 'Bank', secret_type: 'login' } },
      { name: 'update_secret', arguments: { secret_id: 's1', new_value: true } },
      { name: 'update_secret', arguments: { secret_id: 's1', name: 'Home router' } },
      { name: 'update_secret', arguments: { secret_id: 's1', url: '' } },
      { name: 'delete_secret', arguments: { secret_id: 's1' } },
    ]);
  });

  it('asks for secrets by id and lists them with a limit', async () => {
    const { client, fetch } = setup([
      reply(200, toolResult({ results: [{ id: 's1', name: 'Router', secret_type: 'wifi' }] })),
      reply(200, toolResult({ secret: { id: 's1' }, reveal_link: 'https://x/vault/reveal#t=abc', expires_at: 'soon' })),
    ]);
    expect((await client.findSecrets())[0].name).toBe('Router');
    expect((await client.revealLink('s1')).reveal_link).toContain('#t=');
    const args = fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).params);
    expect(args).toEqual([
      { name: 'find_secret', arguments: { limit: 50 } },
      { name: 'get_secret', arguments: { secret_id: 's1' } },
    ]);
  });

  it('saves a note and asks for upload links with the right arguments', async () => {
    const { client, fetch } = setup([
      reply(200, toolResult({ id: 'i9', space: 'Recipes' })),
      reply(200, toolResult({ upload_link: 'https://x/upload#t=abc', expires_at: 'soon', item: { id: 'i9', title: 'Soup', created: false } })),
      reply(200, toolResult({ upload_link: 'https://x/upload#t=def', expires_at: 'soon', item: { id: 'i10', title: 'Board', created: true } })),
    ]);
    await client.saveItem({ space: 's1', title: 'Soup', body: 'Lentils' });
    await client.uploadLink({ item_id: 'i9' });
    await client.uploadLink({ space: 's1', title: 'Board', note: 'Tuesday' });
    const params = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).params);
    expect(params).toEqual([
      { name: 'save_item', arguments: { space: 's1', title: 'Soup', body: 'Lentils', item_type: 'note' } },
      { name: 'attach_file', arguments: { item_id: 'i9' } },
      { name: 'attach_file', arguments: { space: 's1', title: 'Board', note: 'Tuesday' } },
    ]);
  });
});

describe('deleting', () => {
  it('sends each delete to the right tool', async () => {
    const answers = [{ deleted: true }, { in_recycle_bin: true }, { items: [] }, { restored: true }, { purged: true }, { deleted: true }];
    const { client, fetch } = setup(answers.map((a) => reply(200, toolResult(a))));
    await client.deleteAttachment('a1');
    await client.deleteItem('i1');
    await client.recycleBin();
    await client.restoreItem('i1');
    await client.purgeItem('i1');
    await client.deleteSpace('s1');
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).params)).toEqual([
      { name: 'delete_attachment', arguments: { attachment_id: 'a1' } },
      { name: 'delete_item', arguments: { item_id: 'i1' } },
      { name: 'list_deleted_items', arguments: { limit: 200 } },
      { name: 'restore_item', arguments: { item_id: 'i1' } },
      { name: 'purge_item', arguments: { item_id: 'i1' } },
      { name: 'delete_space', arguments: { space: 's1' } },
    ]);
  });

  it("shows the server's reason when a space is not empty", async () => {
    const { client } = setup([reply(200, toolResult('Could not delete the space: "Recipes" is not empty: it still holds 2 notes.', true))]);
    await expect(client.deleteSpace('s1')).rejects.toThrow('it still holds 2 notes');
  });
});

describe('fileSize', () => {
  it('reads like people talk', () => {
    expect(fileSize(null)).toBe('');
    expect(fileSize(120)).toBe('120 bytes');
    expect(fileSize(830 * 1024)).toBe('830 KB');
    expect(fileSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });
});
