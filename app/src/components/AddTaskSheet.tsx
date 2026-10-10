// ＋ Add in My day (mockups screen 2's sheet): type a task, Find a time, pick one of the planner's
// suggestions (on a drive already planned, or in free time), or Not today. The task is saved as a
// Wilma task first; picking a time only sets when it is done (planned_at). Every suggestion comes
// from the planner's numbers (dayView.ts optionText); nothing here is kept after the sheet closes.
// With the suggestions, the choice of what happens if it is not done by the end of the day (D35).
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/PlaceFields';
import { PlacePicker } from '@/components/PlacePicker';
import type { TaskOption } from '@/lib/dayPlan';
import { optionText } from '@/lib/dayView';
import type { PickedSpot } from '@/lib/homePlace';
import { DAY_END_CHOICES, DAY_END_LABEL, type TaskDayEnd } from '@/lib/tasks';

import { Button, Card, Muted, space, styles, TextLink, useColors } from './ui';

export interface NewDayTask {
  title: string;
  duration: string;
  place: PickedSpot | null;
}

export type SheetStep =
  | { step: 'form' }
  | { step: 'options'; title: string; options: TaskOption[]; note?: string };

export function AddTaskSheet({
  sheet,
  titles,
  busy,
  error,
  onFind,
  onPick,
  onNotToday,
  onClose,
  dayEnd,
}: {
  sheet: SheetStep;
  titles: Map<string, string>;
  busy: boolean;
  error: string | null;
  onFind: (task: NewDayTask) => void;
  /** With the end-of-day choice it was saved with (null: ask); undefined for a repeating task (no choice). */
  onPick: (option: TaskOption, dayEnd: TaskDayEnd | null) => void;
  onNotToday: () => void;
  onClose: () => void;
  dayEnd?: TaskDayEnd | null;
}) {
  const c = useColors();
  const [task, setTask] = useState<NewDayTask>({ title: '', duration: '', place: null });
  // Untouched (null): the task's own choice, which is known only once it is saved.
  const [picked, setEnd] = useState<TaskDayEnd | 'ask' | null>(null);
  const end = picked ?? dayEnd ?? 'ask';
  const [picking, setPicking] = useState(false);
  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.background }];

  if (sheet.step === 'options') {
    return (
      <Card>
        <Text style={[styles.title, { color: c.text }]}>{`Where “${sheet.title}” fits`}</Text>
        <Muted>Wilma’s suggestions. Your calendar isn’t changed.</Muted>
        {sheet.options.map((o) => {
          const words = optionText(o, titles);
          return (
            <Pressable
              key={`${o.kind}-${o.start}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onPick(o, dayEnd === undefined || end === 'ask' ? null : end)}
              style={({ pressed }) => [{ borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: space.m, gap: 2, backgroundColor: c.card }, pressed && { opacity: 0.6 }]}>
              <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>{words.title}</Text>
              <Text style={{ color: c.text, fontSize: 13 }}>{words.detail}</Text>
            </Pressable>
          );
        })}
        {!sheet.options.length ? <Text style={{ color: c.text, fontSize: 15 }}>{sheet.note ?? 'No time today that fits it.'}</Text> : null}
        {sheet.options.length && dayEnd !== undefined ? (
          <View style={{ gap: space.xs }}>
            <Muted>{DAY_END_LABEL}</Muted>
            <Chips options={DAY_END_CHOICES} selected={(v) => v === end} onPress={setEnd} disabled={busy} />
          </View>
        ) : null}
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
          <Button title="Close" kind="plain" onPress={onClose} disabled={busy} />
          <Button title="Not today" kind="plain" onPress={onNotToday} disabled={busy} />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>Add to the day</Text>
      <TextInput style={input} placeholder="What: pick up dry cleaning" placeholderTextColor={c.muted} maxLength={300} value={task.title} onChangeText={(title) => setTask({ ...task, title })} editable={!busy} />
      <TextInput
        style={input}
        placeholder="How long, in minutes: 20"
        placeholderTextColor={c.muted}
        keyboardType="number-pad"
        maxLength={3}
        value={task.duration}
        onChangeText={(d) => setTask({ ...task, duration: d.replace(/\D/g, '') })}
        editable={!busy}
      />
      {picking ? (
        <PlacePicker
          title="Where is it done?"
          onPick={(place) => {
            setPicking(false);
            setTask({ ...task, place });
          }}
          onCancel={() => setPicking(false)}
        />
      ) : task.place ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>{`📍 ${task.place.label}`}</Text>
          <TextLink title="Remove" onPress={() => setTask({ ...task, place: null })} />
        </View>
      ) : (
        <TextLink title="📍 Where (optional)" onPress={() => setPicking(true)} />
      )}
      <Muted>Saved as a Wilma task. Wilma suggests where it fits.</Muted>
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
        <Button title="Cancel" kind="plain" onPress={onClose} disabled={busy} />
        <Button title={busy ? 'Finding…' : 'Find a time'} onPress={() => onFind(task)} disabled={busy || picking || !task.title.trim()} />
      </View>
    </Card>
  );
}
