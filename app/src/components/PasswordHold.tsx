// The card under the box when the text looks like a password (docs/ui-review.md, plan step 4):
// Wilma won't send it. "Save in Vault" opens an empty "Save a secret" form: the text is never
// copied across, so the value is typed once more, on the vault's own screen. "Edit message" puts
// the cursor back in the box. The card names the kind, never the value.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { credentialLabel, type CredentialKind } from '@/lib/credentials';

import { Button, Card, space, useColors } from './ui';

export function PasswordHold({ kind, onEdit }: { kind: CredentialKind; onEdit: () => void }) {
  const c = useColors();
  return (
    <Card style={{ borderColor: c.warn }}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: space.xs }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>
          {`This looks like ${credentialLabel(kind)}. Wilma won't send it.`}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>
          Passwords, PINs and keys go in the Vault, where only you can see them.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
        <Button title="Edit message" kind="plain" onPress={onEdit} />
        <Button title="Save in Vault" onPress={() => router.push('/vault/enter')} />
      </View>
    </Card>
  );
}
