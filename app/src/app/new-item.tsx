// Save a new note in a space, optionally with pictures or Visio files (saveNote.ts). Choosing
// Place adds an address, a Google Maps link, the kind and so on (places.ts); Recipe or Cocktail adds
// ingredients, steps and so on (recipes.ts); Task opens task.tsx. A built-in space holds one kind
// (builtInSpaces.ts, D45): Places a place, Recipes a recipe, Cocktails a drink, Memories one short
// fact, Tasks a task (the task form), with no kind to choose. A new place starts with "Find it on
// the map" (FindOnMap.tsx); a typed street address with no spot is looked up on the phone at Save.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { FindOnMap, type FoundPlace } from '@/components/FindOnMap';
import { Chips, PlaceFields } from '@/components/PlaceFields';
import { RecipeFields } from '@/components/RecipeFields';
import { SpaceChips } from '@/components/SpaceChips';
import { Button, Card, KeyboardScreen, Muted, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { builtInOf } from '@/lib/builtInSpaces';
import { deviceUploadDeps } from '@/lib/deviceFiles';
import { deviceGeocoder } from '@/lib/location';
import { lookUpPlace } from '@/lib/placeLookup';
import { EMPTY_PLACE, placeMetadata, type PlaceForm } from '@/lib/places';
import { looksLikeStreetAddress } from '@/lib/placeSearch';
import { EMPTY_RECIPE, recipeMetadata, type RecipeForm, type RecipeType } from '@/lib/recipes';
import { saveNote } from '@/lib/saveNote';
import type { PickedFile } from '@/lib/upload';

type NoteKind = 'note' | 'place' | RecipeType | 'memory';
/** The kind a built-in space holds (Tasks opens the task form instead). */
const SPACE_KIND = { places: 'place', recipes: 'recipe', cocktails: 'cocktail', memories: 'memory' } as const;
// ✅ Task opens the task form (task.tsx): a task has its own fields and lives in the Tasks space.
const KINDS_OF_NOTE: { value: NoteKind | 'task'; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'place', label: '📍 Place' },
  { value: 'recipe', label: '🍽️ Recipe' },
  { value: 'cocktail', label: '🍸 Cocktail' },
  { value: 'task', label: '✅ Task' },
];

