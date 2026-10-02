// One entry of the chat thread: your messages on the right, Wilma's on the left, and her notices.
// Text is plain and selectable (no markdown, no links opened: decision 3).
import { Text, View } from 'react-native';

import { Button, Card, Muted, useColors } from '@/components/ui';
import type { Entry, ErrorButton } from '@/lib/chatThread';

const BUTTON_TITLES: Record<ErrorButton, string> = { search: 'Search', vault: 'Vault', try_again: 'Try again' };

export function ChatBubble({
  entry,
  onButton,
  buttonsEnabled,
}: {
  entry: Entry;
  onButton: (button: ErrorButton) => void;
  /** Error buttons show only on the latest message, and not while an answer is coming. */
  buttonsEnabled: boolean;
}) {
  const c = useColors();
  switch (entry.kind) {
    case 'user':
      return (
        <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.accent, borderRadius: 16, padding: 12 }}>
          <Text selectable style={{ color: '#ffffff', fontSize: 16, lineHeight: 22 }}>
            {entry.text}
          </Text>
        </View>
      );
    case 'assistant':
      return (
        <View
          style={{
            alignSelf: 'flex-start',
            maxWidth: '85%',
            backgroundColor: c.card,
            borderColor: c.line,
            borderWidth: 1,
            borderRadius: 16,
            padding: 12,
          }}>
          <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>
            {entry.text}
          </Text>
        </View>
      );
    case 'error':
      return (
        <Card style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
          <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{entry.message}</Text>
          {entry.note ? <Muted>{entry.note}</Muted> : null}
          {buttonsEnabled
            ? entry.buttons.map((b) => <Button key={b} title={BUTTON_TITLES[b]} kind="plain" onPress={() => onButton(b)} />)
            : null}
        </Card>
      );
    // Delete and vault cards come in the next steps; until then they only say what Wilma
    // suggested, and nothing can be run from here.
    case 'confirm':
      return (
        <Card style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
          <Muted>
            {entry.state === 'pending'
              ? `Wilma suggested deleting “${entry.target.title}”. Deleting from the chat comes in a later update; for now, open it from the home screen.`
              : `Not deleted: “${entry.target.title}”.`}
          </Muted>
        </Card>
      );
    case 'vault':
      return (
        <Card style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
          <Muted>{`Open “${entry.name}” from the Vault on the home screen.`}</Muted>
        </Card>
      );
  }
}
