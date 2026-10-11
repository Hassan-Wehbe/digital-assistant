// Settings → Homes (homes, design D36, docs/my-places-plan.md step 3; Q1: "Homes", not "My
// places", which would clash with Places). The places a day is planned from, from the home_place
// table as the signed-in user (RLS): "🏠 Home ★ · 12 Oak St, Oviedo" first, then the others.
//
// Tap one to change its name or its address (typed and found with the phone's map lookup, a saved
// place, or Use where I am: one reading, on the tap), to Make default (set_default_home, the only
// way the ★ moves), or to Delete (asked first; a home is a setting, so it is gone for good, Q6).
// Add a home sits at the bottom. Text that looks like a password is refused before anything is
// sent (rule 9). Homes are never searched, shared or kept as notes.
import { useState } from 'react';
import { Linking, ScrollView, Text, TextInput, View } from 'react-native';

import { PlacePicker } from '@/components/PlacePicker';
import { Button, Card, confirm, GroupList, GroupRow, Muted, space, styles, TextLink, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  addHome, changeHome, CREDENTIAL_TEXT, deleteHome, HOME_TITLE, listHomes, makeDefault, MAX_HOMES, MAX_LABEL, NOT_SAVED, spotAddress,
  type HomeRow, type HomesDb, type PickedSpot,
} from '@/lib/homePlace';
import { findCredential } from '@/lib/credentials';
import { mapsLink } from '@/lib/places';
import { supabase } from '@/lib/supabase';

type Editing =
  | { step: 'none' }
  | { step: 'home'; id: string; name: string; picking: boolean }
  | { step: 'add'; name: string; picking: boolean };

