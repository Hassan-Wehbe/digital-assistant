// Tappable links in a note's text (owner, 2026-10-29: "the links ideally should be clickable"). Only
// web links (https and http) become links, and only ones the app can open safely (recipes.ts
// isWebLink: no user name or password in them); anything else stays plain text. The text itself is
// shown exactly as saved.
import { isWebLink } from './recipes';

export type TextPart = { text: string } | { text: string; url: string };

// A link runs to the next space or bracket; a full stop, comma, quote or closing bracket at its end
// belongs to the sentence ("see https://x.com/a." → "https://x.com/a").
const LINK = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?'")\]}>]+$/;

/** The text cut into plain parts and links, in order; joined back it is the same text. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    let url = m[0];
    const tail = TRAILING.exec(url);
    if (tail) url = url.slice(0, url.length - tail[0].length);
    if (!isWebLink(url)) continue;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: url, url });
    at = start + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
