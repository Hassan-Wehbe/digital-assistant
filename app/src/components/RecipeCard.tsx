// A recipe's or cocktail's fields on its note (recipes.ts): the time and servings, the ingredients,
// the numbered steps, Open on TikTok (the link it came from) and Made it, with an optional rating
// (update_item's made_it; the server checks it).
import { useState } from 'react';
import { Linking, Text } from 'react-native';

import { useAuth } from '@/lib/auth';
import { editError } from '@/lib/noteEdit';
import { linkButton, madeArgs, madeLine, recipeSummary, type RecipeMetadata, type RecipeType } from '@/lib/recipes';

import { Chips } from './PlaceFields';
import { Button, Card, Muted, styles, useColors } from './ui';

const STARS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) }));

export function RecipeCard({
  itemId,
  type,
  recipe: r,
  onChanged,
}: {
  itemId: string;
  type: RecipeType;
  recipe: RecipeMetadata;
  onChanged: () => void;
}) {
  const c = useColors();
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const summary = recipeSummary(r);
  const made = madeLine(r);
  const body = { color: c.text, fontSize: 15, lineHeight: 22 };

  const openLink = async () => {
    if (!r.source_url) return;
    setProblem(null);
    try {
      await Linking.openURL(r.source_url);
    } catch {
      setProblem('Could not open the link on this phone.');
    }
  };

  const empty = !summary && !r.ingredients && !r.steps;
  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>
        {type === 'cocktail' ? '🍸 Cocktail' : '🍽️ Recipe'}
        {summary ? ` · ${summary}` : ''}
      </Text>
      {empty ? <Muted>No ingredients or steps yet. Edit note to add them, so Wilma can suggest it.</Muted> : null}
      {r.ingredients ? (
        <>
          <Text style={[styles.title, { color: c.text, fontSize: 15 }]}>Ingredients</Text>
          {r.ingredients.map((x, i) => (
            <Text key={`i${i}`} style={body} selectable>
              • {x}
            </Text>
          ))}
        </>
      ) : null}
      {r.steps ? (
        <>
          <Text style={[styles.title, { color: c.text, fontSize: 15 }]}>Steps</Text>
          {r.steps.map((x, i) => (
            <Text key={`s${i}`} style={body} selectable>
              {i + 1}. {x}
            </Text>
          ))}
        </>
      ) : null}
      {made ? <Muted>{made}</Muted> : null}
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
      {r.source_url ? <Button title={linkButton(r)} onPress={openLink} /> : null}
      {making ? (
        <MadeItForm
          itemId={itemId}
          onDone={(saved) => {
            setMaking(false);
            if (saved) onChanged();
          }}
        />
      ) : (
        <Button title="Made it" kind="plain" onPress={() => setMaking(true)} />
      )}
    </Card>
  );
}

function MadeItForm({ itemId, onDone }: { itemId: string; onDone: (saved: boolean) => void }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await wilma.madeIt(itemId, madeArgs(rating));
      onDone(true);
    } catch (e) {
      setError(editError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  return (
    <>
      <Muted>Made today. How was it? (optional)</Muted>
      <Chips options={STARS} selected={(n) => rating === n} onPress={(n) => setRating(rating === n ? null : n)} disabled={busy} />
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
      <Button title="Cancel" kind="plain" onPress={() => onDone(false)} disabled={busy} />
    </>
  );
}
