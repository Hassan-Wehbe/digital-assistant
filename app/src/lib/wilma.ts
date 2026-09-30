// Wilma's tools, called on the existing MCP server (supabase/functions/mcp/) with
// the signed-in user's access token. Each call runs as that user on the server,
// so Row Level Security and the restricted-space rules apply exactly as they do
// for the Claude app. Plain JSON-RPC `tools/call` requests: the server is
// stateless and answers with JSON.

/**
 * The tools this version of the app uses. The vault tools return metadata and one-time
 * links only; values are decrypted on the phone (vault.tsx), never passed through Wilma.
 */
export const APP_TOOLS = [
  'list_spaces',
  'create_space',
  'search_items',
  'get_item',
  'get_attachment_link',
  'save_item',
  'attach_file',
  'delete_attachment',
  'delete_item',
  'list_deleted_items',
  'restore_item',
  'purge_item',
  'delete_space',
  'find_secret',
  'get_secret',
  'save_secret',
  'update_secret',
  'delete_secret',
] as const;
export type AppTool = (typeof APP_TOOLS)[number];

export interface Space {
  id: string;
  path: string;
  description: string | null;
  restricted: boolean;
}

export interface NewSpace {
  name: string;
  /** Parent space id (the new space goes inside it). */
  parent?: string;
  description?: string;
  restricted?: boolean;
}

export interface SearchResult {
  id: string;
  title: string;
  item_type: string;
  space: string | undefined;
  tags: string[] | null;
  snippet: string | null;
  updated_at: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  caption: string | null;
  description: string | null;
  extracted_text: string | null;
  extracted_text_truncated: boolean;
  created_at: string;
}

export interface ItemLink {
  direction: 'outgoing' | 'incoming';
  relation: string;
  item_id: string;
  title: string;
  item_type: string;
}

export interface Item {
  id: string;
  title: string;
  item_type: string;
  summary: string | null;
  body_markdown: string | null;
  created_at: string;
  updated_at: string;
  space: { id: string; name: string; path?: string; is_restricted: boolean };
  tags: string[];
  attachments: Attachment[];
  links: ItemLink[];
  revision_count: number;
}

export interface NewItem {
  space: string;
  title: string;
  body: string;
  item_type?: string;
}

export interface UploadLink {
  upload_link: string;
  expires_at: string;
  item: { id: string; title: string; space?: string; created: boolean };
}

export interface SecretMeta {
  id: string;
  name: string;
  url: string | null;
  secret_type: string;
  space: string | undefined;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
}

export interface RevealLink {
  secret: SecretMeta;
  reveal_link: string;
  expires_at: string;
}

/** A one-time link where a value is entered (sealed on the phone, never sent to Wilma). */
export interface EntryLink {
  entry_link: string;
  expires_at: string;
}

export interface NewSecret {
  space: string;
  name: string;
  secret_type: string;
  url?: string;
}

export interface BinItem {
  id: string;
  title: string;
  item_type: string;
  space: string | undefined;
  deleted_at: string;
  attachments: number;
}

export interface AttachmentLink {
  download_link: string;
  expires_at: string;
}

/** A tool or server answer the user should see (never contains secret values). */
export class WilmaError extends Error {
  constructor(
    message: string,
    readonly signedOut = false,
  ) {
    super(message);
    this.name = 'WilmaError';
  }
}

export interface ClientOptions {
  url: string;
  /** The current access token, or null when signed out. */
  token: () => Promise<string | null>;
  /** Called once after a 401; returns a fresh token, or null if the session is over. */
  refresh: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function wilmaClient({ url, token, refresh, fetch: f = fetch }: ClientOptions) {
  let n = 0;

  async function post(accessToken: string, name: AppTool, args: object): Promise<Response> {
    return f(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
    });
  }

