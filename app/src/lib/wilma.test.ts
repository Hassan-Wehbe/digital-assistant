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

  it('uses only the read tools (no vault tools in this version)', () => {
    expect([...APP_TOOLS].sort()).toEqual(['get_attachment_link', 'get_item', 'list_spaces', 'search_items']);
    expect(APP_TOOLS.some((t) => /secret/.test(t))).toBe(false);
    expect(Object.keys(setup([]).client).sort()).toEqual(['attachmentLink', 'getItem', 'listSpaces', 'search']);
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
