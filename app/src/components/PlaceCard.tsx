// A place's fields on its note, with Open in Maps (the saved location, else the Google Maps link or
// a search for the address; lib/places.ts mapsLink)
// and We went again (a visit added through update_item's add_visit; the server checks it).
import { useState } from 'react';
import { Linking, Text, TextInput } from 'react-native';

import { useAuth } from '@/lib/auth';
import { editError } from '@/lib/noteEdit';
import { coordsText } from '@/lib/location';
import { localDate, mapsLink, OCCASION_LABELS, placeLine, visitArgs, type PlaceMetadata, type VisitForm } from '@/lib/places';

import { Chips } from './PlaceFields';
import { Button, Card, Muted, styles, useColors } from './ui';

const STARS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) }));
const SHOWN_VISITS = 5;

export function PlaceCard({ itemId, place: p, onChanged }: { itemId: string; place: PlaceMetadata; onChanged: () => void }) {
  const c = useColors();
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const link = mapsLink(p);

  const openMaps = async () => {
    if (!link) return;
    setProblem(null);
    try {
      await Linking.openURL(link);
    } catch {
      setProblem('Could not open Google Maps on this phone.');
    }
  };

  const line = (label: string, value: string | undefined | null) =>
    value ? (
      <Text style={[styles.body, { color: c.text }]} selectable>
        <Text style={{ fontWeight: '600' }}>{label}: </Text>
        {value}
      </Text>
    ) : null;

  const visits = p.visits ?? [];
  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>📍 {placeLine(p)}</Text>
      {line('Address', p.address)}
      {typeof p.lat === 'number' && typeof p.lng === 'number' ? line('Saved location', coordsText({ lat: p.lat, lng: p.lng })) : null}
      {line('Dishes', p.dishes_liked?.join(', '))}
      {line('Good for', p.occasions?.map((o) => OCCASION_LABELS[o] ?? o).join(', '))}
      {p.would_return !== undefined ? <Muted>{p.would_return ? 'Would go back' : 'Would not go back'}</Muted> : null}
      {visits.length ? (
        <>
          <Text style={[styles.title, { color: c.text, fontSize: 15 }]}>Visits</Text>
          {visits.slice(0, SHOWN_VISITS).map((v, i) => (
            <Text key={`${v.on}-${i}`} style={{ color: c.text, fontSize: 15, lineHeight: 22 }} selectable>
              {v.on}
              {v.with ? ` with ${v.with}` : ''}
              {v.note ? `: ${v.note}` : ''}
            </Text>
          ))}
          {visits.length > SHOWN_VISITS ? <Muted>and {visits.length - SHOWN_VISITS} earlier</Muted> : null}
        </>
      ) : p.visited_on ? (
        <Muted>Last visit {p.visited_on}</Muted>
      ) : null}
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
      {link ? <Button title="Open in Maps" onPress={openMaps} /> : <Muted>Add an address, a Google Maps link or your location (Edit note) to open it in Maps.</Muted>}
      {adding ? (
        <VisitFormCard
          itemId={itemId}
          rating={p.rating ?? null}
          onDone={(saved) => {
            setAdding(false);
            if (saved) onChanged();
          }}
        />
      ) : (
        <Button title="We went again" kind="plain" onPress={() => setAdding(true)} />
      )}
    </Card>
  );
}

function VisitFormCard({ itemId, rating, onDone }: { itemId: string; rating: number | null; onDone: (saved: boolean) => void }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [form, setForm] = useState<VisitForm>({ on: localDate(), with: '', note: '', rating: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<VisitForm>) => setForm({ ...form, ...change });

  const save = async () => {
    const out = visitArgs(form);
    if ('error' in out) return setError(out.error);
    setBusy(true);
    setError(null);
    try {
      await wilma.addVisit(itemId, out.visit);
      onDone(true);
    } catch (e) {
      setError(editError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }];
  return (
    <>
      <Text style={[styles.title, { color: c.text, fontSize: 15 }]}>A new visit</Text>
      <TextInput
        style={input}
        placeholder="Date, e.g. 2026-10-12"
        placeholderTextColor={c.muted}
        maxLength={10}
        value={form.on}
        onChangeText={(on) => set({ on })}
        editable={!busy}
      />
      <TextInput
        style={input}
        placeholder="With (optional)"
        placeholderTextColor={c.muted}
        maxLength={100}
        value={form.with}
        onChangeText={(w) => set({ with: w })}
        editable={!busy}
      />
      <TextInput
        style={input}
        placeholder="One line about it (optional)"
        placeholderTextColor={c.muted}
        maxLength={300}
        value={form.note}
        onChangeText={(note) => set({ note })}
        editable={!busy}
      />
      <Muted>{rating ? `Rating now ★${rating}. Tap to change it (optional):` : 'Rating (optional):'}</Muted>
      <Chips
        options={STARS}
        selected={(n) => form.rating === n}
        onPress={(n) => set({ rating: form.rating === n ? null : n })}
        disabled={busy}
      />
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      <Button title={busy ? 'Saving…' : 'Add the visit'} onPress={save} disabled={busy} />
      <Button title="Cancel" kind="plain" onPress={() => onDone(false)} disabled={busy} />
    </>
  );
}
