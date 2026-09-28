// Split an item's text into overlapping chunks for embedding.
// gte-small reads at most 512 tokens; ~1000 characters of English stays well
// under that, and the overlap keeps sentences that straddle a boundary findable.

export const MAX_CHUNK_CHARS = 1000;
export const OVERLAP_CHARS = 150;
export const MAX_CHUNKS = 40; // ~40,000 characters per item in milestone 1

export interface ItemText {
  title: string;
  summary?: string | null;
  body: string;
}

/** The full searchable text of an item: title, summary, body. */
export function itemText({ title, summary, body }: ItemText): string {
  return [title, summary, body]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** Break text into pieces no longer than `max`, preferring paragraph, then sentence, then word boundaries. */
function pieces(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= max) {
      out.push(p);
      continue;
    }
    for (const sentence of p.split(/(?<=[.!?])\s+/)) {
      if (sentence.length <= max) {
        out.push(sentence);
        continue;
      }
      let rest = sentence;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < max / 2) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
    }
  }
  return out;
}

/** The last ~`n` characters of `text`, starting at a word boundary. */
function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  const start = text.indexOf(" ", text.length - n);
  return start === -1 ? "" : text.slice(start + 1);
}

export function chunkText(
  text: string,
  max = MAX_CHUNK_CHARS,
  overlap = OVERLAP_CHARS,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces(text, max)) {
    const joined = current ? `${current}\n\n${piece}` : piece;
    if (joined.length <= max) {
      current = joined;
      continue;
    }
    if (current) chunks.push(current);
    const carry = current ? tail(current, overlap) : "";
    current = carry && carry.length + 2 + piece.length <= max ? `${carry}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}
