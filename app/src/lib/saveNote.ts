// Saving a note with optional files, or adding files to an existing note: one flow for
// "New note" and "Share to Wilma".
// Without files: save_item. With files: attach_file creates the note (or targets the
// existing one) and gives an upload link in one step, then the files go up (upload.ts).
// A place (places.ts) is always created with save_item, which checks its fields; its files then
// go onto it like onto an existing note.
import type { PlaceMetadata } from './places';
import { uploadToLink, type PickedFile, type UploadDeps } from './upload';
import type { WilmaClient } from './wilma';

export type SaveTarget =
  /** An existing note (or one created by an earlier try that failed during the upload). */
  | { itemId: string }
  | { space: string; title: string; body: string; place?: PlaceMetadata };

export interface SaveOutcome {
  itemId: string;
  /** Files that did not make it ("name: reason"); the others are attached. */
  failed: string[];
}

export async function saveNote(
  wilma: Pick<WilmaClient, 'saveItem' | 'uploadLink'>,
  target: SaveTarget,
  files: PickedFile[],
  deps: UploadDeps,
  hooks: { onCreated?: (itemId: string) => void; onStatus?: (message: string) => void } = {},
): Promise<SaveOutcome> {
  if ('space' in target && (target.place || !files.length)) {
    const { space, title, body, place } = target;
    const { id } = await wilma.saveItem(place ? { space, title, body, item_type: 'place', metadata: place } : { space, title, body });
    hooks.onCreated?.(id);
    if (!files.length) return { itemId: id, failed: [] };
    target = { itemId: id };
  }
  if (!files.length && 'itemId' in target) return { itemId: target.itemId, failed: [] };
  hooks.onStatus?.('Getting an upload link…');
  const link = await wilma.uploadLink(
    'itemId' in target ? { item_id: target.itemId } : { space: target.space, title: target.title, note: target.body },
  );
  hooks.onCreated?.(link.item.id);
  const result = await uploadToLink(link.upload_link, files, deps, hooks.onStatus);
  return { itemId: link.item.id, failed: result.failed };
}
