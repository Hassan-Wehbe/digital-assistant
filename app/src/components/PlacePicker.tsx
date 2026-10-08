// Picking a place for My day (day planner step 4; mockups screen 5): "Where do you leave from?"
// (Home) and "📍 Where is this?" (an event without a place). Three ways: a saved place (found by
// name among the user's notes), a typed address (the phone's own map lookup, as "Is this it?":
// only the typed words are looked up, never where the phone is), or, for Home only, where the
// phone is now (one reading, on the tap). Nothing is kept here: the caller saves the choice.
import { useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { savedSpots, type PickedSpot } from '@/lib/homePlace';
import { deviceGeocoder, deviceLocation, whereAmI } from '@/lib/location';
import { lookUpPlace } from '@/lib/placeLookup';

import { Button, Card, Muted, space, styles, useColors } from './ui';

type Step =
  | { step: 'menu' }
  | { step: 'saved'; query: string; busy: boolean; results: PickedSpot[] | null; error?: string }
  | { step: 'address'; query: string; busy: boolean; found?: PickedSpot; error?: string }
  | { step: 'here'; error?: string };

export function PlacePicker({
  title,
  intro,
  allowHere,
  startText = '',
  onPick,
  onCancel,
  extra,
}: {
  title: string;
  intro?: string;
  /** Offer "Use where I am now" (Home). */
  allowHere?: boolean;
  /** Prefills the search and the address (an event's location text). */
  startText?: string;
  onPick: (spot: PickedSpot) => void;
  onCancel?: () => void;
  /** More buttons under the three ways (Not a trip). */
  extra?: ReactNode;
}) {
  const c = useColors();
  const { wilma } = useAuth();
  const [s, setS] = useState<Step>({ step: 'menu' });

  // Saved places with a location: the newest ones, or those matching the words typed.
  const searchSaved = async (query: string) => {
    setS({ step: 'saved', query, busy: true, results: null });
    try {
      const results = savedSpots(await wilma.search({ ...(query.trim() ? { query: query.trim() } : {}), item_type: 'place', limit: 25 }));
      setS({ step: 'saved', query, busy: false, results });
    } catch (e) {
      setS({ step: 'saved', query, busy: false, results: null, error: e instanceof Error ? e.message : 'Could not search.' });
    }
  };

  const findAddress = async (query: string) => {
    if (!query.trim()) return;
    setS({ step: 'address', query, busy: true });
    const out = await lookUpPlace(deviceGeocoder, query.trim(), true);
    if ('found' in out) {
      setS({ step: 'address', query, busy: false, found: { ...out.found, label: query.trim(), address: out.where ?? query.trim() } });
    } else if ('permission' in out) {
      setS({
        step: 'address', query, busy: false,
        error: 'Your phone’s map lookup needs Wilma to have the location permission: phone Settings → Apps → Wilma → Permissions → Location → “Allow only while using the app”. Only the typed words are looked up.',
      });
    } else setS({ step: 'address', query, busy: false, error: 'Not found on the map. Try adding the street and town.' });
  };

  const useHere = async () => {
    setS({ step: 'here' });
    const out = await whereAmI(deviceLocation);
    if ('here' in out) onPick({ lat: out.here.lat, lng: out.here.lng, label: 'Home' });
    else setS({ step: 'here', error: out.error });
  };

  const input = (value: string, onChange: (t: string) => void, placeholder: string, onSubmit: () => void) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      onSubmitEditing={onSubmit}
      returnKeyType="search"
      autoFocus
      style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
    />
  );

  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {intro ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{intro}</Text> : null}

      {s.step === 'menu' ? (
        <View style={{ gap: space.s }}>
          <Button title="Pick a saved place" kind="plain" onPress={() => void searchSaved(startText)} />
          <Button title="Type an address" kind="plain" onPress={() => setS({ step: 'address', query: startText, busy: false })} />
          {allowHere ? <Button title="Use where I am now" kind="plain" onPress={useHere} /> : null}
          {extra}
          {onCancel ? <Button title="Not now" kind="plain" onPress={onCancel} /> : null}
        </View>
      ) : null}

      {s.step === 'saved' ? (
        <View style={{ gap: space.s }}>
          {input(s.query, (q) => setS({ ...s, query: q }), 'A saved place’s name', () => void searchSaved(s.query))}
          <Button title={s.busy ? 'Searching…' : 'Search my places'} onPress={() => void searchSaved(s.query)} disabled={s.busy} />
          {s.error ? <Text style={{ color: c.danger, fontSize: 15 }}>{s.error}</Text> : null}
          {s.results && !s.results.length ? <Muted>No saved place with a location matches. Try another name, or type an address.</Muted> : null}
          {s.results?.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => onPick(p)} style={({ pressed }) => [{ paddingVertical: space.xs }, pressed && { opacity: 0.6 }]}>
              <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{p.label}</Text>
              {p.address ? <Muted>{p.address}</Muted> : null}
            </Pressable>
          ))}
          <Button title="Back" kind="plain" onPress={() => setS({ step: 'menu' })} />
        </View>
      ) : null}

      {s.step === 'address' ? (
        <View style={{ gap: space.s }}>
          {input(s.query, (q) => setS({ step: 'address', query: q, busy: false }), 'Street, town', () => void findAddress(s.query))}
          {s.found ? (
            <>
              <Text style={{ color: c.text, fontSize: 15 }}>📍 Found at: {s.found.address}</Text>
              <Button title="Use this place" onPress={() => s.found && onPick(s.found)} />
            </>
          ) : (
            <Button title={s.busy ? 'Looking…' : 'Find it'} onPress={() => void findAddress(s.query)} disabled={s.busy || !s.query.trim()} />
          )}
          {s.error ? <Muted>{s.error}</Muted> : null}
          <Button title="Back" kind="plain" onPress={() => setS({ step: 'menu' })} />
        </View>
      ) : null}

      {s.step === 'here' ? (
        <View style={{ gap: space.s }}>
          {s.error ? <Muted>{s.error}</Muted> : <Muted>Finding where you are…</Muted>}
          {s.error ? <Button title="Back" kind="plain" onPress={() => setS({ step: 'menu' })} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
