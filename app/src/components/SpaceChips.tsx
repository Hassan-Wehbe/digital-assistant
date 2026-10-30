// Choose a space (docs/note-kind-mockups.html, layout A; owner 2026-10-30: the space must not look
// like the other choices, "everything is in a pill button format"). One line shows the chosen
// space with "Change ›"; tapping it opens the list of spaces with a search box (restricted ones
// marked with a lock, Wilma's own with their icon), and picking one closes it again.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { spaceTitle } from '@/lib/memory';
import type { Space } from '@/lib/wilma';

import { ErrorBox, GroupList, GroupRow, Loading, Muted, space as gap, styles, useColors } from './ui';

const label = (s: Space) => (s.restricted ? `🔒 ${s.path}` : s.built_in ? spaceTitle(s) : `📁 ${s.path}`);

export function SpaceChips({
  spaces,
  error,
  onRetry,
  value,
  onChange,
  disabled,
  none,
}: {
  spaces: Space[] | null;
  error: string | null;
  onRetry: () => void;
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** A first row meaning "no space" (New space: the top level). Picking it calls onChange with the current value, which that screen reads as "clear". */
  none?: string;
}) {
  const c = useColors();
  const chosen = spaces?.find((s) => s.id === value);
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const shown = (spaces ?? []).filter((s) => s.path.toLowerCase().includes(words.trim().toLowerCase()));
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setWords('');
  };

  return (
    <>
      {error ? <ErrorBox message={error} onRetry={onRetry} /> : null}
      {!spaces && !error ? <Loading /> : null}
      {spaces && !open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chosen ? `Space: ${chosen.path}. Change` : 'Choose a space'}
          disabled={disabled || !spaces.length}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: gap.s,
              borderWidth: 1,
              borderColor: c.line,
              backgroundColor: c.card,
              borderRadius: 10,
              paddingHorizontal: gap.m,
              paddingVertical: gap.m,
            },
            pressed && { opacity: 0.6 },
          ]}>
          <Text style={{ color: chosen || none ? c.text : c.muted, fontSize: 16, flex: 1 }} numberOfLines={1}>
            {chosen ? label(chosen) : (none ?? 'Choose a space')}
          </Text>
          <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>{chosen || none ? 'Change ›' : 'Choose ›'}</Text>
        </Pressable>
      ) : null}
      {spaces && open ? (
        <View style={{ gap: gap.s }}>
          {spaces.length > 6 ? (
            <TextInput
              value={words}
              onChangeText={setWords}
              placeholder="Find a space"
              placeholderTextColor={c.muted}
              autoFocus
              style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
            />
          ) : null}
          <GroupList>
            {none ? <GroupRow first title={none} checked={!chosen} onPress={() => (chosen ? pick(chosen.id) : setOpen(false))} /> : null}
            {shown.map((s, i) => (
              <GroupRow key={s.id} first={!none && i === 0} title={label(s)} checked={s.id === value} onPress={() => pick(s.id)} />
            ))}
          </GroupList>
          {words.trim() && !shown.length ? <Muted>No space by that name.</Muted> : null}
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
            <Text style={{ color: c.accent, fontSize: 15 }}>Close</Text>
          </Pressable>
        </View>
      ) : null}
      {spaces?.length === 0 ? <Muted>No spaces yet. Ask Wilma in the Claude app to create one.</Muted> : null}
    </>
  );
}
