// "Find it on the map" (docs/places-mockups.html section 1, layout A; D45 Q9): New place starts with
// one box. Typing a name ("coral gables lib") shows Google's suggestions (lib/placeSearch.ts); a
// full street address ("12 Elm St, Miami") goes straight to the phone's own map lookup, which is
// free. Picking one asks "Is this it?" with the spot the phone's lookup found for its address
// (lib/placeLookup.ts): only the name and address are looked up, never where the phone is. Yes
// fills the place; the spot is never saved without that Yes. When Google's search is not set up or
// resting for the day, the box still finds a full street address.
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { deviceGeocoder } from '@/lib/location';
import { lookUpPlace, lookupQuery, type LookupResult } from '@/lib/placeLookup';
import { kindIcon, mapsLink, type PlaceKind } from '@/lib/places';
import { looksLikeStreetAddress, MIN_LETTERS, newSearchSession, PAUSE_MS, type SearchAnswer, type Suggestion } from '@/lib/placeSearch';
import { WilmaError } from '@/lib/wilma';

import { Button, Card, Muted, space, styles, TextLink, useColors } from './ui';

export interface FoundPlace {
  name: string;
  address: string;
  kind?: PlaceKind;
  /** Null when the map lookup found nothing and the user saved it without a spot. */
  coords: { lat: number; lng: number } | null;
  googlePlaceId?: string;
}

type Picked = { name: string; address: string; kind?: PlaceKind; googlePlaceId?: string };
type Check = { step: 'looking' } | LookupResult;

export function FindOnMap({
  start = '',
  onFound,
  onHand,
  disabled,
}: {
  /** The name typed so far (New place's title), searched as the box opens. */
  start?: string;
  onFound: (place: FoundPlace) => void;
  /** "Fill it in by hand": the form, without a search. */
  onHand: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const { placeSearch } = useAuth();
  const [text, setText] = useState(start);
  // Each answer remembers the words it is for: one for older words is never shown.
  const [result, setResult] = useState<{ words: string; answer: SearchAnswer } | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  // One id per search (the typing and the pick), as Google counts a search.
  const session = useRef(newSearchSession());
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const words = text.trim();
  const byAddress = looksLikeStreetAddress(words);
  const wanted = !picked && words.length >= MIN_LETTERS && !byAddress;
  const answer = wanted && result?.words === words ? result.answer : null;
  const searching = wanted && !answer;

  // Google's suggestions after a short pause in typing (not for a full street address: that is free).
  useEffect(() => {
    if (!wanted) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      placeSearch
        .search(words, session.current, abort.signal)
        .then((out) => {
          if (!abort.signal.aborted && alive.current) setResult({ words, answer: out });
        })
        .catch((e) => {
          if (!abort.signal.aborted && alive.current) setEnded(e instanceof WilmaError ? e.message : 'Could not search.');
        });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [words, wanted, placeSearch]);

  const lookUp = async (p: Picked, ask: boolean) => {
    const query = lookupQuery(p.name, p.address);
    if (!query) return;
    setPicked(p);
    setCheck({ step: 'looking' });
    const out = await lookUpPlace(deviceGeocoder, query, ask);
    if (alive.current) setCheck(out);
  };

  const pick = (s: Suggestion) => void lookUp({ name: s.name, address: s.address, kind: s.kind, googlePlaceId: s.placeId }, true);
  const findAddress = () => void lookUp({ name: '', address: words }, true);
  const back = () => {
    setPicked(null);
    setCheck(null);
  };
  const done = (coords: FoundPlace['coords']) => {
    if (!picked) return;
    onFound({ ...picked, coords });
    // The next search is a new one.
    session.current = newSearchSession();
  };

  if (picked && check) {
    return <IsThisIt picked={picked} check={check} onYes={done} onBack={back} onAsk={() => void lookUp(picked, true)} disabled={disabled} />;
  }

  const unavailable = answer && 'unavailable' in answer ? answer.unavailable : null;
  const suggestions = answer && 'suggestions' in answer ? answer.suggestions : null;
  return (
    <View style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text, fontSize: 15 }]}>Find it on the map</Text>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          setEnded(null);
        }}
        placeholder="Name and town, or an address"
        placeholderTextColor={c.muted}
        accessibilityLabel="Find a place by name or address"
        autoFocus={!start}
        editable={!disabled}
        returnKeyType="search"
        onSubmitEditing={() => (byAddress || unavailable ? findAddress() : undefined)}
        style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }]}
      />
      {ended ? <Text style={{ color: c.danger, fontSize: 15 }}>{ended}</Text> : null}

      {byAddress ? <Button title="Find this address" onPress={findAddress} disabled={disabled} /> : null}
      {searching && !ended ? <Muted>Looking…</Muted> : null}
      {unavailable ? (
        <>
          <Muted>
            {unavailable === 'daily_limit'
              ? 'Searching by name is resting for today. A full street address still works:'
              : 'Searching by name is not switched on yet. A full street address works:'}
          </Muted>
          <Button title="Find this address" onPress={findAddress} disabled={disabled || words.length < MIN_LETTERS} />
        </>
      ) : null}
      {answer && 'problem' in answer ? (
        <Muted>{answer.problem === 'refused' ? answer.message : 'Could not reach the search. Check your connection, or type the full address.'}</Muted>
      ) : null}

      {suggestions?.map((s) => (
        <Pressable
          key={s.placeId}
          accessibilityRole="button"
          accessibilityLabel={`${s.name}, ${s.address}`}
          disabled={disabled}
          onPress={() => pick(s)}
          style={({ pressed }) => [
            { borderWidth: 1, borderColor: c.line, backgroundColor: c.card, borderRadius: 10, padding: space.s, gap: 2 },
            pressed && { opacity: 0.6 },
          ]}>
          <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>
            {kindIcon(s.kind)} {s.name}
          </Text>
          {s.address ? <Muted>{s.address}</Muted> : null}
        </Pressable>
      ))}
      {suggestions && !suggestions.length ? <Muted>Nothing found by that name. Try other words, or the full address.</Muted> : null}
      {/* Google's terms: its suggestions shown without a Google map say where they come from. */}
      {suggestions?.length ? <Text style={{ color: c.muted, fontSize: 12, textAlign: 'right' }}>powered by Google</Text> : null}

      <TextLink title="Fill it in by hand" onPress={onHand} />
    </View>
  );
}

