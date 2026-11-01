// Share -> Wilma: save what another app shared (photos, Visio files, text or a link) as a
// new note, or add the files to an existing note. Same checks and upload as "New note"
// (picked.ts, saveNote.ts); the shared files are copied into the app's cache first.
// A Google Maps share opens as a place (placeFromShared), with its name and link filled in, and
// "Is this it?" from the phone's map lookup of its name and address (PlaceLookup; Yes only).
// A shared link (Facebook, YouTube, ...) can get the page's own title with "Get title", read on
// the phone only on that tap (linkInfo.ts); the favourite spaces come first in the space list (D38).
// Into the built-in Recipes or Cocktails space, it is saved as a recipe or cocktail with the link as
// its source (recipes.ts); ingredients and steps can be added later with Edit note. As New note
// (owner's pick A, 2026-10-30): "What is it?" (Note, Place, Recipe, Drink) and "Where does it go?",
// kept in step: a place goes to Places, a recipe or drink to Recipes or Cocktails (owner,
// 2026-10-31: "I picked place and it asked me to pick a space; that should default to Places"). A
// place shared from anywhere but Google Maps (a Facebook page) can be found with "Find it on the
// map" (FindOnMap.tsx), as on New place.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { AttachmentPicker } from '@/components/AttachmentPicker';
import { FindOnMap, type FoundPlace } from '@/components/FindOnMap';
import { KindBar } from '@/components/KindBar';
import { PlaceFields } from '@/components/PlaceFields';
import { PlaceLookup } from '@/components/PlaceLookup';
import { SpaceChips } from '@/components/SpaceChips';
import { Button, Card, ErrorBox, KeyboardScreen, Loading, Muted, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { builtInOf } from '@/lib/builtInSpaces';
import { findCredential } from '@/lib/credentials';
import { deviceUploadDeps, prepareShared, removeCopies } from '@/lib/deviceFiles';
import { loadFavourites } from '@/lib/favourites';
import { favouriteSpaces } from '@/lib/homeSpaces';
import { fetchLinkTitle, firstUrl } from '@/lib/linkInfo';
import { saveNote, type SaveTarget } from '@/lib/saveNote';
import { supabase } from '@/lib/supabase';
import { EMPTY_PLACE, placeMetadata, type PlaceForm } from '@/lib/places';
import { sharedRecipe } from '@/lib/recipes';
import { draftFromShared, placeFromShared, TITLE_MAX, type Shared } from '@/lib/shared';
import { useShare } from '@/lib/shareIntake';
import type { PickedFile } from '@/lib/upload';

export default function ShareScreen() {
  const c = useColors();
  const { pending, error, clear } = useShare();
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
    clear();
  };
  if (!pending) {
    return (
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list}>
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : <Muted>Nothing shared is waiting to be saved.</Muted>}
        <Button title="Home" kind="plain" onPress={leave} />
      </ScrollView>
    );
  }
  // A new share replaces the form (and its files) entirely.
  return <ShareForm key={pending.id} shared={pending.shared} onDone={clear} onCancel={leave} />;
}

type Mode = 'new' | 'existing';

const KINDS_OF_NOTE = [
  { value: 'note', icon: '📝', label: 'Note' },
  { value: 'place', icon: '📍', label: 'Place' },
  { value: 'recipe', icon: '🍽️', label: 'Recipe' },
  { value: 'cocktail', icon: '🍸', label: 'Drink' },
] as const;
type ShareKind = (typeof KINDS_OF_NOTE)[number]['value'];
/** The built-in space each kind lives in. */
const KIND_SPACE = { place: 'places', recipe: 'recipes', cocktail: 'cocktails' } as const;

