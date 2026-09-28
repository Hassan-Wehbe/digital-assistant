// Embeddings with Supabase's built-in gte-small model (384 dimensions).
// Runs inside the Edge Function: no external AI service, no API key.
/// <reference path="./supabase-ai.d.ts" />
import { chunkText, itemText, type ItemText, MAX_CHUNKS } from "./chunk.ts";

export const EMBEDDING_DIMENSIONS = 384;

let session: Supabase.ai.Session | undefined;

/** Embed one text; returns pgvector text form, e.g. "[0.01,-0.2,...]". */
export async function embed(text: string): Promise<string> {
  session ??= new Supabase.ai.Session("gte-small");
  const output = (await session.run(text, { mean_pool: true, normalize: true })) as number[];
  if (!Array.isArray(output) || output.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("embedding model returned an unexpected result");
  }
  return `[${output.join(",")}]`;
}

export interface Chunk {
  content: string;
  embedding: string;
}

/** Chunk an item's current text and embed every chunk. */
export async function chunkAndEmbed(item: ItemText): Promise<Chunk[]> {
  const contents = chunkText(itemText(item));
  if (contents.length > MAX_CHUNKS) {
    throw new Error(
      `This item is too long to index (${contents.length} chunks, limit ${MAX_CHUNKS}). ` +
        "Split it into several items.",
    );
  }
  const chunks: Chunk[] = [];
  for (const [i, content] of contents.entries()) {
    // Later chunks carry the title so each one still says what it belongs to.
    const input = i === 0 ? content : `${item.title}\n\n${content}`;
    chunks.push({ content, embedding: await embed(input) });
  }
  return chunks;
}
