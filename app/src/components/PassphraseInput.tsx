// A passphrase or recovery key field: hidden until Show, no autocorrect, suggestions,
// keyboard learning or autofill. The value lives only in the screen's state.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { styles, useColors } from './ui';

export function PassphraseInput({
  value,
  onChangeText,
  placeholder,
  disabled,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  disabled?: boolean;
  onSubmitEditing?: () => void;
}) {
  const c = useColors();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <TextInput
        style={[styles.input, { flex: 1, color: c.text, borderColor: c.line, backgroundColor: c.card }]}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        secureTextEntry={!shown}
        keyboardType={shown ? 'visible-password' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        maxLength={1000}
        editable={!disabled}
      />
      <Pressable accessibilityRole="button" onPress={() => setShown((s) => !s)}>
        <Text style={{ color: c.accent, fontSize: 15 }}>{shown ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
  );
}