export default function NewItem() {
  const c = useColors();
  const { wilma } = useAuth();
  // here=1: the home screen's Save where I am (a place that starts by reading the location).
  // pick=camera|pictures: home's ＋ menu, which opens the camera or the picture picker at once.
  const params = useLocalSearchParams<{ space?: string; here?: string; pick?: string }>();
  const pick = params.pick === 'camera' || params.pick === 'pictures' ? params.pick : undefined;
  const spaces = useLoad('spaces', () => wilma.listSpaces());
  const [space, setSpace] = useState<string | undefined>(params.space);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // A built-in space decides the kind; otherwise the one the user picked (a plain note by default).
  const [chosen, setChosen] = useState<NoteKind | null>(params.here === '1' ? 'place' : null);
  const builtIn = builtInOf(spaces.data?.find((s) => s.id === space), spaces.data ?? []);
  const kind: NoteKind = builtIn && builtIn !== 'tasks' ? SPACE_KIND[builtIn] : (chosen ?? 'note');
  const isPlace = kind === 'place';
  const isMemory = kind === 'memory';
  const rtype = kind === 'recipe' || kind === 'cocktail' ? kind : null;
  const [place, setPlace] = useState<PlaceForm>(EMPTY_PLACE);
  // A new place starts with "Find it on the map" (not from Save where I am: that reads the spot).
  const [finding, setFinding] = useState(params.here !== '1');
  const [hereNow, setHereNow] = useState(params.here === '1');
  const [googlePlaceId, setGooglePlaceId] = useState<string | undefined>(undefined);
  const [recipe, setRecipe] = useState<RecipeForm>(EMPTY_RECIPE);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the note exists, so a retry after a failed upload does not create a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const save = async () => {
    if (!space) return setError('Choose a space.');
    if (!title.trim()) {
      return setError(isPlace ? 'Give the place a name.' : rtype ? `Give the ${rtype} a name.` : isMemory ? 'Write the fact to remember.' : 'Give the note a title.');
    }
    // A typed street address without a spot: the phone's own lookup finds it now (only the address
    // is looked up, never where the phone is; no permission is asked here). Not found: saved as is.
    let form = place;
    if (isPlace && !createdId && !form.coords && looksLikeStreetAddress(form.address)) {
      setStatus('Finding the address on the map…');
      const out = await lookUpPlace(deviceGeocoder, form.address.trim(), false);
      setStatus(null);
      if ('found' in out) form = { ...form, coords: out.found };
    }
    const fields = isPlace && !createdId ? placeMetadata(form, googlePlaceId ? { google_place_id: googlePlaceId } : null) : null;
    if (fields && 'error' in fields) return setError(fields.error);
    const recipeFields = rtype && !createdId ? recipeMetadata(recipe, rtype) : null;
    if (recipeFields && 'error' in recipeFields) return setError(recipeFields.error);
    setBusy(true);
    setError(null);
    let itemId = createdId;
    try {
      const target = itemId
        ? { itemId }
        : {
            space,
            title: title.trim(),
            body,
            ...(fields ? { place: fields.metadata } : {}),
            ...(rtype && recipeFields ? { recipe: { type: rtype, metadata: recipeFields.metadata } } : {}),
          };
      const out = await saveNote(wilma, target, files, deviceUploadDeps, {
        onCreated: (id) => {
          itemId = id;
          setCreatedId(id);
        },
        onStatus: setStatus,
      });
      if (out.failed.length) {
        // Keep only the files that did not make it, to try again on the same note.
        setFiles(files.filter((f) => out.failed.every((line) => !line.startsWith(`${f.name}: `))));
        throw new Error(`Not uploaded: ${out.failed.join('; ')}.`);
      }
      router.replace({ pathname: '/item/[id]', params: { id: out.itemId } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(itemId ? `${message} The note is saved; press Save to try the files again, or open it.` : message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  // "Find it on the map" → Yes: the name (unless one is typed), the address, the kind and the spot.
  const found = (p: FoundPlace) => {
    if (p.name && !title.trim()) setTitle(p.name);
    setPlace((f) => ({ ...f, address: p.address || f.address, kind: p.kind ?? f.kind, coords: p.coords ?? f.coords }));
    setGooglePlaceId(p.googlePlaceId);
    setFinding(false);
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  // Tasks holds tasks: they have their own form.
  if (builtIn === 'tasks') {
    return (
      <KeyboardScreen>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: c.text }]}>Space</Text>
          <SpaceChips spaces={spaces.data} error={spaces.error} onRetry={spaces.reload} value={space} onChange={setSpace} disabled={busy} />
          <Card>
            <Text style={{ color: c.text, fontSize: 15 }}>Everything in Tasks is a task, with its own form (a date, a place, how long).</Text>
            <Button title="＋ New task" onPress={() => router.replace('/task')} />
          </Card>
        </ScrollView>
      </KeyboardScreen>
    );
  }
  const searching = isPlace && finding && !createdId;
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Space</Text>
        <SpaceChips
          spaces={spaces.data}
          error={spaces.error}
          onRetry={spaces.reload}
          value={space}
          onChange={setSpace}
          disabled={busy || !!createdId}
        />

        {/* A built-in space holds one kind: no choice to make there (D45). */}
        {builtIn ? null : (
          <Chips
            options={KINDS_OF_NOTE}
            selected={(v) => v === kind}
            onPress={(v) => (v === 'task' ? router.replace('/task') : setChosen(v))}
            disabled={busy || !!createdId}
          />
        )}
        {searching ? (
          <>
            <FindOnMap start={title} onFound={found} onHand={() => setFinding(false)} disabled={busy} />
            <Button
              title="📍 Use where I am now"
              kind="plain"
              onPress={() => {
                setHereNow(true);
                setFinding(false);
              }}
              disabled={busy}
            />
          </>
        ) : (
          <>
            <TextInput
              style={input}
              placeholder={
                isPlace ? 'Name of the place' : rtype ? `Name of the ${rtype}` : isMemory ? 'One short fact, e.g. Lexi swims on Tuesdays' : 'Title'
              }
              placeholderTextColor={c.muted}
              maxLength={isMemory ? 200 : 300}
              value={title}
              onChangeText={setTitle}
              editable={!busy && !createdId}
            />
            {isPlace && !createdId ? <TextLink title="🔎 Find it on the map instead" onPress={() => setFinding(true)} /> : null}
            {isPlace ? <PlaceFields value={place} onChange={setPlace} disabled={busy || !!createdId} locateNow={hereNow} /> : null}
          </>
        )}
        {rtype ? <RecipeFields type={rtype} value={recipe} onChange={setRecipe} disabled={busy || !!createdId} /> : null}
        {isMemory || searching ? null : (
          <>
            <TextInput
              style={[input, { minHeight: 140, textAlignVertical: 'top' }]}
              placeholder={isPlace ? 'Note (optional), e.g. try the fattoush' : rtype ? 'Note (optional), e.g. the recipe as written, or a tip' : 'Note (optional)'}
              placeholderTextColor={c.muted}
              multiline
              maxLength={40000}
              value={body}
              onChangeText={setBody}
              editable={!busy && !createdId}
            />
            <Muted>Passwords and other secrets belong in the vault, not in notes.</Muted>

            <Text style={[styles.title, { color: c.text }]}>Photos and files (optional)</Text>
            <AttachmentPicker files={files} onChange={setFiles} disabled={busy} start={pick} />
          </>
        )}
        {isMemory ? <Muted>Wilma uses what is in Memories when you chat. Passwords and other secrets belong in the vault.</Muted> : null}

        {error ? (
          <Card>
            <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text>
            {createdId ? (
              <Button
                title="Open the note"
                kind="plain"
                onPress={() => router.replace({ pathname: '/item/[id]', params: { id: createdId } })}
              />
            ) : null}
          </Card>
        ) : null}
        {status ? <Muted>{status}</Muted> : null}
        {searching ? null : (
          <Button title={busy ? 'Saving…' : files.length ? `Save with ${files.length} file${files.length > 1 ? 's' : ''}` : 'Save'} onPress={save} disabled={busy} />
        )}
      </ScrollView>
    </KeyboardScreen>
  );
}
