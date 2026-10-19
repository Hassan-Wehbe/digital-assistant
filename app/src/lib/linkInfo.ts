// Links shared to Wilma (owner, 2026-10-19): which site a link is from (Facebook, YouTube, ...), so
// the note says so and "the YouTube video about bread" finds it, and the page's own title, read on
// the phone only when the user taps "Get title" (never the server, never the AI; nothing is fetched
// otherwise). A YouTube link's title comes from YouTube's public oEmbed address (a small JSON
// answer), any other page's from its og:title or <title>. Pure parsing here; the fetch is passed in.

const SITES: { host: RegExp; name: string }[] = [
  { host: /(^|\.)(youtube\.com|youtu\.be)$/, name: 'YouTube' },
  { host: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, name: 'Facebook' },
  { host: /(^|\.)instagram\.com$/, name: 'Instagram' },
  { host: /(^|\.)tiktok\.com$/, name: 'TikTok' },
  { host: /(^|\.)(x\.com|twitter\.com)$/, name: 'X' },
  { host: /(^|\.)reddit\.com$/, name: 'Reddit' },
  { host: /(^|\.)linkedin\.com$/, name: 'LinkedIn' },
  { host: /(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, name: 'Pinterest' },
];

/** The first web link in shared text, or null. */
export function firstUrl(text: string | null | undefined): string | null {
  return /https?:\/\/[^\s<>"]+/i.exec(text ?? '')?.[0]?.replace(/[).,;!?]+$/, '') ?? null;
}

/** "YouTube", "Facebook", ... for a link from a known site; null otherwise. */
export function linkSource(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
    return SITES.find((s) => s.host.test(host))?.name ?? null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

/** HTML entities in a title ("Tom &amp; Jerry", "&#8211;") turned back into text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Titles that say nothing about the page (a sign-in wall, the site's own name). */
const EMPTY_TITLES = /^(log ?in|sign ?in|facebook|instagram|youtube|tiktok|x|twitter|reddit|linkedin|pinterest|error|not found|page not found)(\s*[|·-].*)?$/i;

/** A page's own title from its HTML: og:title first, then <title>; null when it says nothing. */
export function titleFromHtml(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  const raw = og ?? /<title[^>]*>([^<]{1,500})<\/title>/i.exec(html)?.[1];
  return cleanTitle(raw);
}

/** Tidied (entities, spaces, length); null when empty or meaningless. */
export function cleanTitle(raw: string | null | undefined, max = 200): string | null {
  const t = decodeEntities(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t || EMPTY_TITLES.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Where to ask for a title: YouTube's oEmbed address for a YouTube link, else the page itself. */
export function titleSource(url: string): { url: string; kind: 'oembed' | 'html' } {
  return linkSource(url) === 'YouTube'
    ? { url: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, kind: 'oembed' }
    : { url, kind: 'html' };
}

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

/** At most this much of a page is read for its title. */
export const MAX_PAGE_CHARS = 300_000;

/**
 * The page's title, or null when it cannot be read in `timeoutMs` (no network, a sign-in wall, a
 * page without one). Only `url` is asked for, with no cookies or sign-in of the user's.
 */
export async function fetchLinkTitle(url: string, fetchImpl: Fetch, timeoutMs = 8000): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const src = titleSource(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(src.url, { signal: ctrl.signal, headers: { accept: src.kind === 'oembed' ? 'application/json' : 'text/html' } });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, MAX_PAGE_CHARS);
    if (src.kind === 'oembed') {
      try {
        return cleanTitle((JSON.parse(text) as { title?: unknown }).title as string | undefined);
      } catch {
        return null;
      }
    }
    return titleFromHtml(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
