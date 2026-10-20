// What's for dinner? and Make a cocktail (recipes step 6, docs/recipes-plan.md; design D43; the
// mockups on the owner's canvas): one screen, two kinds (?mode=meal or cocktail), from Home's Cook
// with Wilma row.
//
// What's for dinner?: Time (20 min · 45 min · No rush), Who (the household's adults and children's
// ages, from Settings → Household; the names never leave the phone, Q12), Kind (Anything ·
// Vegetarian · Kid-friendly · Light) and I have. Make a cocktail: My bar, Strength (Regular · Light
// · No alcohol, always offered, Q11) and Mood. "I have" and "My bar" are remembered on this phone
// only (Q6); text that looks like a password is held here and never sent (rule 9).
//
// Suggest: the suggestion route (lib/recipeSuggest.ts) picks up to three of the user's own recipes
// from searchable spaces (one AI request, counted: 10 a day, 50 with Pro, Q10). The best fit is a
// full card, the others one line; Another idea asks again without the ones shown. When nothing
// fits (no AI request, not counted), A new idea (Q7): one recipe not from theirs, clearly marked,
// saved into Recipes or Cocktails only on Save. Nothing here is stored on the server.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/PlaceFields';
import { PasswordHold } from '@/components/PasswordHold';
import { BestFitCard, IdeaCard, OtherCard } from '@/components/SuggestionCard';
import { Button, Muted, space, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { findCredential } from '@/lib/credentials';
import { deviceSettingsStore } from '@/lib/deviceStorage';
import { listMembers, type HouseholdDb } from '@/lib/household';
import { whoFrom } from '@/lib/outing';
import { localDate } from '@/lib/places';
import type { FilledFields } from '@/lib/recipeImport';
import {
  KINDS, limitText, loadHave, MAX_HAVE, MOODS, NONE_TEXT, noneFitText, PROBLEM_TEXT, saveHave, suggestBody, TIMES, typeOf, usageText,
  type MealKind, type Mood, type SuggestAnswer, type SuggestChoices, type SuggestMode, type Suggestion, type Usage,
} from '@/lib/recipeSuggest';
import { STRENGTH_LABELS, STRENGTHS, type Strength } from '@/lib/recipes';
import { supabase } from '@/lib/supabase';
import { WilmaError } from '@/lib/wilma';

type Shown =
  | { step: 'choose' }
  | { step: 'asking' }
  | { step: 'picks'; picks: Suggestion[]; usage: Usage }
  | { step: 'none'; text: string }
  | { step: 'idea'; title: string; fields: FilledFields; usage: Usage }
  | { step: 'problem'; text: string };

export default function Suggest() {
  const c = useColors();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: SuggestMode = params.mode === 'cocktail' ? 'cocktail' : 'meal';
  const meal = mode === 'meal';
  const { session, suggest, wilma, signOut } = useAuth();
  const userId = session?.user.id ?? '';
  const [today] = useState(() => localDate(new Date()));

  // The choices (kept while the screen is open; I have / My bar also on this phone).
  const [have, setHave] = useState('');
  const loaded = useRef(false);
  useEffect(() => {
    if (!userId) return;
    void loadHave(deviceSettingsStore, mode, userId).then((h) => {
      if (!loaded.current) setHave(h);
      loaded.current = true;
    });
  }, [mode, userId]);
  const [minutes, setMinutes] = useState<number | undefined>(45);
  const [kind, setKind] = useState<MealKind>('anything');
  const [strength, setStrength] = useState<Strength>('regular');
  const [mood, setMood] = useState<Mood>('classic');
  const household = useLoad(`household:${userId}`, () => listMembers(supabase as unknown as HouseholdDb).catch(() => []));
  const homeWho = household.data?.length ? whoFrom(household.data, Number(today.slice(0, 4))) : null;
  const [withAdults, setWithAdults] = useState(true);
  const [withKids, setWithKids] = useState(true);
  const who = homeWho
    ? { adults: withAdults ? homeWho.adults : 0, child_ages: withKids ? homeWho.child_ages : [] }
    : undefined;
  const choices: SuggestChoices = meal ? { have, minutes, kind, who } : { have, strength, mood };

  const [shown, setShown] = useState<Shown>({ step: 'choose' });
  // Every recipe shown since the last Suggest: Another idea leaves them out.
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const credential = useMemo(() => findCredential(have), [have]);
  const busy = shown.step === 'asking' || saving;
  const haveInput = useRef<TextInput>(null);

  const failed = (e: unknown) => {
    if (e instanceof WilmaError && e.signedOut) return void signOut();
    setShown({ step: 'problem', text: PROBLEM_TEXT.connection });
  };
  const problemText = (out: { problem: 'limit' | 'allowance_used' | 'connection'; usage?: Usage }) =>
    out.problem === 'limit' ? limitText(out.usage) : PROBLEM_TEXT[out.problem];

  const ask = async (again: boolean) => {
    if (credential || busy) return;
    void saveHave(deviceSettingsStore, mode, userId, have);
    const avoid = again ? shownIds : [];
    setShown({ step: 'asking' });
    try {
      const out: SuggestAnswer = await suggest.suggest(suggestBody(mode, choices, { avoid }));
      if ('suggestions' in out) {
        setShownIds([...avoid, ...out.suggestions.map((s) => s.id)]);
        setShown({ step: 'picks', picks: out.suggestions, usage: out.usage });
      } else if ('none' in out) {
        setShown({ step: 'none', text: out.none === 'none_fit' ? noneFitText(mode, out.recipes, choices) : NONE_TEXT[out.none] });
      } else {
        setShown({ step: 'problem', text: problemText(out) });
      }
    } catch (e) {
      failed(e);
    }
  };

  const newIdea = async () => {
    if (credential || busy) return;
    void saveHave(deviceSettingsStore, mode, userId, have);
    setSaveProblem(null);
    setShown({ step: 'asking' });
    try {
      const out = await suggest.idea(suggestBody(mode, choices));
      if ('idea' in out) setShown({ step: 'idea', ...out.idea, usage: out.usage });
      else if ('none' in out) setShown({ step: 'none', text: NONE_TEXT[out.none] });
      else setShown({ step: 'problem', text: problemText(out) });
    } catch (e) {
      failed(e);
    }
  };

  // Save to Recipes (or Cocktails): the built-in space, a new note of that type (the server checks
  // every field again, rule 9).
  const saveIdea = async (title: string, fields: FilledFields) => {
    setSaving(true);
    setSaveProblem(null);
    try {
      const builtIn = meal ? 'recipes' : 'cocktails';
      const home = (await wilma.listSpaces()).find((s) => s.built_in === builtIn);
      if (!home) throw new Error(`Your ${meal ? 'Recipes' : 'Cocktails'} space wasn't found.`);
      const out = await wilma.saveItem({ space: home.path, title, body: '', item_type: typeOf(mode), metadata: fields });
      router.replace({ pathname: '/item/[id]', params: { id: out.id } });
    } catch (e) {
      if (e instanceof WilmaError && e.signedOut) return void signOut();
      setSaveProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const label = (t: string) => <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{t}</Text>;
  const title = meal ? "What's for dinner?" : 'Make a cocktail';

  const form = (
    <View style={{ gap: space.s }}>
      {meal ? (
        <>
          {label('TIME')}
          <Chips options={TIMES.map((t) => ({ value: t.minutes ?? 0, label: t.label }))} selected={(v) => v === (minutes ?? 0)} onPress={(v) => setMinutes(v || undefined)} />
          {label('WHO')}
          {homeWho ? (
            <>
              <Chips
                multi
                options={[
                  ...(homeWho.adults ? [{ value: 'adults' as const, label: `${homeWho.adults} ${homeWho.adults === 1 ? 'adult' : 'adults'}` }] : []),
                  ...(homeWho.child_ages.length
                    ? [{ value: 'kids' as const, label: `${homeWho.child_ages.length} ${homeWho.child_ages.length === 1 ? 'kid' : 'kids'} (${homeWho.child_ages.join(', ')})` }]
                    : []),
                ]}
                selected={(v) => (v === 'adults' ? withAdults : withKids)}
                onPress={(v) => (v === 'adults' ? setWithAdults((x) => !x) : setWithKids((x) => !x))}
              />
              <Muted>From Settings → Household. Only ages are used, never names.</Muted>
            </>
          ) : (
            <Muted>Set your household once in Settings → Household, so Wilma knows who’s eating.</Muted>
          )}
          {label('KIND')}
          <Chips options={KINDS} selected={(v) => v === kind} onPress={setKind} />
        </>
      ) : null}
      {label(meal ? 'I HAVE' : 'MY BAR')}
      <TextInput
        ref={haveInput}
        style={[styles.input, { color: c.text, borderColor: credential ? c.warn : c.line, backgroundColor: c.card }]}
        placeholder={meal ? 'chicken, rice, spinach' : 'gin, vodka, lime, mint, tonic'}
        placeholderTextColor={c.muted}
        value={have}
        maxLength={MAX_HAVE}
        onChangeText={setHave}
        accessibilityLabel={meal ? 'What you have' : 'What is in your bar'}
      />
      <Muted>Remembered on this phone for next time.</Muted>
      {credential ? <PasswordHold kind={credential} onEdit={() => haveInput.current?.focus()} /> : null}
      {meal ? null : (
        <>
          {label('STRENGTH')}
          <Chips options={STRENGTHS.map((s) => ({ value: s, label: STRENGTH_LABELS[s] }))} selected={(v) => v === strength} onPress={setStrength} />
          {label('MOOD')}
          <Chips options={MOODS} selected={(v) => v === mood} onPress={setMood} />
        </>
      )}
      <Button title={shown.step === 'asking' ? 'Thinking…' : 'Suggest'} disabled={busy || !!credential} onPress={() => void ask(false)} />
      <Muted>{`From your own ${meal ? 'recipes' : 'cocktails'}. Uses one AI request.`}</Muted>
    </View>
  );

  const usageLine = (u: Usage) => {
    const t = usageText(u);
    return t ? <Text style={{ color: c.muted, fontSize: 13 }}>{t}</Text> : null;
  };

  let result: ReactNode = null;
  if (shown.step === 'picks') {
    const [best, ...others] = shown.picks;
    result = (
      <View style={{ gap: space.m }}>
        <BestFitCard key={best.id} s={best} today={today} />
        {others.map((s) => (
          <OtherCard key={s.id} s={s} />
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TextLink title="Another idea" onPress={() => void ask(true)} />
          {usageLine(shown.usage)}
        </View>
      </View>
    );
  } else if (shown.step === 'none') {
    result = (
      <View style={{ gap: space.s, backgroundColor: c.warnBg, borderRadius: 12, padding: space.m }}>
        <Text style={{ color: c.text, fontSize: 15 }}>{shown.text}</Text>
        <Muted>This didn’t count toward today’s suggestions.</Muted>
        <Button title="A new idea" kind="plain" disabled={busy || !!credential} onPress={() => void newIdea()} />
        <Muted>{`Wilma suggests one ${meal ? 'recipe' : 'cocktail'} that isn't in your spaces. Uses one AI request.`}</Muted>
      </View>
    );
  } else if (shown.step === 'idea') {
    const { title: ideaTitle, fields } = shown;
    result = (
      <View style={{ gap: space.s }}>
        <IdeaCard
          title={ideaTitle}
          fields={fields}
          saveTo={meal ? 'Recipes' : 'Cocktails'}
          saving={saving}
          onSave={() => void saveIdea(ideaTitle, fields)}
          onAnother={() => void newIdea()}
        />
        {saveProblem ? <Text style={{ color: c.danger, fontSize: 15 }}>{saveProblem}</Text> : null}
        <View style={{ alignItems: 'flex-end' }}>{usageLine(shown.usage)}</View>
      </View>
    );
  } else if (shown.step === 'problem') {
    result = <Text style={{ color: c.danger, fontSize: 15 }}>{shown.text}</Text>;
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]} keyboardShouldPersistTaps="handled">
        {form}
        {result}
      </ScrollView>
    </>
  );
}
