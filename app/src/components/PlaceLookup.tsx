// "Is this it?" on the share screen (job 4, lib/placeLookup.ts): a place shared from Google Maps
// is looked up by its name and address with the phone's map lookup, never by where the phone is.
// Open in Maps shows the point found; only Yes hands it to the form. No, or nothing found: the
// place is saved without a location, as before.
import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { deviceGeocoder } from '@/lib/location';
import { lookUpPlace, lookupQuery, type LookupResult } from '@/lib/placeLookup';
import { mapsLink } from '@/lib/places';

import { Button, Card, Muted, TextLink, useColors } from './ui';

type State = { step: 'looking' | 'yes' | 'no' } | LookupResult;

export function PlaceLookup({
  name,
  address,
  hidden,
  onYes,
}: {
  /** The place as shared (looked up once, when the form opens). */
  name: string;
  address: string;
  /** Kept mounted while hidden, so going to "Note" and back does not look it up again. */
  hidden: boolean;
  onYes: (coords: { lat: number; lng: number }) => void;
}) {
  const c = useColors();
  const [query] = useState(() => lookupQuery(name, address));
  const [state, setState] = useState<State>(query ? { step: 'looking' } : { none: true });
  const alive = useRef(true);

  const lookUp = (ask: boolean) => (query ? lookUpPlace(deviceGeocoder, query, ask).then((out) => alive.current && setState(out)) : undefined);

  // Once, as the form opens: only checks the permission, never asks for it.
  useEffect(() => {
    alive.current = true;
    lookUp(false);
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden || !query || ('step' in state && state.step === 'yes')) return null;
  if ('step' in state && state.step === 'no') return <Muted>OK, it is saved without a location.</Muted>;
  if ('step' in state) return <Muted>Looking for {query} on the map…</Muted>;
  if ('none' in state) return <Muted>Not found on the map, so it is saved without a location.</Muted>;
  if ('permission' in state) {
    return (
      <View style={{ gap: 6 }}>
        {state.permission.canAsk ? (
          <Button
            title="🔎 Find it on the map"
            kind="plain"
            onPress={() => {
              setState({ step: 'looking' });
              lookUp(true);
            }}
          />
        ) : null}
        <Muted>
          {state.permission.canAsk
            ? 'Your phone’s map lookup needs Wilma to have the location permission. Only the name and address are looked up, never where you are.'
            : 'To find it on the map, allow location for Wilma: phone Settings → Apps → Wilma → Permissions → Location → “Allow only while using the app”. Only the name and address are looked up, never where you are.'}
        </Muted>
      </View>
    );
  }

  const point = state.found;
  const link = mapsLink(point);
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Is this it?</Text>
      <Text style={{ color: c.text, fontSize: 15 }}>{query}</Text>
      {link ? (
        <TextLink
          title="Open in Maps"
          accessibilityLabel={`Open the spot found for ${query} in Maps`}
          onPress={() => void Linking.openURL(link).catch(() => {})}
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Yes"
            onPress={() => {
              onYes(point);
              setState({ step: 'yes' });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="No" kind="plain" onPress={() => setState({ step: 'no' })} />
        </View>
      </View>
    </Card>
  );
}
