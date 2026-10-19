// A routine: new, or edit with ?id= (routines step 3b, mockup 6; docs/routines-plan.md). A name,
// Repeats, When, its tasks (each with optional minutes), and Suggest in My day (lib/routineForm.ts).
// Saving sends the routine first (the server keeps it in the Tasks space and brings its tasks in
// step with a new schedule, each keeping a revision, rule 7), then each task added, changed or
// taken out (out: to the Recycle bin, rule 8). Delete routine bins the routine and all its tasks,
// after a confirm, restorable together (Q8). Text that looks like a password is held on the phone
// (rule 9; the server refuses it too).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/PlaceFields';
import { Button, confirm, ErrorBox, KeyboardScreen, Loading, Muted, space, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { todayAndTomorrow } from '@/lib/dayView';
import { editError } from '@/lib/noteEdit';
import {
  checkRoutine, EMPTY_ROUTINE, MAX_ROUTINE_TASKS, REPEAT_CHOICES, routineForm, routineSavePlan, routineTaskMetadata, whenChoices, withMinutes, withRepeat,
  type RoutineForm,
} from '@/lib/routineForm';
import { routineWords, toRoutine, WEEKDAYS, type RoutineMetadata } from '@/lib/routines';
import type { TaskMetadata, TaskRow } from '@/lib/tasks';

interface Loaded {
  id: string;
  title: string;
  routine: RoutineMetadata;
  tasks: TaskRow[];
}

export default function RoutineScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { wilma } = useAuth();
  const [today] = useState(() => todayAndTomorrow(new Date()).today);
  const loaded = useLoad(`routine:${id ?? 'new'}`, async (): Promise<Loaded | null> => {
    if (!id) return null;
    const [item, tasks] = await Promise.all([wilma.getItem(id), wilma.findTasks({ status: 'all', today })]);
    const routine = toRoutine(item.metadata);
    if (!routine) throw new Error('This is not a routine.');
    return { id: item.id, title: item.title, routine, tasks: tasks.filter((t) => t.routine?.id === item.id) };
  });
  if (id && !loaded.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 16 }}>
        {loaded.error ? <ErrorBox message={loaded.error} onRetry={loaded.reload} /> : <Loading />}
      </View>
    );
  }
  return <RoutineEditor saved={loaded.data ?? null} />;
}