export default function Homes() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const db = supabase as unknown as HomesDb;
  const homes = useLoad(`homes:${userId}`, () => listHomes(db));
  useReloadOnReturn(homes.reload);
  const [editing, setEditing] = useState<Editing>({ step: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const list = homes.data ?? [];
  const open = editing.step === 'home' ? list.find((h) => h.id === editing.id) : undefined;

  const start = (next: Editing) => {
    setError(null);
    setDone(null);
    setEditing(next);
  };

  /** Runs one change; on success the list is read again and `after` is shown. */
  const run = async (work: () => Promise<{ error: string } | { ok: true }>, after: string, close = true) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const out = await work();
    setBusy(false);
    if ('error' in out) {
      setError(out.error);
      return;
    }
    setDone(after);
    if (close) setEditing({ step: 'none' });
    homes.reload();
  };

  const ok = (r: { error: string } | object) => ('error' in r ? (r as { error: string }) : { ok: true as const });

  const rename = (home: HomeRow, name: string) =>
    run(async () => ok(await changeHome(db, home, { label: name })), `Renamed to “${name.trim()}”.`);

  const moveTo = (home: HomeRow, spot: PickedSpot) =>
    run(async () => ok(await changeHome(db, home, { address: spotAddress(spot), lat: spot.lat, lng: spot.lng })), `“${home.label}” has its new address.`);

  const add = (name: string, spot: PickedSpot) =>
    run(async () => ok(await addHome(db, { label: name, address: spotAddress(spot), lat: spot.lat, lng: spot.lng })), `“${name.trim()}” was added.`);

  const star = (home: HomeRow) =>
    run(async () => ((await makeDefault(db, home.id)) ? { ok: true } : { error: NOT_SAVED }), `“${home.label}” is now your default home.`);

  const remove = async (home: HomeRow) => {
    const next = list.find((h) => h.id !== home.id);
    const passes = home.is_default && next ? ` Your default becomes the oldest home left${list.length === 2 ? `, “${next.label}”` : ''}.` : '';
    if (!(await confirm(`Delete “${home.label}”?`, `It is gone for good: homes are settings, not notes, so there is no Recycle bin.${passes}`, 'Delete'))) return;
    await run(async () => ((await deleteHome(db, home.id)) ? { ok: true } : { error: NOT_SAVED }), `“${home.label}” was deleted.`);
  };

  const nameInput = (value: string, onChange: (t: string) => void) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Home, Mom’s, Work…"
      placeholderTextColor={c.muted}
      maxLength={MAX_LABEL}
      autoCapitalize="words"
      accessibilityLabel="The home’s name"
      style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }]}
    />
  );

  const heading = (title: string) => <Text style={[styles.title, { color: c.text }]}>{title}</Text>;

  let editor = null;
  if (open && editing.step === 'home') {
    const link = mapsLink({ lat: open.lat, lng: open.lng });
    editor = editing.picking ? (
      <PlacePicker
        title={`Where is “${open.label}”?`}
        startText={open.address ?? ''}
        allowHere
        onPick={(spot) => void moveTo(open, spot)}
        onCancel={() => setEditing({ ...editing, picking: false })}
      />
    ) : (
      <Card>
        <Text style={[styles.title, { color: c.text }]}>{`🏠 ${open.label}${open.is_default ? ' ★' : ''}`}</Text>
        <Muted>Name</Muted>
        {nameInput(editing.name, (name) => setEditing({ ...editing, name }))}
        {editing.name.trim() !== open.label ? (
          <Button title={busy ? 'Saving…' : 'Save name'} disabled={busy || !editing.name.trim()} onPress={() => void rename(open, editing.name)} />
        ) : null}
        <Muted>Address</Muted>
        <Text style={{ color: c.text, fontSize: 16 }}>{open.address ?? 'Set from where you were (no address)'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m }}>
          {link ? <TextLink title="Check on Maps" onPress={() => void Linking.openURL(link).catch(() => {})} /> : null}
          <TextLink title="Change address" onPress={() => setEditing({ ...editing, picking: true })} />
        </View>
        {open.is_default ? (
          <Muted>★ Your default: Wilma plans your days from here unless you pick another in My day.</Muted>
        ) : (
          <Button title="Make default" kind="plain" disabled={busy} onPress={() => void star(open)} />
        )}
        <Button title="Delete" kind="danger" disabled={busy} onPress={() => void remove(open)} />
        <Button title="Done" kind="plain" onPress={() => start({ step: 'none' })} />
      </Card>
    );
  } else if (editing.step === 'add') {
    editor = (
      <Card>
        <Text style={[styles.title, { color: c.text }]}>Add a home</Text>
        <Muted>Name</Muted>
        {nameInput(editing.name, (name) => setEditing({ ...editing, name }))}
        {editing.picking ? (
          <PlacePicker
            title={`Where is “${editing.name.trim()}”?`}
            allowHere
            onPick={(spot) => void add(editing.name, spot)}
            onCancel={() => setEditing({ ...editing, picking: false })}
          />
        ) : (
          <>
            <Button
              title="Next: where is it?"
              disabled={!editing.name.trim()}
              onPress={() => {
                // Refused here already, before the address is asked (rule 9).
                if (findCredential(editing.name)) return setError(CREDENTIAL_TEXT);
                setError(null);
                setEditing({ ...editing, picking: true });
              }}
            />
            <Button title="Cancel" kind="plain" onPress={() => start({ step: 'none' })} />
          </>
        )}
      </Card>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.list, { gap: space.l }]} keyboardShouldPersistTaps="handled">
      {heading('Homes')}
      <Muted>Where Wilma plans your days from: drive times and leave-by times start at your default home (★). In My day, Change picks another for that day.</Muted>
      {homes.data === null && !homes.loading ? (
        <Card>
          <Muted>{homes.error ?? 'Your homes cannot be read right now.'}</Muted>
          <Button title="Try again" kind="plain" onPress={homes.reload} />
        </Card>
      ) : null}
      {homes.data && list.length ? (
        <GroupList>
          {list.map((h, i) => (
            <GroupRow
              key={h.id}
              first={i === 0}
              title={`🏠 ${h.label}${h.is_default ? ' ★' : ''}`}
              subtitle={h.address ?? 'Set from where you were'}
              onPress={() => start({ step: 'home', id: h.id, name: h.label, picking: false })}
            />
          ))}
        </GroupList>
      ) : null}
      {homes.data && !list.length ? <Muted>No homes yet. Add the place you usually leave from.</Muted> : null}
      {homes.loading && !homes.data ? <Muted>Reading your homes…</Muted> : null}
      {done ? <Text style={{ color: c.good, fontSize: 15 }}>{done}</Text> : null}
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      {editor}
      {homes.data && editing.step === 'none' ? (
        list.length >= MAX_HOMES ? (
          <Muted>{`You have ${MAX_HOMES} homes, the most there can be. Delete one to add another.`}</Muted>
        ) : (
          <Button title="＋ Add a home" kind="plain" onPress={() => start({ step: 'add', name: list.length ? '' : HOME_TITLE, picking: false })} />
        )
      ) : null}
      <Muted>Homes are kept with your account, never searched or shared. A deleted home is gone for good.</Muted>
    </ScrollView>
  );
}
