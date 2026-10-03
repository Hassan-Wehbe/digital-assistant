// Reads the `chat` function's answer: newline-delimited JSON, one event per line, always
// ending with `done` (docs/phase5-a5b-chat-function-plan.md "As built: step 3"). Pure logic:
// the caller hands in the response body's reader (or any chunks), so the tests need no phone.
//
// Lines that are not valid JSON and event types this app does not know are skipped, so the
// server can add events later without breaking older app versions. A stream that ends (or
// breaks) without `done` becomes the usual "trouble connecting" error. A vault event's `link`
// is dropped here, as it is read: the app opens its own vault screen and never keeps the link.

/** The server's own wording for a lost connection (supabase/functions/chat/messages.ts). */
export const CONNECTION_MESSAGE = "I'm having trouble connecting. Try again in a moment.";

export type ChatEvent =
  | { type: 'notice'; code: string; message: string }
  | { type: 'status'; tool: string; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'confirm';
      tool: string;
      args: Record<string, unknown>;
      target: { id: string; title: string };
      message: string;
      confirm_label: string;
      cancel_label: string;
    }
  | {
      type: 'vault';
      action: 'reveal' | 'enter';
      secret_id: string;
      name: string;
      secret_type?: string;
      /** The id is for a secret that exists only once its value is entered (save_secret). */
      new_secret?: true;
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; counted: boolean };

/** A response body reader, or any source of byte chunks (tests). */
export type ChunkSource = Pick<ReadableStreamDefaultReader<Uint8Array>, 'read' | 'cancel'> | AsyncIterable<Uint8Array>;

const str = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One parsed line → a known, well-formed event (copied field by field), or null. */
export function toChatEvent(raw: unknown): ChatEvent | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'notice':
    case 'error':
      return str(raw.code) && str(raw.message) ? { type: raw.type, code: raw.code, message: raw.message } : null;
    case 'status':
      return str(raw.tool) && str(raw.text) ? { type: 'status', tool: raw.tool, text: raw.text } : null;
    case 'text':
      return str(raw.text) ? { type: 'text', text: raw.text } : null;
    case 'confirm': {
      const t = raw.target;
      if (!str(raw.tool) || !isObject(raw.args) || !isObject(t) || !str(t.id) || !str(t.title)) return null;
      if (!str(raw.message) || !str(raw.confirm_label) || !str(raw.cancel_label)) return null;
      return {
        type: 'confirm',
        tool: raw.tool,
        args: { ...raw.args },
        target: { id: t.id, title: t.title },
        message: raw.message,
        confirm_label: raw.confirm_label,
        cancel_label: raw.cancel_label,
      };
    }
    case 'vault':
      // `link` and `expires_at` are deliberately not copied (CLAUDE.md rule 1).
      if ((raw.action !== 'reveal' && raw.action !== 'enter') || !str(raw.secret_id) || !str(raw.name)) return null;
      return {
        type: 'vault',
        action: raw.action,
        secret_id: raw.secret_id,
        name: raw.name,
        ...(str(raw.secret_type) ? { secret_type: raw.secret_type } : {}),
        ...(raw.new_secret === true ? { new_secret: true as const } : {}),
      };
    case 'done':
      return { type: 'done', counted: raw.counted === true };
    default:
      return null;
  }
}

function parseLine(line: string): ChatEvent | null {
  if (!line.trim()) return null;
  try {
    return toChatEvent(JSON.parse(line));
  } catch {
    return null;
  }
}

function chunksOf(source: ChunkSource): { next(): Promise<Uint8Array | null>; stop(): void } {
  if (Symbol.asyncIterator in source) {
    const it = source[Symbol.asyncIterator]();
    return {
      next: async () => {
        const r = await it.next();
        return r.done ? null : r.value;
      },
      stop: () => void it.return?.()?.catch(() => {}),
    };
  }
  return {
    next: async () => {
      const r = await source.read();
      return r.done ? null : (r.value ?? new Uint8Array());
    },
    stop: () => void source.cancel().catch(() => {}),
  };
}

const connectionLost: ChatEvent[] = [
  { type: 'error', code: 'connection', message: CONNECTION_MESSAGE },
  { type: 'done', counted: false },
];

/**
 * The events of one answer, in order. Always finishes with `done`, unless `signal` was aborted
 * (Stop, leaving, signing out): then it simply stops, without an error.
 */
export async function* readChatEvents(source: ChunkSource, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const chunks = chunksOf(source);
  const decoder = new TextDecoder('utf-8');
  let buffered = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      let chunk: Uint8Array | null;
      try {
        chunk = await chunks.next();
      } catch {
        if (signal?.aborted) return;
        yield* connectionLost;
        return;
      }
      if (signal?.aborted) return;
      // `stream: true` keeps a character split across two chunks (é, an Arabic letter) intact.
      buffered += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
      const lines = buffered.split('\n');
      buffered = chunk ? lines.pop()! : '';
      for (const line of lines) {
        const event = parseLine(line);
        if (!event) continue;
        yield event;
        if (event.type === 'done') return;
        if (signal?.aborted) return;
      }
      if (!chunk) {
        yield* connectionLost;
        return;
      }
    }
  } finally {
    chunks.stop();
  }
}