function RoutineEditor({ saved }: { saved: Loaded | null }) {
  const c = useColors();
  const { wilma } = useAuth();
  const [form, setForm] = useState<RoutineForm>(() => (saved ? routineForm(saved.title, saved.routine, saved.tasks) : EMPTY_ROUTINE));
  // What the server holds now. After a save that stopped half way, a second Save finishes it from
  // here (it never makes the routine twice, or a task twice).
  const [base, setBase] = useState<{ id: string; title: string; tasks: { id: string; title: string; duration_min?: number }[] } | null>(() =>
    saved ? { id: saved.id, title: saved.title, tasks: saved.tasks.map((t) => ({ id: t.id, title: t.title, ...(t.duration_min ? { duration_min: t.duration_min } : {}) })) } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<RoutineForm>) => setForm((f) => ({ ...f, ...change }));
  const setTask = (i: number, change: Partial<RoutineForm['tasks'][number]>) =>
    setForm((f) => ({ ...f, tasks: f.tasks.map((t, j) => (j === i ? { ...t, ...change } : t)) }));

  const save = async () => {
    const out = checkRoutine(form);
    if ('error' in out) return setError(out.error);
    setBusy(true);
    setError(null);
    let now = base;
    const rows = form.tasks.map((t) => ({ ...t }));
    try {
      if (now) {
        await wilma.updateItem(now.id, { ...(out.title !== now.title ? { title: out.title } : {}), metadata: out.metadata });
      } else {
        now = { id: (await wilma.saveRoutine({ title: out.title, metadata: out.metadata })).id, title: out.title, tasks: [] };
      }
      now = { ...now, title: out.title };
      const plan = routineSavePlan(out, now.tasks);
      // New tasks, in the form's order; each gets its id in the form as soon as it is saved.
      for (const row of rows) {
        const add = !row.id && plan.add.find((a) => a.title === row.title.trim());
        if (!add) continue;
        plan.add.splice(plan.add.indexOf(add), 1);
        row.id = (await wilma.saveTask({ title: add.title, metadata: routineTaskMetadata(now.id, add.duration_min) })).id;
        now = { ...now, tasks: [...now.tasks, { id: row.id, title: add.title, ...(add.duration_min ? { duration_min: add.duration_min } : {}) }] };
      }
      for (const t of plan.change) {
        const item = await wilma.getItem(t.id);
        await wilma.updateItem(t.id, { ...(t.title ? { title: t.title } : {}), metadata: withMinutes((item.metadata ?? {}) as Partial<TaskMetadata>, t.duration_min) });
        now = {
          ...now,
          tasks: now.tasks.map((s) => (s.id === t.id ? { id: s.id, title: t.title ?? s.title, ...(t.duration_min ? { duration_min: t.duration_min } : {}) } : s)),
        };
      }
      for (const taskId of plan.remove) {
        await wilma.deleteItem(taskId);
        now = { ...now, tasks: now.tasks.filter((s) => s.id !== taskId) };
      }
      router.back();
    } catch (e) {
      // What was saved stays saved, and the form knows it: Save again finishes the rest.
      setBase(now);
      setForm((f) => ({ ...f, tasks: f.tasks.map((t, i) => (rows[i] && !t.id && rows[i].id ? { ...t, id: rows[i].id } : t)) }));
      setError(editError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!base) return;
    const n = base.tasks.length;
    const ok = await confirm(
      `Delete “${base.title}”?`,
      `The routine${n ? ` and its ${n === 1 ? 'task' : `${n} tasks`}` : ''} go to the Recycle bin, where you can restore them together.`,
      'Delete',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await wilma.deleteItem(base.id);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the routine.');
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];
  const label = (t: string) => <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{t}</Text>;
  const checked = checkRoutine(form);
  const words = 'error' in checked ? null : routineWords({ ...checked.metadata });

  return (
    <KeyboardScreen>
      <Stack.Screen options={{ title: base ? 'Edit routine' : 'New routine' }} />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {label('NAME')}
        <TextInput style={input} placeholder="Weekend house reset" placeholderTextColor={c.muted} maxLength={200} value={form.title} onChangeText={(title) => set({ title })} editable={!busy} />

        {label('REPEATS')}
        <Chips options={REPEAT_CHOICES} selected={(v) => v === form.repeat} onPress={(v) => setForm((f) => withRepeat(f, v))} disabled={busy} />

        {label('WHEN')}
        <Chips options={whenChoices(form.repeat)} selected={(v) => v === form.when} onPress={(when) => set({ when })} disabled={busy} />
        {form.when === 'same_day' ? (
          <Chips
            options={WEEKDAYS.map((d, i) => ({ value: i, label: d.slice(0, 3) }))}
            selected={(v) => v === form.weekday}
            onPress={(weekday) => set({ weekday })}
            disabled={busy}
          />
        ) : null}
        {form.when === 'by_day' ? (
          <TextInput
            style={input}
            placeholder="Day of the month: 28"
            placeholderTextColor={c.muted}
            keyboardType="number-pad"
            maxLength={2}
            value={form.monthDay}
            onChangeText={(monthDay) => set({ monthDay: monthDay.replace(/\D/g, '') })}
            editable={!busy}
          />
        ) : null}
        {words ? <Muted>{`${words}. Not done in time: it’s passed by and the next one comes up.`}</Muted> : null}

        {label('TASKS')}
        {form.tasks.map((t, i) => (
          <View key={t.id ?? `new${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <TextInput
              style={[input, { flex: 1 }]}
              placeholder={i === 0 ? 'Vacuum' : 'Another task'}
              placeholderTextColor={c.muted}
              maxLength={300}
              value={t.title}
              onChangeText={(title) => setTask(i, { title })}
              editable={!busy}
              accessibilityLabel={`Task ${i + 1}`}
            />
            <TextInput
              style={[input, { width: 76 }]}
              placeholder="min"
              placeholderTextColor={c.muted}
              keyboardType="number-pad"
              maxLength={4}
              value={t.duration}
              onChangeText={(duration) => setTask(i, { duration: duration.replace(/\D/g, '') })}
              editable={!busy}
              accessibilityLabel={`Minutes for task ${i + 1}`}
            />
            <TextLink
              title="✕"
              accessibilityLabel={`Take task ${i + 1} out`}
              onPress={() => setForm((f) => ({ ...f, tasks: f.tasks.length > 1 ? f.tasks.filter((_, j) => j !== i) : [{ title: '', duration: '' }] }))}
            />
          </View>
        ))}
        {form.tasks.length < MAX_ROUTINE_TASKS ? (
          <TextLink title="＋ Add a task" onPress={() => setForm((f) => ({ ...f, tasks: [...f.tasks, { title: '', duration: '' }] }))} />
        ) : null}
        <Muted>Minutes are optional: without them My day fits about 30 min. A task taken out goes to the Recycle bin.</Muted>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 16 }}>Suggest in My day</Text>
            <Muted>Wilma offers these tasks when it sees free time. Nothing is added without your tap.</Muted>
          </View>
          <Switch value={form.suggest} onValueChange={(suggest) => set({ suggest })} disabled={busy} accessibilityLabel="Suggest in My day" />
        </View>

        <Muted>Saved in your Tasks space. Passwords belong in the Vault.</Muted>
        {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
        <Button title="Cancel" kind="plain" onPress={() => router.back()} disabled={busy} />
        {base ? <Button title="Delete routine" kind="danger" onPress={() => void remove()} disabled={busy} /> : null}
      </ScrollView>
    </KeyboardScreen>
  );
}
