// A task: new, or edit with ?id= (day planner step 2, step 5; mockups section 4): what, how long,
// where (a saved place or an address, optional), by when, at a set time (optional; My day shows it
// then), repeats, and normal or important. On Android the dates and the time come from the phone's
// own calendar and clock pickers; elsewhere (the web preview) they are typed. Saved
// in the Tasks space; the server checks every field and keeps the previous version on an edit
// (rule 7). Text that looks like a password is held on the phone and never sent (rule 9; the
// server refuses it too).
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { PlacePicker } from '@/components/PlacePicker';
import { Chips } from '@/components/PlaceFields';
import { Button, ErrorBox, KeyboardScreen, Loading, Muted, space, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { findCredential } from '@/lib/credentials';
import { todayAndTomorrow } from '@/lib/dayView';
import { editError, LOOKS_LIKE_SECRET } from '@/lib/noteEdit';
import {
  duePicks, EMPTY_TASK, isDay, isTask, localParts, REPEAT_LABELS, shortDay, TASK_REPEATS, taskForm, taskMetadata, timeText, type TaskForm, type TaskMetadata, type TaskRepeat,
} from '@/lib/tasks';
import type { Item } from '@/lib/wilma';

export default function TaskScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { wilma } = useAuth();
  const loaded = useLoad(`task:${id ?? 'new'}`, async () => {
    if (!id) return null;
    const item = await wilma.getItem(id);
    const m = (item.metadata ?? {}) as Partial<TaskMetadata>;
    // The saved place's name, when it can still be opened.
    const placeTitle = m.place_id ? await wilma.getItem(m.place_id).then((p) => p.title, () => undefined) : undefined;
    return { item, placeTitle };
  });
  if (id && !loaded.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 16 }}>
        {loaded.error ? <ErrorBox message={loaded.error} onRetry={loaded.reload} /> : <Loading />}
      </View>
    );
  }
  return <TaskEditor item={loaded.data?.item ?? null} placeTitle={loaded.data?.placeTitle} />;
}

/** The phone's own calendar or clock, starting at `day` `time`; `onPick` gets what was chosen (not on Cancel). */
function openPicker(mode: 'date' | 'time', day: string, time: string, onPick: (picked: { day: string; time: string }) => void) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = (time || '12:00').split(':').map(Number);
  DateTimePickerAndroid.open({
    mode,
    value: new Date(y, mo - 1, d, h, mi),
    onValueChange: (_event, date) => {
      if (date) onPick(localParts(date));
    },
  });
}

const REPEATS: { value: TaskRepeat | 'none'; label: string }[] = [
  { value: 'none', label: 'One time' },
  ...TASK_REPEATS.map((r) => ({ value: r, label: REPEAT_LABELS[r] })),
];

