// One entry of the chat thread: your messages on the right, Wilma's on the left, and her notices.
// Text is plain and selectable (no markdown, no links opened: decision 3).
import { Text, View } from 'react-native';

import { ChatCard, ChatCardText } from '@/components/ChatCard';
import { CalendarCard, DayCard, DeleteCard, LocationCard, MemoryLine, NotesCard, PlacesCard, VaultCard } from '@/components/ChatCards';
import { AlarmCard, AlarmsCard, EventCard, ReminderCard, RemindersCard } from '@/components/PhoneCards';
import { HomeAskCard, HomeCard } from '@/components/HomeCard';
import { OutingPlanCard } from '@/components/OutingPlanCard';
import { todayAndTomorrow } from '@/lib/dayView';
import { RoutineCard } from '@/components/RoutineCard';
import { Button, Muted, useColors } from '@/components/ui';
import type { Entry, ErrorButton, EventAdded, HomeSaved } from '@/lib/chatThread';
import type { EventCardData } from '@/lib/phoneActions';

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
  onUndoMemory,
  onEventAdded,
  onHomeSaved,
  onRoutineSaved,
  homeAskActive = false,
  onAnswerHomeAsk,
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
  /** Undo on a "🧠 Remembered" line. */
  onUndoMemory?: (entryId: string, memoryId: string) => Promise<boolean>;
  /** Add to calendar worked on a 📅 card: kept in the thread. */
  onEventAdded?: (entryId: string, added: EventAdded, event: EventCardData) => void;
  /** A 🏠 card's home was saved (on its tap). */
  onHomeSaved?: (entryId: string, saved: HomeSaved) => void;
  /** A 🔁 card's routine was saved (on its tap). */
  onRoutineSaved?: (entryId: string, routineId: string) => void;
  /** A "You're at Mom's" card can be tapped. */
  homeAskActive?: boolean;
  onAnswerHomeAsk?: (entryId: string, chosen: 'at' | 'def') => void;
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
    case 'day':
      return <DayCard entry={entry} />;
    case 'alarm':
      return <AlarmCard entry={entry} />;
    case 'alarms':
      return <AlarmsCard />;
    case 'reminder':
      return <ReminderCard entry={entry} />;
    case 'reminders':
      return <RemindersCard entry={entry} />;
    case 'event':
      return <EventCard entry={entry} onAdded={(added, event) => onEventAdded?.(entry.id, added, event)} />;
    case 'home':
      return <HomeCard entry={entry} onSaved={(saved) => onHomeSaved?.(entry.id, saved)} />;
    case 'routine':
      return <RoutineCard entry={entry} onSaved={(routineId) => onRoutineSaved?.(entry.id, routineId)} />;
    case 'outing':
      return (
        <View style={{ alignSelf: 'stretch' }}>
          <OutingPlanCard plan={entry.plan} today={todayAndTomorrow(new Date()).today} />
        </View>
      );
    case 'home_ask':
      return <HomeAskCard entry={entry} active={homeAskActive && !!onAnswerHomeAsk} onAnswer={(chosen) => onAnswerHomeAsk?.(entry.id, chosen)} />;
    case 'memory':
      return <MemoryLine entry={entry} onUndo={(memoryId) => onUndoMemory?.(entry.id, memoryId) ?? Promise.resolve(false)} />;
  }
}
