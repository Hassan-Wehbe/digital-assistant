// The value fields for one kind of secret (SECRET_FIELDS, as on the web entry page).
// Passwords are hidden until Show; no field is autocorrected, capitalised or suggested.
// The values live only in the screen's state and are sealed on the phone (vaultFlow.ts).
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { SECRET_FIELDS } from '@/lib/vaultCrypto';

import { styles, useColors } from './ui';

export function SecretFieldsForm({
  type,
  values,
  onChange,
  disabled,
}: {
  type: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];

  return (
    <View style={{ gap: 12 }}>
      {(SECRET_FIELDS[type] ?? []).map((f) => {
        const hidden = f.kind === 'password' && !shown[f.key];
        return (
          <View key={`${type}.${f.key}`} style={{ gap: 6 }}>
            <Text style={{ color: c.text, fontSize: 15 }}>
              {f.label}
              {f.required ? ' *' : ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TextInput
                style={[input, { flex: 1 }, f.kind === 'textarea' && { minHeight: 100, textAlignVertical: 'top' }]}
                value={values[f.key] ?? ''}
                onChangeText={(t) => onChange({ ...values, [f.key]: t })}
                multiline={f.kind === 'textarea'}
                secureTextEntry={hidden}
                // A shown password still gets no keyboard suggestions or learning.
                keyboardType={f.kind === 'password' && !hidden ? 'visible-password' : 'default'}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                importantForAutofill="no"
                // Well under the 64 KB the vault stores for one secret, even with every field full.
                maxLength={f.kind === 'textarea' ? 8000 : 1000}
                editable={!disabled}
              />
              {f.kind === 'password' ? (
                <Pressable accessibilityRole="button" onPress={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}>
                  <Text style={{ color: c.accent, fontSize: 15 }}>{hidden ? 'Show' : 'Hide'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
