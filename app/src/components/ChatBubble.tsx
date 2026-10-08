// One entry of the chat thread: your messages on the right, Wilma's on the left, and her notices.
// Text is plain and selectable (no markdown, no links opened: decision 3).
import { Text, View } from 'react-native';

import { ChatCard, ChatCardText } from '@/components/ChatCard';
import { CalendarCard, DeleteCard, LocationCard, NotesCard, PlacesCard, VaultCard } from '@/components/ChatCards';
import { Button, Muted, useColors } from '@/components/ui';
import type { Entry, ErrorButton } from '@/lib/chatThread';

const BUTTON_TITLES: Record<ErrorButton, string> = { search: 'Search', vault: 'Vault', try_again: 'Try again' };

export function ChatBubble({
  entry,
  onButton,
  buttonsEnabled,
  cardActive,
  onConfirm,
  onCancel,
  notesActive = false,
  onAskWilma,
  locationActive = false,
  onShareLocation,
  onNotNow,
}: {
  entry: Entry;
  onButton: (button: ErrorButton) => void;
  /** Error buttons show only on the latest message, and not while an answer is coming. */
  buttonsEnabled: boolean;
  /** A delete card's Delete and Cancel can be tapped. */
  cardActive: boolean;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  /** A notes card's "Ask Wilma instead" can be tapped. */
  notesActive?: boolean;
  onAskWilma?: (entry: Extract<Entry, { kind: 'notes' }>) => void;
  /** A "📍 Share where I am" card's buttons can be tapped. */
  locationActive?: boolean;
  onShareLocation?: (id: string) => void;
  onNotNow?: (id: string) => void;
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
        <ChatCard
          icon="⚠️"
          actions={
            buttonsEnabled && entry.buttons.length
              ? entry.buttons.map((b) => (
                  // Try again is the main action when offered; Search and Vault are the ways around.
                  <Button key={b} title={BUTTON_TITLES[b]} kind={b === 'try_again' ? 'primary' : 'plain'} onPress={() => onButton(b)} />
                ))
              : undefined
          }>
          <ChatCardText>{entry.message}</ChatCardText>
          {entry.note ? <Muted>{entry.note}</Muted> : null}
        </ChatCard>
      );
    case 'confirm':
      return <DeleteCard entry={entry} active={cardActive} onConfirm={() => onConfirm(entry.id)} onCancel={() => onCancel(entry.id)} />;
    case 'vault':
      return <VaultCard entry={entry} />;
    case 'notes':
      return <NotesCard entry={entry} active={notesActive && !!onAskWilma} onAskWilma={() => onAskWilma?.(entry)} />;
    case 'places':
      return <PlacesCard entry={entry} />;
    case 'location':
      return (
        <LocationCard
          entry={entry}
          active={locationActive && !!onShareLocation}
          onShare={() => onShareLocation?.(entry.id)}
          onNotNow={() => onNotNow?.(entry.id)}
        />
      );
    case 'calendar':
      return <CalendarCard entry={entry} />;
  }
}
