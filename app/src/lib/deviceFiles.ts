// The phone's camera, gallery and file picker, and sending files to Storage.
// Checks live in picked.ts / filetypes.ts; the upload steps in upload.ts.
import * as DocumentPicker from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { MCP_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { MAX_FILES, PICKER_TYPES } from './filetypes';
import { preparePicked, type RawPick } from './picked';
import { supabase } from './supabase';
import { BUCKET, type PickedFile, type UploadDeps } from './upload';

export interface PickOutcome {
  files: PickedFile[];
  errors: string[];
}

async function prepareAll(raws: RawPick[]): Promise<PickOutcome> {
  const out: PickOutcome = { files: [], errors: [] };
  for (const raw of raws) {
    try {
      const file = new File(raw.uri);
      const r = await preparePicked(raw, raw.size ?? file.size, () => file.bytes());
      if (r.ok) out.files.push(r.file);
      else out.errors.push(r.error);
    } catch (e) {
      out.errors.push(`${raw.name ?? 'A file'}: could not be read (${e instanceof Error ? e.message : e}).`);
    }
  }
  return out;
}

/** Take one photo with the camera. Asks for camera access the first time. */
export async function takePhoto(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { files: [], errors: ['Wilma may not use the camera. Allow it in the phone settings (Apps → Wilma → Permissions).'] };
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, exif: false });
  if (result.canceled) return { files: [], errors: [] };
  return prepareAll(result.assets.map((a) => ({ uri: a.uri, name: null, mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize })));
}

/** Pick pictures from the gallery (Android's photo picker: no storage permission needed). */
export async function pickPictures(room: number): Promise<PickOutcome> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, Math.min(room, MAX_FILES)),
    quality: 1,
    exif: false,
    // iPhone: hand over JPEG instead of HEIC where the photo is stored as HEIC.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return { files: [], errors: [] };
  return prepareAll(result.assets.map((a) => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, size: a.fileSize })));
}

/** Pick pictures or Visio files from the phone's files (Downloads, Drive, ...). */
export async function pickFiles(): Promise<PickOutcome> {
  const result = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return { files: [], errors: [] };
  return prepareAll(result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })));
}

async function accessToken(): Promise<string> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('You were signed out; sign in again.');
  return token;
}

/** Storage and database steps for uploadToLink, as the signed-in user. */
export const deviceUploadDeps: UploadDeps = {
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    return { data, error: error ? { message: error.message, code: error.code || undefined } : null };
  },
  // Streams the file from the phone's storage (not through JavaScript memory).
  put: async (path, file) => {
    const res = await new File(file.uri).upload(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: file.mime,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': file.mime,
        'x-upsert': 'false',
      },
    });
    if (res.status < 200 || res.status >= 300) {
      let message = `upload failed (${res.status})`;
      try {
        message = JSON.parse(res.body).message ?? message;
      } catch {
        // keep the status text
      }
      throw new Error(message);
    }
  },
  remove: async (paths) => {
    await supabase.storage.from(BUCKET).remove(paths);
  },
  embedPending: () => {
    accessToken()
      .then((token) => fetch(`${MCP_URL}/embed-pending`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))
      .catch(() => {});
  },
};