function TaskEditor({ item, placeTitle }: { item: Item | null; placeTitle?: string }) {
  const c = useColors();
  const { wilma } = useAuth();
  const base = item && isTask(item.item_type) ? ((item.metadata ?? {}) as Partial<TaskMetadata>) : null;
  const [form, setForm] = useState<TaskForm>(() => (item ? taskForm(item.title, base, placeTitle) : EMPTY_TASK));
  const [body, setBody] = useState(item?.body_markdown ?? '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => todayAndTomorrow(new Date()).today);
  const set = (change: Partial<TaskForm>) => setForm((f) => ({ ...f, ...change }));

  const save = async () => {
    const out = taskMetadata(form, base);
    if ('error' in out) return setError(out.error);
    // Held on the phone: never sent to Wilma (the server refuses it as well).
    if (findCredential(form.title) || findCredential(form.address) || findCredential(body)) return setError(LOOKS_LIKE_SECRET);
    setBusy(true);
    setError(null);
    try {
      if (item) {
        await wilma.updateItem(item.id, {
          ...(form.title.trim() !== item.title ? { title: form.title.trim() } : {}),
          ...(body !== (item.body_markdown ?? '') ? { body } : {}),
          metadata: out.metadata,
        });
        router.back();
      } else {
        const saved = await wilma.saveTask({ title: form.title.trim(), body, metadata: out.metadata });
        router.replace({ pathname: '/item/[id]', params: { id: saved.id } });
      }
    } catch (e) {
      setError(editError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  const label = (t: string) => <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{t}</Text>;
  const where = form.place ? `📍 ${form.place.title}` : form.address ? `📍 ${form.address}` : null;
  const android = Platform.OS === 'android';
  const pickDue = () => openPicker('date', isDay(form.dueOn) ? form.dueOn : today, '', (p) => set({ dueOn: p.day }));
  // A new time goes on its own day, else the By when day, else today.
  const atDay = form.plannedDay || (isDay(form.dueOn) ? form.dueOn : today);
  const pickTime = () => openPicker('time', atDay, form.plannedTime, (p) => set({ plannedDay: atDay, plannedTime: p.time }));
  const pickAtDay = () => openPicker('date', atDay, form.plannedTime, (p) => set({ plannedDay: p.day }));

  return (
    <KeyboardScreen>
      <Stack.Screen options={{ title: item ? 'Edit task' : 'New task' }} />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {label('WHAT')}
        <TextInput style={input} placeholder="Pick up dry cleaning" placeholderTextColor={c.muted} maxLength={300} value={form.title} onChangeText={(title) => set({ title })} editable={!busy} />

        {label('HOW LONG (MINUTES)')}
        <TextInput style={input} placeholder="20" placeholderTextColor={c.muted} keyboardType="number-pad" maxLength={3} value={form.duration} onChangeText={(duration) => set({ duration: duration.replace(/\D/g, '') })} editable={!busy} />

        {label('WHERE (OPTIONAL)')}
        {picking ? (
          <PlacePicker
            title="Where is it done?"
            onPick={(spot) => {
              setPicking(false);
              if (spot.id) set({ place: { id: spot.id, title: spot.label }, address: '' });
              else set({ place: null, address: spot.address ?? spot.label });
            }}
            onCancel={() => setPicking(false)}
          />
        ) : where ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>{where}</Text>
            <TextLink title="Change" onPress={() => setPicking(true)} />
            <TextLink title="Remove" onPress={() => set({ place: null, address: '' })} />
          </View>
        ) : (
          <Button title="Pick a place" kind="plain" onPress={() => setPicking(true)} disabled={busy} />
        )}

        {label('BY WHEN')}
        <Chips
          options={[{ value: '', label: 'No date' }, ...duePicks(today).map((p) => ({ value: p.day, label: p.label }))]}
          selected={(v) => v === form.dueOn}
          onPress={(dueOn) => set({ dueOn })}
          disabled={busy}
        />
        {android ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>{isDay(form.dueOn) ? `📅 By ${shortDay(form.dueOn, today)}` : '📅 No date'}</Text>
            <TextLink title="Pick a date" onPress={pickDue} />
          </View>
        ) : (
          <TextInput style={input} placeholder="Or a date: 2026-10-12" placeholderTextColor={c.muted} maxLength={10} value={form.dueOn} onChangeText={(dueOn) => set({ dueOn })} editable={!busy} />
        )}

        {label('AT A SET TIME (OPTIONAL)')}
        {!android ? (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <TextInput style={[input, { flex: 1 }]} placeholder="Day: 2026-10-12" placeholderTextColor={c.muted} maxLength={10} value={form.plannedDay} onChangeText={(plannedDay) => set({ plannedDay })} editable={!busy} />
            <TextInput style={[input, { flex: 1 }]} placeholder="Time: 12:30" placeholderTextColor={c.muted} maxLength={5} value={form.plannedTime} onChangeText={(plannedTime) => set({ plannedTime })} editable={!busy} />
          </View>
        ) : form.plannedTime ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, flexWrap: 'wrap' }}>
            <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>{`🕒 ${shortDay(atDay, today)} at ${timeText(form.plannedTime)}`}</Text>
            <TextLink title="Day" onPress={pickAtDay} />
            <TextLink title="Time" onPress={pickTime} />
            <TextLink title="Remove" onPress={() => set({ plannedDay: '', plannedTime: '' })} />
          </View>
        ) : (
          <Button title="🕒 Pick a time" kind="plain" onPress={pickTime} disabled={busy} />
        )}
        <Muted>My day shows it at this time. Leave it empty and Wilma suggests where it fits.</Muted>

        {label('REPEATS')}
        <Chips options={REPEATS} selected={(v) => v === (form.repeat ?? 'none')} onPress={(v) => set({ repeat: v === 'none' ? null : v })} disabled={busy} />
        {form.repeat ? <Muted>Ticking it done moves it to its next date, and each day’s plan picks it up.</Muted> : null}

        <Chips
          options={[{ value: false, label: 'Normal' }, { value: true, label: 'Important' }]}
          selected={(v) => v === form.important}
          onPress={(important) => set({ important })}
          disabled={busy}
        />

        {label('NOTE (OPTIONAL)')}
        <TextInput style={[input, { minHeight: 80, textAlignVertical: 'top' }]} placeholder="Anything to remember" placeholderTextColor={c.muted} multiline maxLength={40000} value={body} onChangeText={setBody} editable={!busy} />
        <Muted>
          {item
            ? 'The previous version is kept in the task’s history. Passwords belong in the Vault.'
            : 'Saved in your Tasks space. Or just tell Wilma: “remind me to return the library books by Saturday, 15 minutes”. Passwords belong in the Vault.'}
        </Muted>
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy || picking} />
        <Button title="Cancel" kind="plain" onPress={() => router.back()} disabled={busy} />
      </ScrollView>
    </KeyboardScreen>
  );
}
