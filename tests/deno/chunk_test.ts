// Unit tests for text chunking. Run: deno test tests/deno
import { assert, assertEquals } from "jsr:@std/assert@1";
import { chunkText, itemText, MAX_CHUNK_CHARS } from "../../supabase/functions/mcp/lib/chunk.ts";

Deno.test("short text stays one chunk", () => {
  assertEquals(chunkText("Layer pasta, ragu and bechamel."), ["Layer pasta, ragu and bechamel."]);
});

Deno.test("item text joins title, summary and body, skipping empty parts", () => {
  assertEquals(itemText({ title: "Lasagna", summary: null, body: "Bake 45 min." }), "Lasagna\n\nBake 45 min.");
});

Deno.test("long text is split into chunks no longer than the limit", () => {
  const para = "The routing timeout happens when the Teams queue is full. ".repeat(12);
  const text = Array.from({ length: 8 }, () => para.trim()).join("\n\n");
  const chunks = chunkText(text);
  assert(chunks.length > 1);
  for (const c of chunks) assert(c.length <= MAX_CHUNK_CHARS, `chunk of ${c.length} chars`);
});

Deno.test("a single huge word-free blob is still cut to size", () => {
  const chunks = chunkText("x".repeat(2500));
  assertEquals(chunks.map((c) => c.length), [1000, 1000, 500]);
});

Deno.test("consecutive chunks overlap so boundary sentences stay findable", () => {
  const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`);
  const chunks = chunkText(sentences.join("\n\n"));
  assert(chunks.length > 1);
  const lastOfFirst = chunks[0].split("\n\n").at(-1)!;
  assert(chunks[1].includes(lastOfFirst), "second chunk should repeat the end of the first");
});

Deno.test("no text is lost", () => {
  const words = Array.from({ length: 900 }, (_, i) => `w${i}`);
  const joined = chunkText(words.join(" ")).join(" ");
  for (const w of words) assert(joined.includes(w), `missing ${w}`);
});
