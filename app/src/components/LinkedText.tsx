// A note's text with its web links tappable (lib/textLinks.ts): a tap opens the link in the browser.
// The text is shown exactly as saved, and stays selectable.
import { Linking, Text, type StyleProp, type TextStyle } from 'react-native';

import { splitLinks } from '@/lib/textLinks';

import { useColors } from './ui';

export function LinkedText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return (
    <Text style={style} selectable>
      {splitLinks(text).map((p, i) =>
        'url' in p ? (
          <Text
            key={i}
            accessibilityRole="link"
            style={{ color: c.accent, textDecorationLine: 'underline' }}
            onPress={() => void Linking.openURL(p.url).catch(() => {})}>
            {p.text}
          </Text>
        ) : (
          p.text
        ),
      )}
    </Text>
  );
}
