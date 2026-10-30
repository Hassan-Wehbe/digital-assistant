// Picking a place: a task's "Where is it done?", My day's "Where do you leave from?" and "Where is
// this?", and a home's address in Settings → Homes (D36). Since D45 (docs/places-mockups.html
// section 4) it opens straight to one list: the user's homes first, then every saved place, those in
// Places first, with or without a spot on the map (a tester's place without one was invisible
// here). Typing filters by name, address and kind. A place with an address but no spot is looked up
// with the phone's own map lookup when picked ("Is this it?"; only the address is looked up, never
// where the phone is), and the spot can be kept on the place; one with neither opens so an address
// can be added. Under the list: a typed address, and, for Home, where the phone is now (one
// reading, on the tap). Nothing is kept here except that spot: the caller saves the choice.
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { filterRows, listHomes, pickRows, type HomesDb, type PickedSpot, type PickRow } from '@/lib/homePlace';
import { deviceGeocoder, deviceLocation, whereAmI } from '@/lib/location';
import { lookUpPlace, type LookupResult } from '@/lib/placeLookup';
import { kindIcon } from '@/lib/places';
import { supabase } from '@/lib/supabase';

import { Button, Card, Muted, space, styles, useColors, useLoad } from './ui';

type Step =
  | { step: 'list' }
  | { step: 'check'; row: Extract<PickRow, { row: 'lookup' }>; out: LookupResult | null; keep: boolean; saving?: boolean }
  | { step: 'address'; query: string; busy: boolean; found?: PickedSpot; error?: string }
  | { step: 'here'; error?: string };

const LOCATION_PERMISSION =
  'Your phone’s map lookup needs Wilma to have the location permission: phone Settings → Apps → Wilma → Permissions → Location → “Allow only while using the app”. Only the typed words are looked up.';

