// Sending picked files to an item, the same way the upload page does
// (docs/files/upload.js), with the app doing every step itself:
//   1. attach_file (Wilma's tool) gives a one-time upload link; its token is in "#t=...".
//   2. get_attachment_upload_request: what the link is for, and the attachment ids it reserved.
//   3. Each file goes straight to the private Storage bucket at <user>/<reserved id>/<safe name>.
//   4. complete_attachment_upload records them (and uses up the link); then /embed-pending
//      indexes their text for meaning search.
// The database functions accept only a signed-in app or browser session, never the
// Claude connector's token; the app's session is such a sign-in.
import { storageName, type FileType } from './filetypes';

export const BUCKET = 'attachments';

export interface PickedFile {
  key: string;
  name: string;
  uri: string;
  size: number;
  type: FileType;
  mime: string;
  /** Visio text read on the phone (.vsdx only). */
  text: string | null;
  caption: string;
}

export interface DbError {
  message: string;
  code?: string;
}

export interface UploadDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: DbError | null }>;
  /** Send one file to Storage at `path`; throws with a readable message on failure. */
  put(path: string, file: PickedFile): Promise<void>;
  remove(paths: string[]): Promise<void>;
  /** Ask the server to index the new text (fire and forget). */
  embedPending(): void;
}

export interface UploadResult {
  itemId: string;
  itemTitle: string;
  attached: string[];
  failed: string[];
}

/** The token from an upload link ("...#t=<token>"), or null. */
export function linkToken(link: string): string | null {
  const t = /#(?:.*&)?t=([^&]*)/.exec(link)?.[1];
  return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

export async function uploadToLink(
  link: string,
  files: PickedFile[],
  deps: UploadDeps,
  onStatus: (message: string) => void = () => {},
): Promise<UploadResult> {
  const token = linkToken(link);
  if (!token) throw new Error('Wilma sent an upload link the app could not read.');
  if (!files.length) throw new Error('Pick at least one file.');

  const req = await deps.rpc('get_attachment_upload_request', { p_token: token });
  if (req.error) throw new Error(req.error.message);
  const request = req.data as { user_id: string; upload_ids: string[]; max_files?: number };
  const max = request.max_files ?? 10;
  if (files.length > max) throw new Error(`At most ${max} files at a time.`);
  const freeIds = [...(request.upload_ids ?? [])];

  const done: { file: PickedFile; id: string; path: string }[] = [];
  const failed: string[] = [];
  for (const [i, file] of files.entries()) {
    onStatus(`Uploading ${i + 1} of ${files.length}: ${file.name}…`);
    const id = freeIds.shift();
    if (!id) {
      failed.push(`${file.name}: too many files for one link`);
      continue;
    }
    const path = `${request.user_id}/${id}/${storageName(file.name)}`;
    try {
      await deps.put(path, file);
      done.push({ file, id, path });
    } catch (e) {
      failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!done.length) throw new Error(`Nothing was uploaded. ${failed.join('; ')}`);

  onStatus('Saving…');
  const { data, error } = await deps.rpc('complete_attachment_upload', {
    p_token: token,
    p_files: done.map(({ file, id }) => ({
      attachment_id: id,
      filename: file.name,
      storage_name: storageName(file.name),
      caption: file.caption.trim() || null,
      extracted_text: file.text || null,
    })),
    p_description_for: null,
  });
  if (error) {
    if (!error.code) {
      // No answer (network): the files may have been recorded. Keep them.
      throw new Error(
        'Could not confirm the upload (connection problem). Open the item before trying again: ' +
          'the files may already be attached.',
      );
    }
    // The database refused: take the uploaded files back out of Storage.
    await deps.remove(done.map((d) => d.path)).catch(() => {});
    throw new Error(error.message);
  }
  deps.embedPending();
  return {
    itemId: data.item_id,
    itemTitle: data.item_title,
    attached: (data.attachments as { filename: string }[]).map((a) => a.filename),
    failed,
  };
}