  async function call<T>(name: AppTool, args: object = {}): Promise<T> {
    if (!APP_TOOLS.includes(name)) throw new WilmaError(`The app does not use ${name}.`);
    let accessToken = await token();
    if (!accessToken) throw new WilmaError('Please sign in again.', true);

    let res: Response;
    try {
      res = await post(accessToken, name, args);
      if (res.status === 401) {
        accessToken = await refresh();
        if (!accessToken) throw new WilmaError('Your session has ended. Please sign in again.', true);
        res = await post(accessToken, name, args);
        if (res.status === 401) throw new WilmaError('Your session has ended. Please sign in again.', true);
      }
    } catch (e) {
      if (e instanceof WilmaError) throw e;
      throw new WilmaError('Could not reach Wilma. Check your connection and try again.');
    }
    if (!res.ok) throw new WilmaError(`Wilma is not available right now (error ${res.status}).`);

    let body: { result?: { isError?: boolean; content?: { type: string; text?: string }[] }; error?: { message?: string } };
    try {
      body = await res.json();
    } catch {
      throw new WilmaError('Wilma sent an answer the app could not read.');
    }
    if (body.error) throw new WilmaError(body.error.message ?? 'Wilma could not do that.');
    const text = body.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (body.result?.isError) throw new WilmaError(text || 'Wilma could not do that.');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WilmaError('Wilma sent an answer the app could not read.');
    }
  }

  return {
    listSpaces: async () => (await call<{ spaces: Space[] }>('list_spaces')).spaces,
    createSpace: (space: NewSpace) => call<{ id: string; path: string; restricted: boolean }>('create_space', space),
    // close_matches_only: loosely related items are left out ("password" no longer finds a recipe).
    search: async (opts: { query?: string; space?: string; limit?: number; close_matches_only?: boolean }) =>
      (await call<{ results: SearchResult[] }>('search_items', opts)).results,
    getItem: (id: string) => call<Item>('get_item', { item_id: id }),
    attachmentLink: (id: string) => call<AttachmentLink>('get_attachment_link', { attachment_id: id }),
    saveItem: ({ space, title, body, item_type = 'note' }: NewItem) =>
      call<{ id: string; space: string }>('save_item', { space, title, body, item_type }),
    /** A one-time upload link for an existing item, or for a new one (space + title + note). */
    uploadLink: (target: { item_id: string } | { space: string; title: string; note?: string }) =>
      call<UploadLink>('attach_file', target),
    // Deleting. Notes go to the recycle bin first; purge deletes a binned note for good.
    deleteAttachment: (id: string) => call<{ deleted: boolean }>('delete_attachment', { attachment_id: id }),
    deleteItem: (id: string) => call<{ in_recycle_bin: boolean }>('delete_item', { item_id: id }),
    recycleBin: async () => (await call<{ items: BinItem[] }>('list_deleted_items', { limit: 200 })).items,
    restoreItem: (id: string) => call<{ restored: boolean }>('restore_item', { item_id: id }),
    purgeItem: (id: string) => call<{ purged: boolean }>('purge_item', { item_id: id }),
    /** Only an empty space can be deleted; otherwise the error says what is still inside. */
    deleteSpace: (id: string) => call<{ deleted: boolean }>('delete_space', { space: id }),
    // Vault: names and one-time links only (restricted spaces are never listed).
    findSecrets: async (opts: { query?: string; limit?: number } = {}) =>
      (await call<{ results: SecretMeta[] }>('find_secret', { limit: 50, ...opts })).results,
    revealLink: (secretId: string) => call<RevealLink>('get_secret', { secret_id: secretId }),
    /** Starts a new secret: metadata only. It exists once its value arrives through the entry link. */
    saveSecret: ({ space, name, secret_type, url }: NewSecret) =>
      call<EntryLink & { secret: { id: string; name: string; secret_type: string; space: string } }>('save_secret', {
        space,
        name,
        secret_type,
        ...(url ? { url } : {}),
      }),
    /** An entry link for a new value of an existing secret. */
    newValueLink: (secretId: string) => call<EntryLink & { secret: SecretMeta }>('update_secret', { secret_id: secretId, new_value: true }),
    /** Rename, or change the website (an empty url removes it). */
    updateSecret: (secretId: string, change: { name?: string; url?: string }) =>
      call<{ secret: SecretMeta }>('update_secret', { secret_id: secretId, ...change }),
    /** Deletes for good (the access log keeps a record that it existed). */
    deleteSecret: (secretId: string) => call<{ deleted: boolean; id: string; name: string }>('delete_secret', { secret_id: secretId }),
  };
}

export type WilmaClient = ReturnType<typeof wilmaClient>;

/** "2.4 MB", "830 KB", "120 bytes" */
export function fileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
