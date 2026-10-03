// One entry of the chat thread: your messages on the right, Wilma's on the left, and her notices.
// Text is plain and selectable (no markdown, no links opened: decision 3).
import { Text, View } from 'react-native';

import { DeleteCard } from '@/components/ChatCards';
import { Button, Card, Muted, useColors } from '@/components/ui';
import type { Entry, ErrorButton } from '@/lib/chatThread';

const BUTTON_TITLES: Record<ErrorButton, string> = { search: 'Search', vault: 'Vault', try_again: 'Try again' };

export function ChatBubble({
  entry,
  onButton,
  buttonsEnabled,
  cardActive,
  onConfirm,
  onCancel,
}: {
  entry: Entry;
  onButton: (button: ErrorButton) => void;
  /** Error buttons show only on the latest message, and not while an answer is coming. */
  buttonsEnabled: boolean;
  /** A delete card's Delete and Cancel can be tapped. */
  cardActive: boolean;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
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
    case 'confirm':
      return <DeleteCard entry={entry} active={cardActive} onConfirm={() => onConfirm(entry.id)} onCancel={() => onCancel(entry.id)} />;
    // Vault cards come in the next step; until then they only say where to look.
    case 'vault':
      return (
        <Card style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
          <Muted>{`Open “${entry.name}” from the Vault on the home screen.`}</Muted>
        </Card>
      );
  }
}
