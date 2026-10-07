// The Wilma box (docs/ui-review.md, plan step 1): one box for home and the chat. Three lines tall,
// growing to about six as you type, then it scrolls. Along its bottom: `left` (the ＋ menu, or 📍),
// `center` (the usage counter), `mic` (the screen's own mic button, only with VOICE_ENABLED), and
// Send. Return adds a new line; only Send sends, so nothing goes out by a slip of the keyboard.
import { useState, type ReactNode, type Ref } from 'react';
import { Text, TextInput, View } from 'react-native';

import { IconButton, space, useColors } from './ui';

const LINE = 22;
const PAD = 10;

export function WilmaBox({
  inputRef,
  value,
  onChangeText,
  placeholder,
  editable = true,
  onSend,
  sendDisabled,
  onStop,
  left,
  center,
  mic,
  minLines = 3,
  maxLines = 6,
  onPanel,
  warn,
}: {
  inputRef?: Ref<TextInput>;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable?: boolean;
  onSend: () => void;
  sendDisabled?: boolean;
  /** While an answer is being written: a ■ Stop button in Send's place. */
  onStop?: () => void;
  left?: ReactNode;
  center?: ReactNode;
  mic?: ReactNode;
  minLines?: number;
  maxLines?: number;
  /** On the white top panel: the box takes the page colour to stand out from it. */
  onPanel?: boolean;
  /** Draw the box's edge in the warning colour (the password check, plan step 4). */
  warn?: boolean;
}) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        borderWidth: 1,
        borderRadius: 16,
        borderColor: warn ? c.warn : focused ? c.accent : c.line,
        backgroundColor: onPanel ? c.background : c.card,
        paddingHorizontal: space.s,
        paddingTop: space.xs,
        paddingBottom: space.s,
        gap: space.xs,
      }}>
      <TextInput
        ref={inputRef}
        style={{
          color: c.text,
          fontSize: 16,
          lineHeight: LINE,
          minHeight: minLines * LINE + PAD,
          maxHeight: maxLines * LINE + PAD,
          paddingHorizontal: space.xs,
          paddingVertical: PAD / 2,
          textAlignVertical: 'top',
        }}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        value={value}
        editable={editable}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline
        scrollEnabled
        maxLength={20000}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        {left}
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>{center}</View>
        {mic}
        {onStop ? (
          <IconButton icon="■" label="Stop" onPress={onStop} />
        ) : (
          <IconButton icon="↑" label="Send" kind="primary" onPress={onSend} disabled={sendDisabled} />
        )}
      </View>
    </View>
  );
}

/** The usage counter in the middle of the box: muted, amber when low, red when used up. */
export function BoxCounter({ text, low, usedUp, onPress }: { text: string; low?: boolean; usedUp?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Text
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${text}. AI requests this month`}
      onPress={onPress}
      numberOfLines={1}
      style={{
        color: usedUp ? c.danger : low ? c.warn : c.muted,
        fontSize: 13,
        fontWeight: low || usedUp ? '600' : '400',
        fontVariant: ['tabular-nums'],
      }}>
      {text}
    </Text>
  );
}
