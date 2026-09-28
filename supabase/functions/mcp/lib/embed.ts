// Embeddings with Supabase's built-in gte-small model (384 dimensions).
// Runs inside the Edge Function: no external AI service, no API key.
//
// The free plan gives each request ~2 s of CPU, and one chunk costs ~0.1-0.2 s
// to embed. So a request embeds at most a few chunks itself; longer items are
// stored with the rest of their chunks pending (embedding = null), and
// follow-up requests to /embed-pending embed them a batch at a time.
/// <reference path="./supabase-ai.d.ts" />
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkText, itemText, type ItemText, MAX_CHUNKS } from "./chunk.ts";
import { supabaseUrl } from "./db.ts";

export const EMBEDDING_DIMENSIONS = 384;
/** Chunks embedded inside a save/update request (the rest go to the background). */
export const INLINE_CHUNKS = 4;
/** Chunks embedded per background request. */
export const BATCH_CHUNKS = 5;

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

/** What gets embedded for a chunk: later chunks carry the title so each one says what it belongs to. */
function embeddingInput(title: string, content: string, index: number): string {
  return index === 0 ? content : `${title}\n\n${content}`;
}

export interface Chunk {
  content: string;
  embedding: string | null; // null = pending, embedded by /embed-pending
}

/** Chunk an item's current text; embed the first few now, leave the rest pending. */
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
    const embedding = i < INLINE_CHUNKS ? await embed(embeddingInput(item.title, content, i)) : null;
    chunks.push({ content, embedding });
  }
  return chunks;
}

export const hasPending = (chunks: Chunk[] | null) => !!chunks?.some((c) => c.embedding === null);

/** Embed up to BATCH_CHUNKS of the user's pending chunks. Returns how many remain. */
export async function embedPending(db: SupabaseClient): Promise<{ embedded: number; remaining: number }> {
  const { data, error } = await db
    .from("item_chunk")
    .select("id, chunk_index, content, item:item_id (title)")
    .is("embedding", null)
    .order("item_id")
    .order("chunk_index")
    .limit(BATCH_CHUNKS + 1);
  if (error) throw new Error(`could not load pending chunks: ${error.message}`);
  const batch = data.slice(0, BATCH_CHUNKS);
  for (const c of batch) {
    const title = (c.item as unknown as { title: string } | null)?.title ?? "";
    const embedding = await embed(embeddingInput(title, c.content, c.chunk_index));
    // If the item was edited meanwhile this chunk no longer exists: a harmless no-op.
    const { error: upErr } = await db.from("item_chunk").update({ embedding }).eq("id", c.id);
    if (upErr) throw new Error(`could not store embedding: ${upErr.message}`);
  }
  return { embedded: batch.length, remaining: data.length - batch.length };
}

/** After the response is sent, ask this function (as the same user) to embed pending chunks. */
export function scheduleEmbedPending(accessToken: string): void {
  const kick = fetch(`${supabaseUrl()}/functions/v1/mcp/embed-pending`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  })
    .then((r) => r.body?.cancel())
    .catch((err) => console.error("embed-pending kick failed:", err?.message ?? err));
  EdgeRuntime.waitUntil(kick);
}
