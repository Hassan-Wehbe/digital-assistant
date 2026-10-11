// The 🏠 card in the chat (homes, design D36, docs/my-places-plan.md step 3): Wilma's save_home
// shows "Save “Home”: 12 Oak St, Oviedo as a home". Nothing is saved until the user taps Save
// (or Save as default, offered only when a default already exists).
//
// The address is found with the phone's own map lookup, as My day does for event places: by
// itself only when the location permission is already given, else on "Find it on the map". Only
// the address words are looked up, never where the phone is. The card shows where it was found
// with a Maps link to check it. Without an address ("I'm home"), or when it is not found, "Use
// where I am" reads the location once, on the tap. The point goes only into the home_place row
// (as the user, RLS); the chat thread keeps only that the card was saved.
//
// Text that looks like a password or a code is never saved (the server refused it already;
// this is the phone's own check, rule 9).
import { useEffect, useState } from 'react';
import { Linking, Text } from 'react-native';

import { ChatCard, ChatCardDone, ChatCardText } from '@/components/ChatCard';
import { Button, Muted, TextLink, useColors } from '@/components/ui';
import type { Entry, HomeSaved } from '@/lib/chatThread';
import { findCredential } from '@/lib/credentials';
import { CREDENTIAL_TEXT, homeCardButtons, listHomes, saveHomeAt, type HomeRow, type HomesDb } from '@/lib/homePlace';
import { deviceGeocoder, deviceLocation, whereAmI } from '@/lib/location';
import { lookUpPlace } from '@/lib/placeLookup';
import { mapsLink } from '@/lib/places';
import { supabase } from '@/lib/supabase';

type HomeEntry = Extract<Entry, { kind: 'home' }>;

type Spot = { lat: number; lng: number; where: string | null; here: boolean };
type Finding = 'looking' | 'found' | 'permission' | 'none' | 'here';

const PERMISSION = 'Your phone’s map lookup needs Wilma to have the location permission. Only the address words are looked up.';

/** The card's words before it is saved: "Save “Home”: 12 Oak St, Oviedo as a home". */
export function homeCardTitle(entry: Pick<HomeEntry, 'label' | 'address'>): string {
  return `Save “${entry.label}”${entry.address ? `: ${entry.address}` : ''} as a home`;
}

/** The card once saved. */
export function homeSavedText(entry: Pick<HomeEntry, 'label' | 'address'>, saved: HomeSaved): string {
  return `Saved “${entry.label}”${entry.address ? `: ${entry.address}` : ''}${saved === 'default' ? ', your default home' : ''}. Change it in Settings → Homes.`;
}

export function HomeCard({ entry, onSaved }: { entry: HomeEntry; onSaved: (saved: HomeSaved) => void }) {
  const c = useColors();
  const db = supabase as unknown as HomesDb;
  const refused = !!findCredential(entry.label) || (!!entry.address && !!findCredential(entry.address));
  const open = !entry.saved && !refused;

  const [homes, setHomes] = useState<HomeRow[] | null | undefined>(undefined);
  const [finding, setFinding] = useState<Finding>(entry.address ? 'looking' : 'here');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async (ask: boolean) => {
    if (!entry.address) return;
    setFinding('looking');
    const out = await lookUpPlace(deviceGeocoder, entry.address, ask);
    if ('found' in out) {
      setSpot({ ...out.found, where: out.where, here: false });
      setFinding('found');
    } else setFinding('permission' in out ? 'permission' : 'none');
  };

  // Once, while the card waits: the user's homes (for the buttons) and, by itself only when the
  // permission is already given, the address on the map.
  useEffect(() => {
    if (!open) return;
    let live = true;
    listHomes(db)
      .then((h) => live && setHomes(h))
      .catch(() => live && setHomes(null));
    if (entry.address) {
      void lookUpPlace(deviceGeocoder, entry.address, false).then((out) => {
        if (!live) return;
        if ('found' in out) {
          setSpot({ ...out.found, where: out.where, here: false });
          setFinding('found');
        } else setFinding('permission' in out ? 'permission' : 'none');
      });
    }
    return () => {
      live = false;
    };
  }, [open, entry.address]); // eslint-disable-line react-hooks/exhaustive-deps

  if (refused) return <ChatCardDone icon="🏠" text={CREDENTIAL_TEXT} />;
  if (entry.saved) return <ChatCardDone icon="🏠" text={homeSavedText(entry, entry.saved)} />;

  const readHere = async () => {
    setError(null);
    setBusy(true);
    const out = await whereAmI(deviceLocation);
    setBusy(false);
    if ('here' in out) {
      setSpot({ lat: out.here.lat, lng: out.here.lng, where: null, here: true });
      setFinding('found');
    } else setError(out.error);
  };

  const save = async (asDefault: boolean) => {
    if (!spot || busy) return;
    setBusy(true);
    setError(null);
    const out = await saveHomeAt(db, { label: entry.label, address: entry.address, lat: spot.lat, lng: spot.lng }, { asDefault });
    setBusy(false);
    if ('error' in out) setError(out.error);
    else onSaved(out.home.is_default ? 'default' : 'home');
  };

  const { buttons, main, replaces } = homeCardButtons(homes ?? null, entry);
  const link = spot ? mapsLink({ lat: spot.lat, lng: spot.lng }) : null;
  const ready = !!spot && homes !== undefined && !busy;

  return (
    <ChatCard
      icon="🏠"
      actions={
        <>
          {buttons.includes('default') ? (
            <Button title="Save as default" kind={main === 'default' ? 'primary' : 'plain'} disabled={!ready} onPress={() => void save(true)} />
          ) : null}
          <Button title={busy && spot ? 'Saving…' : 'Save'} kind={main === 'save' ? 'primary' : 'plain'} disabled={!ready} onPress={() => void save(false)} />
        </>
      }>
      <ChatCardText>{homeCardTitle(entry)}</ChatCardText>
      {replaces ? <Muted>{`This changes where your home “${replaces.label}” is.`}</Muted> : null}
      {finding === 'looking' ? <Muted>Finding it on the map…</Muted> : null}
      {spot ? (
        <Text style={{ color: c.text, fontSize: 15 }}>
          {spot.here ? '📍 Where you are now' : `📍 Found at: ${spot.where ?? entry.address}`}
        </Text>
      ) : null}
      {link ? <TextLink title="Check on Maps" onPress={() => void Linking.openURL(link).catch(() => {})} /> : null}
      {finding === 'permission' ? (
        <>
          <Muted>{PERMISSION}</Muted>
          <Button title="Find it on the map" kind="plain" onPress={() => void find(true)} />
        </>
      ) : null}
      {finding === 'none' ? <Muted>Not found on the map. If you are there now, use where you are.</Muted> : null}
      {!spot?.here && (finding === 'here' || finding === 'none' || finding === 'permission') ? (
        <Button title={busy && !spot ? 'Finding where you are…' : 'Use where I am'} kind="plain" disabled={busy} onPress={() => void readHere()} />
      ) : null}
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
    </ChatCard>
  );
}
