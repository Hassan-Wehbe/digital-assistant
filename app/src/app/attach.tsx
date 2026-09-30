// Add pictures or Visio files to an existing item.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { Button, Card, Muted, styles, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { deviceUploadDeps } from '@/lib/deviceFiles';
import { uploadToLink, type PickedFile } from '@/lib/upload';

export default function Attach() {
  const c = useColors();
  const { wilma } = useAuth();
  const { itemId, title } = useLocalSearchParams<{ itemId: string; title?: string }>();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus('Getting an upload link…');
      const link = await wilma.uploadLink({ item_id: itemId });
      const result = await uploadToLink(link.upload_link, files, deviceUploadDeps, setStatus);
      if (result.failed.length) {
        // Keep only the files that did not make it, to try again.
        setFiles(files.filter((f) => !result.attached.includes(f.name)));
        setFailed(result.failed);
      } else {
        router.back();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: title ? `Add to ${title}` : 'Add photos or files' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <AttachmentPicker files={files} onChange={setFiles} disabled={busy} />
        {failed.length ? (
          <Card>
            <Text style={{ color: c.danger, fontSize: 15 }}>Not uploaded: {failed.join('; ')}</Text>
            <Muted>The others were attached. Try the remaining files again.</Muted>
          </Card>
        ) : null}
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        {status ? <Muted>{status}</Muted> : null}
        <Button
          title={busy ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
          onPress={upload}
          disabled={busy || !files.length}
        />
      </ScrollView>
    </>
  );
}
