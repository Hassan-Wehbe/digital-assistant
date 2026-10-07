// One shell for every card in the conversation (docs/ui-review.md, "Chat cards", plan step 6): an
// icon for the kind (🔒 vault, 🗒 notes, 📍 place, 🗑 delete, ⚠️ problem), the text, then a
// right-aligned row of buttons side by side. Callers put Cancel first and fill only the one main
// action; a destructive action is red text, never filled (Button kind "danger"). A finished card
// (deleted, left alone, not done) shrinks to one dimmed line. Same corners and padding as the
// bubbles, so cards and messages read as one thread.
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { space, useColors } from './ui';

export function ChatCard({ icon, children, actions }: { icon: string; children: ReactNode; actions?: ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '85%',
        backgroundColor: c.card,
        borderColor: c.line,
        borderWidth: 1,
        borderRadius: 16,
        padding: space.m,
        gap: space.m,
      }}>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Text accessible={false} importantForAccessibility="no" style={{ fontSize: 16, lineHeight: 22 }}>
          {icon}
        </Text>
        <View style={{ flexShrink: 1, gap: space.s }}>{children}</View>
      </View>
      {actions ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.s }}>{actions}</View>
      ) : null}
    </View>
  );
}

/** A finished card: one dimmed line ("Deleted “Pasta”"). */
export function ChatCardDone({ icon, text }: { icon: string; text: string }) {
  const c = useColors();
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '85%', flexDirection: 'row', gap: space.s, paddingHorizontal: space.m, opacity: 0.7 }}>
      <Text accessible={false} importantForAccessibility="no" style={{ fontSize: 14 }}>
        {icon}
      </Text>
      <Text style={{ color: c.muted, fontSize: 14, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

/** The card's text, in the bubbles' size. */
export function ChatCardText({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{children}</Text>;
}
