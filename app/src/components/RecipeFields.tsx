// The recipe part of New note and Edit note (recipes.ts): ingredients and steps one per line, the
// time, how many it serves, the link it came from, and a cocktail's strength. All optional.
// Fill in from the link, or Read a screenshot (recipeImport.ts), fills the empty boxes, only when tapped.
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { pickRecipePicture } from '@/lib/deviceFiles';
import { canFill, fillFromLink, fillFromScreenshot, type FillOutcome } from '@/lib/recipeImport';
import { MAX_LINK, STRENGTH_LABELS, STRENGTHS, type RecipeForm, type RecipeType, type Strength } from '@/lib/recipes';
import { WilmaError } from '@/lib/wilma';

import { Chips } from './PlaceFields';
import { Muted, styles, TextLink, useColors } from './ui';

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
  const { recipeText } = useAuth();
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<{ text: string; error: boolean } | null>(null);
  const set = (change: Partial<RecipeForm>) => onChange((current) => ({ ...current, ...change }));
  const locked = disabled || filling;

  // Only on the tap: the page (or TikTok's caption, then one AI request), or a picture the user picks
  // (one AI request), is read and the empty boxes filled.
  const run = async (read: () => Promise<FillOutcome | null>) => {
    setFilling(true);
    setFillNote(null);
    try {
      const out = await read();
      if (!out) return;
      if ('error' in out) setFillNote({ text: out.error, error: true });
      else {
        onChange(() => out.form);
        setFillNote({ text: out.message, error: false });
      }
    } catch (e) {
      setFillNote({ text: e instanceof WilmaError ? e.message : 'Couldn’t fill it in. Try again.', error: true });
    } finally {
      setFilling(false);
    }
  };
  const fill = () => run(() => fillFromLink(f, type, { fetch, fromText: recipeText.fromText }));
  const readPicture = () => run(() => fillFromScreenshot(f, type, { pick: pickRecipePicture, fromImage: recipeText.fromImage }));
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
        editable={!locked}
      />
      <Text style={label}>Steps</Text>
      <TextInput
        style={box}
        placeholder={'One per line, in order'}
        placeholderTextColor={c.muted}
        multiline
        value={f.steps}
        onChangeText={(steps) => set({ steps })}
        editable={!locked}
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
          editable={!locked}
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
          editable={!locked}
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
        onChangeText={(link) => {
          set({ link });
          setFillNote(null);
        }}
        editable={!locked}
      />
      {disabled ? null : filling ? (
        <Muted>Reading…</Muted>
      ) : (
        <View style={{ gap: 6 }}>
          {canFill(f) ? <TextLink title="Fill in the recipe from the link" onPress={() => void fill()} /> : null}
          <TextLink title="📷 Read a screenshot of the recipe" onPress={() => void readPicture()} />
        </View>
      )}
      {fillNote ? <Text style={{ color: fillNote.error ? c.danger : c.muted, fontSize: 15 }}>{fillNote.text}</Text> : null}
      {type === 'cocktail' ? (
        <>
          <Text style={label}>Strength</Text>
          <Chips<Strength>
            options={STRENGTH_CHIPS}
            selected={(s) => f.strength === s}
            onPress={(s) => set({ strength: f.strength === s ? null : s })}
            disabled={locked}
          />
        </>
      ) : null}
    </View>
  );
}