/** "Is this it?": the spot the phone's lookup found for the picked place's address, Yes to keep it. */
function IsThisIt({
  picked,
  check,
  onYes,
  onBack,
  onAsk,
  disabled,
}: {
  picked: Picked;
  check: Check;
  onYes: (coords: FoundPlace['coords']) => void;
  onBack: () => void;
  onAsk: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const label = picked.name || picked.address;
  if ('step' in check) return <Muted>Looking for {label} on the map…</Muted>;
  if ('none' in check) {
    return (
      <Card style={{ gap: space.s }}>
        <Text style={{ color: c.text, fontSize: 15 }}>{label}: not found on the map.</Text>
        <Muted>It can be saved with its address only, and found on the map later.</Muted>
        <Button title="Save it without a spot" onPress={() => onYes(null)} disabled={disabled} />
        <Button title="Try again" kind="plain" onPress={onBack} disabled={disabled} />
      </Card>
    );
  }
  if ('permission' in check) {
    return (
      <Card style={{ gap: space.s }}>
        <Muted>
          {check.permission.canAsk
            ? 'Your phone’s map lookup needs Wilma to have the location permission. Only the name and address are looked up, never where you are.'
            : 'To find it on the map, allow location for Wilma: phone Settings → Apps → Wilma → Permissions → Location → “Allow only while using the app”. Only the name and address are looked up, never where you are.'}
        </Muted>
        {check.permission.canAsk ? <Button title="🔎 Find it on the map" onPress={onAsk} disabled={disabled} /> : null}
        <Button title="Save it without a spot" kind="plain" onPress={() => onYes(null)} disabled={disabled} />
        <Button title="Back" kind="plain" onPress={onBack} disabled={disabled} />
      </Card>
    );
  }
  const link = mapsLink(check.found);
  return (
    <Card style={{ gap: space.s }}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Is this it?</Text>
      {picked.name ? (
        <Text style={{ color: c.text, fontSize: 15 }}>
          {kindIcon(picked.kind)} {picked.name}
        </Text>
      ) : null}
      {check.where ? (
        <Text style={{ color: c.text, fontSize: 15 }}>📍 Found at: {check.where}</Text>
      ) : (
        <Muted>The map lookup did not say which street or town this is: check it with Open in Maps.</Muted>
      )}
      {link ? <TextLink title="Open in Maps" accessibilityLabel={`Open the spot found for ${label} in Maps`} onPress={() => void Linking.openURL(link).catch(() => {})} /> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <Button title="No, try again" kind="plain" onPress={onBack} disabled={disabled} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Yes" onPress={() => onYes(check.found)} disabled={disabled} />
        </View>
      </View>
    </Card>
  );
}
