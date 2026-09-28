// File checks and Visio text extraction for the upload page. No DOM and no
// third-party code, so the same module runs in the browser and in the Deno tests.
//
//   checkFile(name, head)   type from the file's first bytes, which must agree with its extension
//   storageName(name)       the file name's safe form, used in the Storage path
//   extractVsdxText(bytes)  shape, connector and page-name text of a .vsdx (Visio 2013+)
//
// A .vsdx is a zip of XML parts. The zip is read here (central directory, then
// each wanted entry) and inflated with the browser's DecompressionStream.

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40000;

export const TYPES = {
  png:  { mime: "image/png", label: "PNG picture", picture: true },
  jpeg: { mime: "image/jpeg", label: "JPEG picture", picture: true },
  vsdx: { mime: "application/vnd.ms-visio.drawing", label: "Visio drawing", picture: false },
  vsd:  { mime: "application/vnd.visio", label: "Visio drawing (older format)", picture: false },
};

const EXTENSIONS = { png: "png", jpg: "jpeg", jpeg: "jpeg", vsdx: "vsdx", vsd: "vsd" };
export const ACCEPT = ".png,.jpg,.jpeg,.vsdx,.vsd,image/png,image/jpeg";

/** Type key from the file name's extension, or null. */
export function typeFromName(name) {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase();
  return EXTENSIONS[ext] ?? null;
}

const startsWith = (b, sig) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** What the first bytes say: "png", "jpeg", "zip" (a .vsdx), "ole" (a .vsd) or null. */
export function sniff(head) {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  return null;
}

const CONTAINER = { png: "png", jpeg: "jpeg", vsdx: "zip", vsd: "ole" };

/**
 * Check a file by name and first bytes (at least 8). Returns
 * { ok: true, type, mime, label } or { ok: false, error }.
 */
export function checkFile(name, head, size = 0) {
  const type = typeFromName(name);
  if (!type) return { ok: false, error: "Only pictures (.jpg, .jpeg, .png) and Visio files (.vsdx, .vsd) can be attached." };
  if (name.length > 200) return { ok: false, error: "The file name is too long (over 200 characters); rename it first." };
  if (size > MAX_BYTES) return { ok: false, error: "This file is larger than 20 MB." };
  if (size === 0 && head.length === 0) return { ok: false, error: "This file is empty." };
  if (sniff(head) !== CONTAINER[type]) {
    return { ok: false, error: `The file's contents are not a ${TYPES[type].label}, although its name says so.` };
  }
  return { ok: true, type, mime: TYPES[type].mime, label: TYPES[type].label };
}

/** The file name's safe form for the Storage path: letters, digits, . _ - only; same extension. */
export function storageName(name) {
  const type = typeFromName(name);
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  let base = name.slice(0, name.length - ext.length - 1)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  if (!base) base = "file";
  base = base.slice(0, 120 - ext.length - 1);
  return type ? `${base}.${ext}` : base;
}

// ---------- zip ----------

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The zip's entries: [{ name, method, compressedSize, size, offset }]. */
export function zipEntries(bytes) {
  const min = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const names = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error("damaged zip directory");
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    out.push({
      name: names.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
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
export async function zipRead(bytes, entry, limit = MAX_BYTES) {
  const o = entry.offset;
  if (u32(bytes, o) !== 0x04034b50) throw new Error("damaged zip entry");
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice(0, limit);
  if (entry.method !== 8) throw new Error("unsupported zip compression");
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("a part of this file is too large to read");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ---------- Visio text ----------

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXmlText(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

const attr = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)?.slice(1).find((v) => v !== undefined);

/** The text of every shape and connector on one page's XML, in document order. */
export function pageText(xml) {
  const lines = [];
  for (const m of xml.matchAll(/<Text(?:\s[^>]*[^/>])?>([\s\S]*?)<\/Text>/g)) {
    const text = decodeXmlText(m[1].replace(/<[^>]*>/g, ""));
    for (const line of text.split(/[\r\n\u2028\u2029]+/)) {
      const t = line.replace(/[\s\u00a0]+/g, " ").trim();
      if (t && !lines.includes(t)) lines.push(t);
    }
  }
  return lines;
}

/**
 * Text of a .vsdx: "Page: <name>" then the page's shape and connector text, per page.
 * Throws if the zip is not a Visio drawing.
 */
export async function extractVsdxText(bytes) {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  if (!byName.has("visio/document.xml")) throw new Error("this .vsdx is not a Visio drawing");
  const read = async (name) => {
    const e = byName.get(name);
    return e ? new TextDecoder().decode(await zipRead(bytes, e)) : "";
  };

  // Page order and names from pages.xml; page files from its relationships.
  const rels = new Map();
  for (const m of (await read("visio/pages/_rels/pages.xml.rels")).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id"), target = attr(m[1], "Target");
    if (id && target) rels.set(id, "visio/pages/" + target.replace(/^\.?\//, "").replace(/^\/?visio\/pages\//, ""));
  }
  const pages = [];
  for (const m of (await read("visio/pages/pages.xml")).matchAll(/<Page\b([^>]*)>([\s\S]*?)<\/Page>/g)) {
    const rid = /<Rel\b[^>]*\br:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[2]);
    pages.push({ name: decodeXmlText(attr(m[1], "Name") ?? attr(m[1], "NameU") ?? ""), file: rels.get(rid?.[1] ?? rid?.[2]) });
  }
  // Page files not listed (or no pages.xml): in file-number order.
  const listed = new Set(pages.map((p) => p.file));
  const pageNo = (n) => Number(/page(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  for (const e of entries.filter((e) => /^visio\/pages\/page\d+\.xml$/.test(e.name)).sort((a, b) => pageNo(a.name) - pageNo(b.name))) {
    if (!listed.has(e.name)) pages.push({ name: "", file: e.name });
  }

  const out = [];
  for (const [i, p] of pages.entries()) {
    const lines = p.file ? pageText(await read(p.file)) : [];
    if (!lines.length && !p.name) continue;
    out.push(`Page: ${p.name || `Page ${i + 1}`}`, ...lines, "");
  }
  const text = out.join("\n").trim();
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}
