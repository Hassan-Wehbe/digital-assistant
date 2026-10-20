// The cards on What's for dinner? and Make a cocktail (recipes step 6; the mockups "What's for
// dinner?", "Make a cocktail" and "Nothing fits: A new idea"). The best fit is a full card: why,
// what is missing, your rating and when you last made it, Open recipe (and the link it came from);
// the other two are one line each. A new idea is marked NEW · NOT FROM YOUR RECIPES and is saved
// only on Save to Recipes (Q7).
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { historyLine, shortLine, type Suggestion } from '@/lib/recipeSuggest';
import { linkButton, recipeSummary, type RecipeMetadata } from '@/lib/recipes';
import type { FilledFields } from '@/lib/recipeImport';

import { Button, Card, Muted, space, styles, useColors } from './ui';

const open = (id: string) => router.push({ pathname: '/item/[id]', params: { id } });

function Label({ text, tone }: { text: string; tone: 'good' | 'warn' }) {
  const c = useColors();
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: tone === 'good' ? c.goodBg : c.warnBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color: tone === 'good' ? c.good : c.warn, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>{text}</Text>
    </View>
  );
}

export function BestFitCard({ s, today }: { s: Suggestion; today: string }) {
  const c = useColors();
  const [problem, setProblem] = useState<string | null>(null);
  const history = historyLine(s, today);
  const link: RecipeMetadata = { ...(s.source_url ? { source_url: s.source_url } : {}), ...(s.source_site ? { source_site: s.source_site } : {}) };
  const openLink = async () => {
    setProblem(null);
    try {
      await Linking.openURL(s.source_url!);
    } catch {
      setProblem('Could not open the link on this phone.');
    }
  };
  return (
    <Card style={{ gap: space.s, borderColor: c.accent, borderWidth: 1.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        <Text style={[styles.title, { color: c.text, flex: 1 }]}>{s.title}</Text>
        <Label text="BEST FIT" tone="good" />
      </View>
      {s.why ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{[s.minutes ? `${s.minutes} min` : null, s.why].filter(Boolean).join(' · ')}</Text> : null}
      {s.missing?.length ? <Text style={{ color: c.warn, fontSize: 14 }}>{`Missing: ${s.missing.join(', ')}`}</Text> : null}
      {history ? <Muted>{history}</Muted> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Button title={s.type === 'cocktail' ? 'Open cocktail' : 'Open recipe'} onPress={() => open(s.id)} />
        {s.source_url ? <Button title={linkButton(link)} kind="plain" onPress={() => void openLink()} /> : null}
      </View>
      {problem ? <Muted>{problem}</Muted> : null}
    </Card>
  );
}

export function OtherCard({ s }: { s: Suggestion }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${s.title}`} onPress={() => open(s.id)} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{s.title}</Text>
          <Muted>{shortLine(s)}</Muted>
        </View>
        <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>Open</Text>
      </Card>
    </Pressable>
  );
}

export function IdeaCard({
  title,
  fields,
  saveTo,
  saving,
  onSave,
  onAnother,
}: {
  title: string;
  fields: FilledFields;
  /** "Recipes" or "Cocktails". */
  saveTo: string;
  saving: boolean;
  onSave: () => void;
  onAnother: () => void;
}) {
  const c = useColors();
  const summary = recipeSummary(fields);
  const body = { color: c.text, fontSize: 15, lineHeight: 22 };
  const head = { color: c.muted, fontSize: 13, fontWeight: '700' as const };
  return (
    <Card style={{ gap: space.s, borderColor: c.warn, borderStyle: 'dashed', borderWidth: 1.5 }}>
      <Label text="NEW · NOT FROM YOUR RECIPES" tone="warn" />
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {summary ? <Muted>{summary}</Muted> : null}
      {fields.ingredients?.length ? (
        <View style={{ gap: 2 }}>
          <Text style={head}>Ingredients</Text>
          {fields.ingredients.map((line, i) => (
            <Text key={i} style={body}>{line}</Text>
          ))}
        </View>
      ) : null}
      {fields.steps?.length ? (
        <View style={{ gap: 2 }}>
          <Text style={head}>Steps</Text>
          {fields.steps.map((line, i) => (
            <Text key={i} style={body}>{`${i + 1}. ${line}`}</Text>
          ))}
        </View>
      ) : null}
      <Muted>Wilma’s idea, not a recipe you’ve tried. Check it before you make it.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Button title={saving ? 'Saving…' : `Save to ${saveTo}`} disabled={saving} onPress={onSave} />
        <Button title="Another idea" kind="plain" disabled={saving} onPress={onAnother} />
      </View>
    </Card>
  );
}
