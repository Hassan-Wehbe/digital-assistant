// Turning what the camera, gallery or file picker returns into a checked file ready to
// upload. Pure logic (no phone APIs), so it is unit-tested; deviceFiles.ts feeds it.
import { checkFile, extractVsdxText, TYPES } from './filetypes';
import type { PickedFile } from './upload';

export interface RawPick {
  uri: string;
  /** The name the picker gave, if any (the camera often gives none). */
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

const EXT_FOR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

const pad = (n: number) => String(n).padStart(2, '0');

/** "Photo 2026-09-30 14.05.jpg": a readable name for a picture that came without one. */
export function photoName(mimeType: string | null | undefined, now = new Date()): string {
  const ext = EXT_FOR_MIME[mimeType ?? ''] ?? 'jpg';
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return `Photo ${stamp}.${ext}`;
}

/** The name to use: the picker's, with an extension added from the type if it has none. */
export function fileName(raw: RawPick, now = new Date()): string {
  const name = raw.name?.trim();
  if (!name) return photoName(raw.mimeType, now);
  if (/\.[A-Za-z0-9]+$/.test(name)) return name;
  const ext = EXT_FOR_MIME[raw.mimeType ?? ''];
  return ext ? `${name}.${ext}` : name;
}

export type Prepared = { ok: true; file: PickedFile } | { ok: false; error: string };

/**
 * Check one picked file with the same rules as the upload page and, for a .vsdx, read
 * its diagram text on the phone. `readBytes` is only called for files that pass the
 * size check.
 */
export function preparePicked(raw: RawPick, size: number, readBytes: () => Promise<Uint8Array>, now = new Date()): Promise<Prepared> {
  return (async () => {
    const name = fileName(raw, now);
    if (size > 20 * 1024 * 1024) return { ok: false, error: `${name}: this file is larger than 20 MB.` };
    const bytes = await readBytes();
    const check = checkFile(name, bytes.subarray(0, 16), bytes.length);
    if (!check.ok) {
      const hint = /^image\/(heic|heif|webp|gif)$/.test(raw.mimeType ?? '')
        ? ' This picture is in a format Wilma does not take yet; pick a JPEG or PNG, or take the photo with the camera button.'
        : '';
      return { ok: false, error: `${name}: ${check.error}${hint}` };
    }
    let text: string | null = null;
    if (check.type === 'vsdx') {
      try {
        text = extractVsdxText(bytes) || null;
      } catch (e) {
        return { ok: false, error: `${name}: could not be read as a Visio drawing (${e instanceof Error ? e.message : e}).` };
      }
    }
    return {
      ok: true,
      file: { key: `${raw.uri}#${now.getTime()}`, name, uri: raw.uri, size: bytes.length, type: check.type, mime: TYPES[check.type].mime, text, caption: '' },
    };
  })();
}

/** A line about the file for the list: "JPEG picture, 2.4 MB · 120 words of diagram text". */
export function describePicked(f: PickedFile, sizeText: (n: number) => string): string {
  let about = `${TYPES[f.type].label}, ${sizeText(f.size)}`;
  if (f.type === 'vsdx') {
    const words = f.text ? f.text.split(/\s+/).filter(Boolean).length : 0;
    about += words ? ` · ${words} words of diagram text found` : ' · no text found in the diagram';
  } else if (f.type === 'vsd') {
    about += ' · older Visio format: stored, but only its name and caption are searchable';
  }
  return about;
}
