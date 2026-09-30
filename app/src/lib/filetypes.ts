// File checks and Visio text extraction for the app: the same rules as the upload
// page (docs/files/filetypes.js), so a file the page accepts the app accepts, and
// the other way round. filetypes.test.ts runs both on the same files.
//
// The page inflates zip parts with the browser's DecompressionStream, which phones
// do not have; here fflate (pure JavaScript) does it.
import { inflateSync } from 'fflate';

import { utf8Text } from './sessionStorage';

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40000;
export const MAX_FILES = 10;

export type FileType = 'png' | 'jpeg' | 'vsdx' | 'vsd';

export const TYPES: Record<FileType, { mime: string; label: string; picture: boolean }> = {
  png: { mime: 'image/png', label: 'PNG picture', picture: true },
  jpeg: { mime: 'image/jpeg', label: 'JPEG picture', picture: true },
  vsdx: { mime: 'application/vnd.ms-visio.drawing', label: 'Visio drawing', picture: false },
  vsd: { mime: 'application/vnd.visio', label: 'Visio drawing (older format)', picture: false },
};

const EXTENSIONS: Record<string, FileType> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', vsdx: 'vsdx', vsd: 'vsd' };

/**
 * For the system file picker: every file. Phones report Visio files under varying types
 * (or none), so filtering by type could hide them; checkFile decides instead.
 */
export const PICKER_TYPES = ['*/*'];

export function typeFromName(name: string | null | undefined): FileType | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name ?? '')?.[1]?.toLowerCase();
  return (ext && EXTENSIONS[ext]) || null;
}

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** What the first bytes say: "png", "jpeg", "zip" (a .vsdx), "ole" (a .vsd) or null. */
export function sniff(head: Uint8Array): 'png' | 'jpeg' | 'zip' | 'ole' | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  return null;
}

const CONTAINER: Record<FileType, string> = { png: 'png', jpeg: 'jpeg', vsdx: 'zip', vsd: 'ole' };

export type FileCheck = { ok: true; type: FileType; mime: string; label: string } | { ok: false; error: string };

/** Check a file by name, first bytes (at least 8) and size. */
export function checkFile(name: string, head: Uint8Array, size = 0): FileCheck {
  const type = typeFromName(name);
  if (!type) return { ok: false, error: 'Only pictures (.jpg, .jpeg, .png) and Visio files (.vsdx, .vsd) can be attached.' };
  if (name.length > 200) return { ok: false, error: 'The file name is too long (over 200 characters); rename it first.' };
  if (size > MAX_BYTES) return { ok: false, error: 'This file is larger than 20 MB.' };
  if (size === 0 && head.length === 0) return { ok: false, error: 'This file is empty.' };
  if (sniff(head) !== CONTAINER[type]) {
    return { ok: false, error: `The file's contents are not a ${TYPES[type].label}, although its name says so.` };
  }
  return { ok: true, type, mime: TYPES[type].mime, label: TYPES[type].label };
}

/** The file name's safe form for the Storage path: letters, digits, . _ - only; same extension. */
export function storageName(name: string): string {
  const type = typeFromName(name);
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  let base = name
    .slice(0, name.length - ext.length - 1)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  if (!base) base = 'file';
  base = base.slice(0, 120 - ext.length - 1);
  return type ? `${base}.${ext}` : base;
}

// ---------- zip ----------

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const min = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error('damaged zip directory');
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    out.push({
      name: utf8Text(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16(bytes, p + 10),
      compressedSize: u32(bytes, p + 20),
      size: u32(bytes, p + 24),
      offset: u32(bytes, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's bytes, inflated; refuses to produce more than `limit` bytes. */
export function zipRead(bytes: Uint8Array, entry: ZipEntry, limit = MAX_BYTES): Uint8Array {
  const o = entry.offset;
  if (u32(bytes, o) !== 0x04034b50) throw new Error('damaged zip entry');
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice(0, limit);
  if (entry.method !== 8) throw new Error('unsupported zip compression');
  // The directory states the inflated size; refuse before inflating anything larger.
  if (entry.size > limit) throw new Error('a part of this file is too large to read');
  const out = inflateSync(raw, { out: new Uint8Array(entry.size) });
  if (out.length > limit) throw new Error('a part of this file is too large to read');
  return out;
}

// ---------- Visio text ----------

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e] ?? m;
  });
}

const attr = (attrs: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)?.slice(1).find((v) => v !== undefined);

/** The text of every shape and connector on one page's XML, in document order. */
export function pageText(xml: string): string[] {
  const lines: string[] = [];
  for (const m of xml.matchAll(/<Text(?:\s[^>]*[^/>])?>([\s\S]*?)<\/Text>/g)) {
    const text = decodeXmlText(m[1].replace(/<[^>]*>/g, ''));
    for (const line of text.split(/[\r\n\u2028\u2029]+/)) {
      const t = line.replace(/[\s\u00a0]+/g, ' ').trim();
      if (t && !lines.includes(t)) lines.push(t);
    }
  }
  return lines;
}

/** Text of a .vsdx: "Page: <name>" then the page's shape and connector text, per page. */
export function extractVsdxText(bytes: Uint8Array): string {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  if (!byName.has('visio/document.xml')) throw new Error('this .vsdx is not a Visio drawing');
  const read = (name: string) => {
    const e = byName.get(name);
    return e ? utf8Text(zipRead(bytes, e)) : '';
  };

  const rels = new Map<string, string>();
  for (const m of read('visio/pages/_rels/pages.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) rels.set(id, 'visio/pages/' + target.replace(/^\.?\//, '').replace(/^\/?visio\/pages\//, ''));
  }
  const pages: { name: string; file: string | undefined }[] = [];
  for (const m of read('visio/pages/pages.xml').matchAll(/<Page\b([^>]*)>([\s\S]*?)<\/Page>/g)) {
    const rid = /<Rel\b[^>]*\br:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[2]);
    pages.push({
      name: decodeXmlText(attr(m[1], 'Name') ?? attr(m[1], 'NameU') ?? ''),
      file: rels.get((rid?.[1] ?? rid?.[2]) as string),
    });
  }
  const listed = new Set(pages.map((p) => p.file));
  const pageNo = (n: string) => Number(/page(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  for (const e of entries
    .filter((e) => /^visio\/pages\/page\d+\.xml$/.test(e.name))
    .sort((a, b) => pageNo(a.name) - pageNo(b.name))) {
    if (!listed.has(e.name)) pages.push({ name: '', file: e.name });
  }

  const out: string[] = [];
  for (const [i, p] of pages.entries()) {
    const lines = p.file ? pageText(read(p.file)) : [];
    if (!lines.length && !p.name) continue;
    out.push(`Page: ${p.name || `Page ${i + 1}`}`, ...lines, '');
  }
  const text = out.join('\n').trim();
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}
