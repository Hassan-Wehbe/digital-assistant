// Saving a note with optional files, or adding files to an existing note: one flow for
// "New note" and "Share to Wilma".
// Without files: save_item. With files: attach_file creates the note (or targets the
// existing one) and gives an upload link in one step, then the files go up (upload.ts).
import { uploadToLink, type PickedFile, type UploadDeps } from './upload';
import type { WilmaClient } from './wilma';

export type SaveTarget =
  /** An existing note (or one created by an earlier try that failed during the upload). */
  | { itemId: string }
  | { space: string; title: string; body: string };

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
  if (!files.length) {
    if ('itemId' in target) return { itemId: target.itemId, failed: [] };
    const { id } = await wilma.saveItem({ space: target.space, title: target.title, body: target.body });
    hooks.onCreated?.(id);
    return { itemId: id, failed: [] };
  }
  hooks.onStatus?.('Getting an upload link…');
  const link = await wilma.uploadLink(
    'itemId' in target ? { item_id: target.itemId } : { space: target.space, title: target.title, note: target.body },
  );
  hooks.onCreated?.(link.item.id);
  const result = await uploadToLink(link.upload_link, files, deps, hooks.onStatus);
  return { itemId: link.item.id, failed: result.failed };
}
