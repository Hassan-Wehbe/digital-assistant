// Pick pictures or Visio files (camera, gallery, files), with a caption per file.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { pickFiles, pickPictures, takePhoto, type PickOutcome } from '@/lib/deviceFiles';
import { MAX_FILES } from '@/lib/filetypes';
import { describePicked } from '@/lib/picked';
import type { PickedFile } from '@/lib/upload';
import { fileSize } from '@/lib/wilma';

import { Button, Card, Muted, styles, useColors } from './ui';

export function AttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const room = MAX_FILES - files.length;

  const add = async (pick: () => Promise<PickOutcome>) => {
    setBusy(true);
    setErrors([]);
    try {
      const { files: picked, errors: problems } = await pick();
      const taken = picked.slice(0, Math.max(0, room));
      if (picked.length > taken.length) problems.push(`At most ${MAX_FILES} files at a time; the rest were left out.`);
      onChange([...files, ...taken]);
      setErrors(problems);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy || room <= 0;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <SmallButton title="Take photo" onPress={() => add(takePhoto)} disabled={off} />
        <SmallButton title="Choose pictures" onPress={() => add(() => pickPictures(room))} disabled={off} />
        <SmallButton title="Choose files" onPress={() => add(pickFiles)} disabled={off} />
      </View>
      <Muted>Pictures (.jpg, .png) and Visio files (.vsdx, .vsd), up to 20 MB each, {MAX_FILES} at a time.</Muted>
      {errors.map((e) => (
        <Text key={e} style={{ color: c.danger, fontSize: 15 }}>
          {e}
        </Text>
      ))}
      {files.map((f) => (
        <Card key={f.key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[styles.title, { color: c.text, flex: 1 }]} numberOfLines={2}>
              {f.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => onChange(files.filter((x) => x.key !== f.key))}>
              <Text style={{ color: c.accent, fontSize: 15 }}>Remove</Text>
            </Pressable>
          </View>
          <Muted>{describePicked(f, fileSize)}</Muted>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
            placeholder="Caption (optional): what is it?"
            placeholderTextColor={c.muted}
            maxLength={1000}
            value={f.caption}
            editable={!disabled}
            onChangeText={(caption) => onChange(files.map((x) => (x.key === f.key ? { ...x, caption } : x)))}
          />
        </Card>
      ))}
    </View>
  );
}

function SmallButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <View style={{ flexGrow: 1 }}>
      <Button title={title} kind="plain" onPress={onPress} disabled={disabled} />
    </View>
  );
}