function ShareForm({ shared, onDone, onCancel }: { shared: Shared; onDone: () => void; onCancel: () => void }) {
  const c = useColors();
  const { wilma } = useAuth();
  const draft = draftFromShared(shared);
  const fromMaps = placeFromShared(shared);
  const spaces = useLoad('spaces', () => wilma.listSpaces());
  // Favourite spaces first (D38), then the rest as before; a list that cannot be read changes nothing.
  const favourites = useLoad('favourites:share', () => loadFavourites((fn, args) => supabase.rpc(fn, args)));
  const firstSpaces = spaces.data ? favouriteSpaces(spaces.data, favourites.data ?? []) : [];
  const orderedSpaces = spaces.data
    ? [...firstSpaces, ...spaces.data.filter((s) => !firstSpaces.some((f) => f.id === s.id))]
    : null;
  const link = firstUrl(shared.text);
  const [titleLookup, setTitleLookup] = useState<'idle' | 'busy' | 'none'>('idle');
  const getTitle = async () => {
    if (!link) return;
    setTitleLookup('busy');
    const found = await fetchLinkTitle(link, fetch);
    // A title that looks like a password is never put in the note (CLAUDE.md rule 9).
    if (found && !findCredential(found)) {
      setTitle(found.slice(0, TITLE_MAX));
      setTitleLookup('idle');
    } else setTitleLookup('none');
  };
  const [mode, setMode] = useState<Mode>('new');
  const [title, setTitle] = useState(fromMaps ? fromMaps.name : draft.title);
  // A Maps share keeps its link in the place's map link, not in the note.
  const [body, setBody] = useState(fromMaps ? '' : draft.body);
  // What it is: a built-in space decides (Places, Recipes, Cocktails); otherwise the one picked.
  const [chosen, setChosen] = useState<ShareKind>(fromMaps ? 'place' : 'note');
  const builtInSpace = (id: ShareKind) =>
    id === 'note' ? undefined : spaces.data?.find((x) => x.built_in === KIND_SPACE[id] && !x.restricted && !x.path.includes('/'))?.id;
  // Where it goes: the one picked, else a Maps share's Places.
  const [picked, setPicked] = useState<string | undefined>();
  const space = picked ?? (fromMaps ? builtInSpace('place') : undefined);
  const spaceKind = builtInOf(spaces.data?.find((x) => x.id === space), spaces.data ?? []);
  const kind: ShareKind =
    spaceKind === 'places' ? 'place' : spaceKind === 'recipes' ? 'recipe' : spaceKind === 'cocktails' ? 'cocktail' : chosen;
  const isPlace = kind === 'place';
  const shareType = kind === 'recipe' || kind === 'cocktail' ? kind : null;
  const setSpace = setPicked;
  // "Find it on the map" for a place shared from anywhere but Google Maps.
  const [finding, setFinding] = useState(false);
  const [googlePlaceId, setGooglePlaceId] = useState<string | undefined>(undefined);
  const pickKind = (v: ShareKind) => {
    setChosen(v);
    if (v === 'note') {
      // Back to a plain note: out of a built-in space, and the shared text (the Maps link) into the note.
      if (spaceKind) setPicked(undefined);
      if (!body.trim()) setBody(draft.body);
      return;
    }
    if (spaceKind !== KIND_SPACE[v]) setPicked(builtInSpace(v));
  };
  const found = (p: FoundPlace) => {
    // The name found replaces a shared title (often a link's words); the note keeps the shared text.
    if (p.name) setTitle(p.name.slice(0, TITLE_MAX));
    setPlace((f) => ({ ...f, address: p.address || f.address, kind: p.kind ?? f.kind, coords: p.coords ?? f.coords }));
    setGooglePlaceId(p.googlePlaceId);
    setFinding(false);
  };
  const [place, setPlace] = useState<PlaceForm>(
    fromMaps ? { ...EMPTY_PLACE, mapsUrl: fromMaps.mapsUrl, address: fromMaps.address } : EMPTY_PLACE,
  );
  const [noteId, setNoteId] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [preparing, setPreparing] = useState(shared.files.length > 0);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once a new note exists, so a retry after a failed upload does not create a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const copies = useRef<string[]>([]);

  // Copy and check the shared files once; delete the copies when the screen closes.
  useEffect(() => {
    let current = true;
    if (shared.files.length) {
      prepareShared(shared.files).then(
        (out) => {
          copies.current = out.cleanup;
          if (!current) return removeCopies(out.cleanup);
          setFiles(out.files);
          setProblems(out.errors);
          setPreparing(false);
        },
        (e: unknown) => {
          if (!current) return;
          setProblems([e instanceof Error ? e.message : String(e)]);
          setPreparing(false);
        },
      );
    }
    return () => {
      current = false;
      removeCopies(copies.current);
    };
  }, [shared]);

  const hasText = !!shared.text;
  const canAddToNote = shared.files.length > 0;

  const save = async () => {
    setError(null);
    let target: SaveTarget;
    if (createdId) target = { itemId: createdId };
    else if (mode === 'existing') {
      if (!noteId) return setError('Choose the note to add the files to.');
      if (!files.length) return setError('None of the shared files can be added.');
      target = { itemId: noteId };
    } else {
      if (!space) return setError('Choose a space.');
      if (!title.trim()) return setError(isPlace ? 'Give the place a name.' : 'Give the note a title.');
      if (isPlace) {
        const fields = placeMetadata(place, googlePlaceId ? { google_place_id: googlePlaceId } : null);
        if ('error' in fields) return setError(fields.error);
        target = { space, title: title.trim(), body, place: fields.metadata };
      } else if (shareType) target = { space, title: title.trim(), body, recipe: { type: shareType, metadata: sharedRecipe(link) } };
      else target = { space, title: title.trim(), body };
    }
    setBusy(true);
    let savedId = createdId;
    try {
      const out = await saveNote(wilma, target, files, deviceUploadDeps, {
        onCreated: (id) => {
          if (mode === 'new') {
            savedId = id;
            setCreatedId(id);
          }
        },
        onStatus: setStatus,
      });
      if (out.failed.length) {
        setFiles(files.filter((f) => out.failed.every((line) => !line.startsWith(`${f.name}: `))));
        throw new Error(`Not uploaded: ${out.failed.join('; ')}.`);
      }
      router.replace({ pathname: '/item/[id]', params: { id: out.itemId } });
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(savedId ? `${message} The note is saved; press Save to try the files again, or open it.` : message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const locked = busy || !!createdId;
  const label = (t: string) => <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{t}</Text>;
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {canAddToNote ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ModeButton title="New note" on={mode === 'new'} onPress={() => setMode('new')} disabled={locked} />
            <ModeButton title="Add to a note" on={mode === 'existing'} onPress={() => setMode('existing')} disabled={locked} />
          </View>
        ) : null}

        {mode === 'new' && !shared.files.length ? (
          <>
            {label('WHAT IS IT?')}
            <KindBar options={KINDS_OF_NOTE} selected={kind} onPress={pickKind} disabled={locked} />
          </>
        ) : null}
        {label(mode === 'new' ? 'WHERE DOES IT GO?' : 'SPACE')}
        <SpaceChips
          spaces={orderedSpaces}
          error={spaces.error}
          onRetry={spaces.reload}
          value={space}
          onChange={(id) => {
            setSpace(id);
            setNoteId(null);
          }}
          disabled={locked}
        />

        {mode === 'new' ? (
          <>
            <TextInput
              style={input}
              placeholder={isPlace ? 'Name of the place' : 'Title'}
              placeholderTextColor={c.muted}
              maxLength={TITLE_MAX}
              value={title}
              onChangeText={setTitle}
              editable={!locked}
            />
            {link && !isPlace && !fromMaps ? (
              titleLookup === 'busy' ? (
                <Muted>Getting the page’s title…</Muted>
              ) : (
                <View style={{ gap: 4 }}>
                  <TextLink title="Get title from the link" onPress={() => void getTitle()} />
                  {titleLookup === 'none' ? <Muted>That page did not give a title. Type one instead.</Muted> : null}
                </View>
              )
            ) : null}
            {fromMaps ? (
              <PlaceLookup
                name={fromMaps.name}
                address={fromMaps.address}
                hidden={!isPlace || !!place.coords || locked}
                onYes={(coords) => setPlace((current) => ({ ...current, coords }))}
              />
            ) : null}
            {isPlace && !fromMaps && !locked ? (
              finding ? (
                <FindOnMap start={/^https?:\/\//i.test(title.trim()) ? '' : title} onFound={found} onHand={() => setFinding(false)} disabled={busy} />
              ) : (
                <Button title={place.coords ? '🔎 Find it on the map again' : '🔎 Find it on the map'} kind="plain" onPress={() => setFinding(true)} />
              )
            ) : null}
            {isPlace && !finding ? <PlaceFields value={place} onChange={setPlace} disabled={locked} /> : null}
            {shareType ? (
              <Muted>
                {`Saved as a ${shareType === 'cocktail' ? '🍸 cocktail' : '🍽️ recipe'}${link ? ' with its link' : ''}. Add the ingredients and steps later with Edit note, or tap Fill in the recipe there.`}
              </Muted>
            ) : null}
            <TextInput
              style={[input, { minHeight: 120, textAlignVertical: 'top' }]}
              placeholder={isPlace ? 'Note (optional), e.g. try the fattoush' : 'Note (optional)'}
              placeholderTextColor={c.muted}
              multiline
              maxLength={40000}
              value={body}
              onChangeText={setBody}
              editable={!locked}
            />
            <Muted>Passwords and other secrets belong in the vault, not in notes.</Muted>
          </>
        ) : space ? (
          <NotePicker space={space} value={noteId} onChange={setNoteId} disabled={busy} />
        ) : (
          <Muted>Choose a space to see its notes.</Muted>
        )}
        {mode === 'existing' && hasText ? <Muted>The shared text is not added to the note; put what matters in a caption.</Muted> : null}

        {shared.files.length ? (
          <>
            <Text style={[styles.title, { color: c.text }]}>Photos and files</Text>
            {preparing ? <Loading /> : <AttachmentPicker files={files} onChange={setFiles} disabled={busy} />}
            {problems.map((p) => (
              <Text key={p} style={{ color: c.danger, fontSize: 15 }}>
                {p}
              </Text>
            ))}
          </>
        ) : null}

        {error ? (
          <Card>
            <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text>
            {createdId ? (
              <Button
                title="Open the note"
                kind="plain"
                onPress={() => {
                  router.replace({ pathname: '/item/[id]', params: { id: createdId } });
                  onDone();
                }}
              />
            ) : null}
          </Card>
        ) : null}
        {status ? <Muted>{status}</Muted> : null}
        <Button
          title={busy ? 'Saving…' : files.length ? `Save with ${files.length} file${files.length > 1 ? 's' : ''}` : 'Save'}
          onPress={save}
          disabled={busy || preparing}
        />
        <Button title="Cancel" kind="plain" onPress={onCancel} disabled={busy} />
      </ScrollView>
    </KeyboardScreen>
  );
}

function ModeButton({ title, on, onPress, disabled }: { title: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Button title={title} kind={on ? 'primary' : 'plain'} onPress={onPress} disabled={disabled} />
    </View>
  );
}

/** The most recently updated notes of a space, to pick one (filter by title). */
function NotePicker({ space, value, onChange, disabled }: { space: string; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const c = useColors();
  const { wilma } = useAuth();
  const notes = useLoad(`space:${space}`, () => wilma.search({ space, limit: 50 }));
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const shown = (notes.data ?? []).filter((n) => !f || n.title.toLowerCase().includes(f));
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
        placeholder="Filter by title"
        placeholderTextColor={c.muted}
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
      />
      {notes.error ? <ErrorBox message={notes.error} onRetry={notes.reload} /> : null}
      {notes.loading && !notes.data ? <Loading /> : null}
      {notes.data && !shown.length ? <Muted>{f ? 'No note with that title.' : 'No notes in this space yet.'}</Muted> : null}
      {shown.map((n) => {
        const on = n.id === value;
        return (
          <Pressable
            key={n.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            disabled={disabled}
            onPress={() => onChange(n.id)}
            style={[styles.card, { borderColor: on ? c.accent : c.line, backgroundColor: c.card, borderWidth: on ? 2 : 1 }]}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {n.title}
            </Text>
            {n.space ? <Muted>{n.space}</Muted> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
