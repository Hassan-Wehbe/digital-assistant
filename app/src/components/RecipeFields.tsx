// The recipe part of New note and Edit note (recipes.ts): ingredients and steps one per line, the
// time, how many it serves, the link it came from, and a cocktail's strength. All optional.
import { Text, TextInput, View } from 'react-native';

import { MAX_LINK, STRENGTH_LABELS, STRENGTHS, type RecipeForm, type RecipeType, type Strength } from '@/lib/recipes';

import { Chips } from './PlaceFields';
import { Muted, styles, useColors } from './ui';

const STRENGTH_CHIPS = STRENGTHS.map((s) => ({ value: s, label: STRENGTH_LABELS[s] }));

export function RecipeFields({
  type,
  value: f,
  onChange,
  disabled,
}: {
  type: RecipeType;
  value: RecipeForm;
  onChange: (update: (current: RecipeForm) => RecipeForm) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const set = (change: Partial<RecipeForm>) => onChange((current) => ({ ...current, ...change }));
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  const box = [...input, { minHeight: 110, textAlignVertical: 'top' as const }];
  const label = [styles.title, { color: c.text, fontSize: 15 }];
  return (
    <View style={{ gap: 10 }}>
      <Muted>All optional: a link with a title is enough. Wilma uses what you add to suggest what to make.</Muted>
      <Text style={label}>Ingredients</Text>
      <TextInput
        style={box}
        placeholder={type === 'cocktail' ? 'One per line, e.g.\n1 oz gin\n1 oz Campari' : 'One per line, e.g.\n400 g shrimp\n4 cloves garlic'}
        placeholderTextColor={c.muted}
        multiline
        value={f.ingredients}
        onChangeText={(ingredients) => set({ ingredients })}
        editable={!disabled}
      />
      <Text style={label}>Steps</Text>
      <TextInput
        style={box}
        placeholder={'One per line, in order'}
        placeholderTextColor={c.muted}
        multiline
        value={f.steps}
        onChangeText={(steps) => set({ steps })}
        editable={!disabled}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[...input, { flex: 1 }]}
          placeholder="Minutes"
          placeholderTextColor={c.muted}
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Time in minutes"
          value={f.minutes}
          onChangeText={(minutes) => set({ minutes })}
          editable={!disabled}
        />
        <TextInput
          style={[...input, { flex: 1 }]}
          placeholder="Serves"
          placeholderTextColor={c.muted}
          keyboardType="number-pad"
          maxLength={3}
          accessibilityLabel="How many it serves"
          value={f.serves}
          onChangeText={(serves) => set({ serves })}
          editable={!disabled}
        />
      </View>
      <TextInput
        style={input}
        placeholder="Link it came from (optional)"
        placeholderTextColor={c.muted}
        maxLength={MAX_LINK}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={f.link}
        onChangeText={(link) => set({ link })}
        editable={!disabled}
      />
      {type === 'cocktail' ? (
        <>
          <Text style={label}>Strength</Text>
          <Chips<Strength>
            options={STRENGTH_CHIPS}
            selected={(s) => f.strength === s}
            onPress={(s) => set({ strength: f.strength === s ? null : s })}
            disabled={disabled}
          />
        </>
      ) : null}
    </View>
  );
}
