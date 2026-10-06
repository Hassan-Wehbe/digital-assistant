// What another app shared with Wilma (Share -> Wilma), turned into the same file list
// the camera and file picker give (picked.ts), plus a suggested title and note for
// shared text or links. Pure logic (no phone APIs), so it is unit-tested;
// shareIntake.tsx feeds it the share module's raw answer.
//
// Android hands each file over as a content:// link plus, usually, a copy the share
// module made in the app's cache. The module's own parser keeps only one of the two,
// and for a file from the phone's storage the "copy" is a storage path Wilma may not
// read (no storage permission), so this keeps both and the app decides (sourceFor).
import type { RawPick } from './picked';
import { isMapsLink, MAX_ADDRESS } from './places';

export interface SharedFile extends RawPick {
  /** A copy the share module already made (file://), if any. */
  copy: string | null;
}

export interface Shared {
  files: SharedFile[];
  /** Shared text or link (Chrome shares a page as its address). */
  text: string | null;
  /** A title the sending app gave, if any. */
  title: string | null;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const asFileUri = (path: string | null) => (!path ? null : /^[a-z]+:\/\//i.test(path) ? path : `file://${path}`);

function parseJson(value: string): Raw | null {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? (v as Raw) : null;
  } catch {
    return null;
  }
}

/** The share module's raw answer (an object on Android, a JSON string on iOS). */
export function parseShared(value: unknown): Shared {
  const raw = typeof value === 'string' ? parseJson(value) : value && typeof value === 'object' ? (value as Raw) : null;
  if (!raw) return { files: [], text: null, title: null };

  const files: SharedFile[] = [];
  // Android's single-file answer also carries a stray non-file entry; skip anything
  // that is not a file with a link or a path.
  for (const f of Array.isArray(raw.files) ? (raw.files as unknown[]) : []) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Raw;
    const contentUri = str(o.contentUri); // Android
    const copy = asFileUri(str(o.filePath)); // Android
    const uri = contentUri ?? copy ?? asFileUri(str(o.path)); // iOS: path
    if (!uri) continue;
    files.push({ uri, copy, name: str(o.fileName), mimeType: str(o.mimeType), size: num(o.fileSize) });
  }

  const weburl = Array.isArray(raw.weburls) ? (raw.weburls[0] as Raw | undefined) : undefined;
  const text = str(raw.text) ?? str(weburl?.url);
  const meta = (raw.meta && typeof raw.meta === 'object' ? raw.meta : typeof weburl?.meta === 'string' ? parseJson(weburl.meta) : null) as Raw | null;
  return { files, text, title: str(meta?.title)?.trim() ?? null };
}

export const TITLE_MAX = 300;

/** A title and note to start from: shared text becomes the note; files start with no title. */
export function draftFromShared(shared: Shared): { title: string; body: string } {
  const body = shared.text?.trim() ?? '';
  if (shared.title) return { title: shared.title.slice(0, TITLE_MAX), body };
  if (!body || shared.files.length) return { title: '', body };
  const url = /https?:\/\/[^\s]+/i.exec(body)?.[0];
  const rest = (url ? body.replace(url, '') : body).trim();
  if (rest) {
    const line = rest.split('\n')[0].trim();
    return { title: line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line, body };
  }
  try {
    return { title: `Link from ${new URL(url!).hostname.replace(/^www\./, '')}`, body };
  } catch {
    return { title: '', body };
  }
}

/** A place shared from Google Maps: what the place form starts from. */
export interface SharedPlace {
  name: string;
  mapsUrl: string;
  address: string;
}

/**
 * A Google Maps share (Share in Google Maps -> Wilma), or null for anything else. On the
 * owner's phone Maps sends the short link as the text and the place's name as the title;
 * other versions send "Name\nAddress\nlink". The link is kept as it is: Wilma never follows
 * it to Google (docs/places-plan.md, Q3). Shares with files are never places.
 */
export function placeFromShared(shared: Shared): SharedPlace | null {
  if (shared.files.length || !shared.text) return null;
  const words = shared.text.split(/\s+/).map((w) => w.replace(/[).,;!]+$/, ''));
  const mapsUrl = words.find((w) => isMapsLink(w));
  if (!mapsUrl) return null;
  const lines = shared.text
    .split('\n')
    .map((l) => l.replace(mapsUrl, '').trim())
    .filter(Boolean);
  // The first line is the name, unless the sending app gave a different title.
  const title = shared.title?.trim() ?? '';
  const [first = '', ...others] = lines;
  const name = title || first;
  const address = title && first !== title ? lines : others;
  return { name: name.slice(0, TITLE_MAX), mapsUrl, address: address.join(', ').slice(0, MAX_ADDRESS) };
}

/**
 * Where to read a shared file from:
 * - `use`: a copy already in the app's cache (deleted after saving);
 * - `copy`: a content:// link to copy into the cache first (the app's only way to read
 *   it later, and what the upload needs);
 * - `read`: anything else, read in place and left alone.
 */
export function sourceFor(file: SharedFile, cacheUri: string): { how: 'use' | 'copy' | 'read'; uri: string } {
  const cache = cacheUri.endsWith('/') ? cacheUri : `${cacheUri}/`;
  if (file.copy?.startsWith(cache) && !file.copy.slice(cache.length).split('/').includes('..')) return { how: 'use', uri: file.copy };
  if (file.uri.startsWith('content://')) return { how: 'copy', uri: file.uri };
  return { how: 'read', uri: file.uri };
}

/** True when nothing Wilma can save came in (no file, no text). */
export function nothingUsable(shared: Shared): boolean {
  return !shared.files.length && !shared.text;
}