export function PlacePicker({
  title,
  intro,
  allowHere,
  startText = '',
  onPick,
  onCancel,
  extra,
  showHomes = true,
}: {
  title: string;
  intro?: string;
  /** Offer "Use where I am now" (homes). */
  allowHere?: boolean;
  /** Prefills "Type an address" (an event's location text, a home's address). */
  startText?: string;
  onPick: (spot: PickedSpot) => void;
  onCancel?: () => void;
  /** More buttons under the list (Not a trip). */
  extra?: ReactNode;
  /** List the user's homes first (not when picking where a home itself is). */
  showHomes?: boolean;
}) {
  const c = useColors();
  const { wilma } = useAuth();
  const [s, setS] = useState<Step>({ step: 'list' });
  const [words, setWords] = useState('');

  // Homes and every place, once (newest places first); a home list that can't be read is left out.
  const list = useLoad(`picker:${showHomes ? 'homes' : 'places'}`, async () => {
    const [homes, results, spaces] = await Promise.all([
      showHomes ? listHomes(supabase as unknown as HomesDb).catch(() => []) : Promise.resolve([]),
      wilma.search({ item_type: 'place', limit: 50 }),
      wilma.listSpaces().catch(() => []),
    ]);
    const places = spaces.find((x) => x.built_in === 'places')?.path;
    return pickRows(homes, results, places);
  });
  const rows = useMemo(() => filterRows(list.data ?? [], words), [list.data, words]);

  const choose = (r: PickRow) => {
    if (r.row === 'spot') onPick(r.spot);
    else if (r.row === 'lookup') {
      setS({ step: 'check', row: r, out: null, keep: true });
      void lookUpPlace(deviceGeocoder, r.address, true).then((out) => setS((cur) => (cur.step === 'check' && cur.row.id === r.id ? { ...cur, out } : cur)));
    } else router.push({ pathname: '/item/[id]', params: { id: r.id } });
  };

  // Yes on "Is this it?": the spot goes to the caller, and onto the place too when asked (best effort:
  // the pick works even if keeping it fails).
  const pickFound = async (step: Extract<Step, { step: 'check' }>, found: { lat: number; lng: number }) => {
    if (step.keep) {
      setS({ ...step, saving: true });
      try {
        const item = await wilma.getItem(step.row.id);
        const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
        await wilma.updateItem(step.row.id, { metadata: { ...meta, lat: found.lat, lng: found.lng } });
        void list.reload();
      } catch {
        // The place keeps no spot; the pick still counts.
      }
    }
    onPick({ id: step.row.id, lat: found.lat, lng: found.lng, label: step.row.label, address: step.row.address });
  };

  const findAddress = async (query: string) => {
    if (!query.trim()) return;
    setS({ step: 'address', query, busy: true });
    const out = await lookUpPlace(deviceGeocoder, query.trim(), true);
    if ('found' in out) {
      setS({ step: 'address', query, busy: false, found: { ...out.found, label: query.trim(), address: out.where ?? query.trim() } });
    } else if ('permission' in out) setS({ step: 'address', query, busy: false, error: LOCATION_PERMISSION });
    else setS({ step: 'address', query, busy: false, error: 'Not found on the map. Try adding the street and town.' });
  };

  const useHere = async () => {
    setS({ step: 'here' });
    const out = await whereAmI(deviceLocation);
    if ('here' in out) onPick({ lat: out.here.lat, lng: out.here.lng, label: 'Where I am', here: true });
    else setS({ step: 'here', error: out.error });
  };

  // The spot found for the place being checked, if any.
  const found = s.step === 'check' && s.out && 'found' in s.out ? s.out.found : null;

  const input = (value: string, onChange: (t: string) => void, placeholder: string, onSubmit?: () => void) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      onSubmitEditing={onSubmit}
      returnKeyType="search"
      style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
    />
  );

  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {intro ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{intro}</Text> : null}

      {s.step === 'list' ? (
        <View style={{ gap: space.s }}>
          {input(words, setWords, 'Name, address or kind')}
          {list.loading ? <Muted>Loading your places…</Muted> : null}
          {list.error ? <Text style={{ color: c.danger, fontSize: 15 }}>{list.error}</Text> : null}
          {list.data && !rows.length ? (
            <Muted>{words.trim() ? 'No saved place matches. Try other words, or type an address.' : 'No saved places yet. Type an address.'}</Muted>
          ) : null}
          {rows.map((r) => {
            const label = r.row === 'spot' ? r.spot.label : r.label;
            const sub =
              r.row === 'spot' ? r.spot.address : r.row === 'lookup' ? `${r.address} · found on the map when picked` : 'Add an address';
            return (
              <Pressable
                key={r.row === 'spot' ? `${r.home ? 'home' : 'place'}:${r.spot.id ?? r.spot.label}` : r.id}
                accessibilityRole="button"
                accessibilityLabel={`${label}${sub ? `, ${sub}` : ''}`}
                onPress={() => choose(r)}
                style={({ pressed }) => [{ paddingVertical: space.xs }, pressed && { opacity: 0.6 }]}>
                <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>
                  {kindIcon(r.kind)} {label}
                </Text>
                {sub ? <Text style={{ color: r.row === 'no_address' ? c.warn : c.muted, fontSize: 14 }}>{sub}</Text> : null}
              </Pressable>
            );
          })}
          <Button title="Type an address" kind="plain" onPress={() => setS({ step: 'address', query: startText, busy: false })} />
          {allowHere ? <Button title="Use where I am now" kind="plain" onPress={useHere} /> : null}
          {extra}
          {onCancel ? <Button title="Not now" kind="plain" onPress={onCancel} /> : null}
        </View>
      ) : null}

      {s.step === 'check' ? (
        <View style={{ gap: space.s }}>
          {!s.out ? <Muted>Looking for {s.row.address} on the map…</Muted> : null}
          {found ? (
            <>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Is this it?</Text>
              <Text style={{ color: c.text, fontSize: 15 }}>
                {kindIcon(s.row.kind)} {s.row.label}
              </Text>
              <Text style={{ color: c.text, fontSize: 15 }}>📍 Found at: {(s.out && 'found' in s.out ? s.out.where : null) ?? s.row.address}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <Switch value={s.keep} onValueChange={(keep) => setS({ ...s, keep })} accessibilityLabel="Keep this spot on the place" />
                <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>Keep this spot on the place</Text>
              </View>
              <Button title={s.saving ? 'Saving…' : 'Yes, use it'} onPress={() => void pickFound(s, found)} disabled={s.saving} />
            </>
          ) : null}
          {s.out && 'none' in s.out ? <Muted>{s.row.address}: not found on the map. Open the place to check its address, or type another.</Muted> : null}
          {s.out && 'permission' in s.out ? <Muted>{LOCATION_PERMISSION}</Muted> : null}
          {s.out && !('found' in s.out) ? (
            <Button title="Open the place" kind="plain" onPress={() => router.push({ pathname: '/item/[id]', params: { id: s.row.id } })} />
          ) : null}
          <Button title="Back" kind="plain" onPress={() => setS({ step: 'list' })} disabled={s.saving} />
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
          <Button title="Back" kind="plain" onPress={() => setS({ step: 'list' })} />
        </View>
      ) : null}

      {s.step === 'here' ? (
        <View style={{ gap: space.s }}>
          {s.error ? <Muted>{s.error}</Muted> : <Muted>Finding where you are…</Muted>}
          {s.error ? <Button title="Back" kind="plain" onPress={() => setS({ step: 'list' })} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
