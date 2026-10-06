// The place part of New note and Edit note (places.ts): address, Google Maps link, kind,
// cuisine, price, occasions, dishes, want to go / been there with a rating, would go back, and
// the spot from "Save where I am" (location.ts: one reading, only when tapped).
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { coordsText, deviceLocation, whereAmI } from '@/lib/location';
import {
  KIND_LABELS,
  MAX_ADDRESS,
  MAX_LINK,
  OCCASION_LABELS,
  OCCASIONS,
  PLACE_KINDS,
  type PlaceForm,
} from '@/lib/places';

import { Button, Muted, styles, useColors } from './ui';

/** A row of chips; `selected` says which are on. Tapping a chip calls onPress with its value. */
export function Chips<T extends string | number | boolean>({
  options,
  selected,
  onPress,
  disabled,
  multi,
}: {
  options: readonly { value: T; label: string }[];
  selected: (value: T) => boolean;
  onPress: (value: T) => void;
  disabled?: boolean;
  multi?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = selected(o.value);
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={multi ? { checked: on } : { selected: on }}
            accessibilityLabel={o.label}
            disabled={disabled}
            onPress={() => onPress(o.value)}
            style={{
              borderWidth: 1,
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderColor: on ? c.accent : c.line,
              backgroundColor: on ? c.accent : c.card,
            }}>
            <Text style={{ color: on ? '#ffffff' : c.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const KINDS = PLACE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));
const PRICES = [1, 2, 3, 4].map((n) => ({ value: n, label: '$'.repeat(n) }));
const STARS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) }));
const OCCASION_CHIPS = OCCASIONS.map((o) => ({ value: o, label: OCCASION_LABELS[o] }));
const STATUS = [
  { value: 'want' as const, label: 'Want to go' },
  { value: 'been' as const, label: 'Been there' },
];
const RETURN = [
  { value: true, label: 'Would go back' },
  { value: false, label: 'Would not go back' },
];

/** Tapping the chosen chip again clears it (kind, price, rating, would go back are optional). */
const toggle = <T,>(current: T | null, value: T): T | null => (current === value ? null : value);

export function PlaceFields({
  value: f,
  onChange,
  disabled,
  hasVisits,
  locateNow,
}: {
  value: PlaceForm;
  /** A state setter: changes merge into the latest form (the location arrives seconds later). */
  onChange: (update: (current: PlaceForm) => PlaceForm) => void;
  disabled?: boolean;
  /** A place with visits cannot go back to "want to go". */
  hasVisits?: boolean;
  /** Read the location as the form opens (the home screen's Save where I am tap). */
  locateNow?: boolean;
}) {
  const c = useColors();
  const set = (change: Partial<PlaceForm>) => onChange((current) => ({ ...current, ...change }));
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  const label = [styles.title, { color: c.text, fontSize: 15 }];
  return (
    <View style={{ gap: 10 }}>
      <HereRow coords={f.coords} onChange={(coords) => set({ coords })} disabled={disabled} locateNow={locateNow} />
      <TextInput
        style={input}
        placeholder="Address (optional)"
        placeholderTextColor={c.muted}
        maxLength={MAX_ADDRESS}
        value={f.address}
        onChangeText={(address) => set({ address })}
        editable={!disabled}
      />
      <TextInput
        style={input}
        placeholder="Google Maps link (optional)"
        placeholderTextColor={c.muted}
        maxLength={MAX_LINK}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={f.mapsUrl}
        onChangeText={(mapsUrl) => set({ mapsUrl })}
        editable={!disabled}
      />
      <Muted>In Google Maps: Share → Copy link, then paste it here. Other links are not accepted.</Muted>

      <Text style={label}>Kind</Text>
      <Chips options={KINDS} selected={(k) => f.kind === k} onPress={(k) => set({ kind: toggle(f.kind, k) })} disabled={disabled} />

      <TextInput
        style={input}
        placeholder="Cuisine (optional), e.g. italian, pizza"
        placeholderTextColor={c.muted}
        value={f.cuisine}
        onChangeText={(cuisine) => set({ cuisine })}
        editable={!disabled}
      />
      <TextInput
        style={input}
        placeholder="Dishes (optional), e.g. fattoush, kibbeh"
        placeholderTextColor={c.muted}
        value={f.dishes}
        onChangeText={(dishes) => set({ dishes })}
        editable={!disabled}
      />
      <Text style={label}>Price</Text>
      <Chips options={PRICES} selected={(p) => f.price === p} onPress={(p) => set({ price: toggle(f.price, p) })} disabled={disabled} />

      <Text style={label}>Good for</Text>
      <Chips
        multi
        options={OCCASION_CHIPS}
        selected={(o) => f.occasions.includes(o)}
        onPress={(o) => set({ occasions: f.occasions.includes(o) ? f.occasions.filter((x) => x !== o) : [...f.occasions, o] })}
        disabled={disabled}
      />

      <Text style={label}>Been there?</Text>
      <Chips
        options={STATUS}
        selected={(s) => f.status === s}
        onPress={(status) => set({ status })}
        disabled={disabled || (hasVisits && f.status === 'been')}
      />
      {hasVisits ? <Muted>This place has visits, so it stays “Been there”.</Muted> : null}
      {f.status === 'been' ? (
        <>
          <Text style={label}>Rating</Text>
          <Chips options={STARS} selected={(n) => f.rating === n} onPress={(n) => set({ rating: toggle(f.rating, n) })} disabled={disabled} />
          <Chips
            options={RETURN}
            selected={(r) => f.wouldReturn === r}
            onPress={(r) => set({ wouldReturn: toggle(f.wouldReturn, r) })}
            disabled={disabled}
          />
        </>
      ) : null}
    </View>
  );
}

/** The saved spot, or a button that reads where the phone is (asking for the permission only then). */
function HereRow({
  coords,
  onChange,
  disabled,
  locateNow,
}: {
  coords: PlaceForm['coords'];
  onChange: (coords: PlaceForm['coords']) => void;
  disabled?: boolean;
  locateNow?: boolean;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const alive = useRef(true);

  const locate = async () => {
    setBusy(true);
    setNote(null);
    const out = await whereAmI(deviceLocation);
    if (!alive.current) return;
    setBusy(false);
    if ('error' in out) return setNote({ text: out.error, problem: true });
    onChange({ lat: out.here.lat, lng: out.here.lng });
    setNote(out.here.accuracy ? { text: `Within about ${out.here.accuracy} m.`, problem: false } : null);
  };

  // Once, as the form opens from the home screen's Save where I am (that tap is the person's ask).
  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (locateNow && !started.current) {
      started.current = true;
      locate();
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ gap: 6 }}>
      {coords ? (
        <>
          <Text style={{ color: c.text, fontSize: 15 }}>📍 Location saved: {coordsText(coords)}</Text>
          <Button title="Remove the location" kind="plain" onPress={() => onChange(null)} disabled={disabled || busy} />
        </>
      ) : (
        <Button title={busy ? 'Finding where you are…' : '📍 Use where I am now'} kind="plain" onPress={locate} disabled={disabled || busy} />
      )}
      {note ? <Text style={{ color: note.problem ? c.danger : c.muted, fontSize: 14 }}>{note.text}</Text> : null}
      {!coords && !note ? <Muted>Only when you tap: Wilma reads your location once and keeps it in this note only.</Muted> : null}
    </View>
  );
}
