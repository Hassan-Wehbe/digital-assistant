// Month and year of birth (docs/age-plan.md step 3, D44), at sign-up and once for older accounts.
// Only sent to the server, which keeps the result ("21 or over", or the month cocktails open);
// never saved on the phone.
import { Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/PlaceFields';
import { Muted, styles, useColors } from '@/components/ui';
import { MONTH_NAMES } from '@/lib/age';

export function BirthMonthFields({ month, year, onMonth, onYear, disabled }: {
  month: number | null;
  year: string;
  onMonth: (m: number) => void;
  onYear: (y: string) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.text, fontSize: 15 }}>Month and year of birth</Text>
      <Chips options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m.slice(0, 3) }))} selected={(v) => v === month} onPress={onMonth} disabled={disabled} />
      <TextInput
        style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
        placeholder="Year, like 1990"
        placeholderTextColor={c.muted}
        keyboardType="number-pad"
        maxLength={4}
        value={year}
        onChangeText={(y) => onYear(y.replace(/\D/g, ''))}
        editable={!disabled}
        accessibilityLabel="Year of birth"
      />
      <Muted>Used once to check your age, then not kept: Wilma keeps only whether you’re 21 or over (or the month you turn 21), for age-limited parts like cocktails.</Muted>
    </View>
  );
}
